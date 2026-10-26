// Conformance tests for the composer context ring contract
// (.opencode/specs/context-ring-usage.md). Ids CR-01..CR-08 map to spec
// #R1-#R8; CR-12 covers #R13 (per-turn sum beats cumulative provider totals);
// CR-22 covers #R22 (measured flip without reload); CR-24 covers #R24
// (backend compaction-marker parity, cache row respects the summary slice).
import { describe, it, expect } from 'vitest';
import {
	computeContextUsage,
	estimateMessagesTokens,
	estimateTokens,
	findRecentCacheUsage,
	findSummaryCheckpoint,
	getUsageTokenCount,
	hasPromptSideUsage
} from './contextUsage';

const para = (repeats: number) => 'x'.repeat(4 * repeats);

describe('context ring usage (CR-01..CR-08)', () => {
	it('CR-01: prompt-side usage checkpoint covers prior history; later messages are added', () => {
		const messages = [
			{ role: 'user', content: para(500) },
			{ role: 'user', content: para(600) },
			{
				role: 'assistant',
				content: para(200),
				usage: { prompt_tokens: 4000, completion_tokens: 300 }
			},
			{ role: 'user', content: para(100) }
		];

		const usage = computeContextUsage({
			messages,
			systemText: 'sys',
			threshold: 80000,
			contextWindow: null
		});

		expect(usage).not.toBeNull();
		// Checkpoint = 4000 + 300; only messages AFTER the checkpoint are
		// estimated on top — the long prior history never collapses away.
		expect(usage!.tokens).toBe(4300 + estimateMessagesTokens([messages[3]]));
		// Sanity: that is far above "roughly one message's length".
		expect(usage!.tokens).toBeGreaterThan(4300);
		expect(usage!.denominator).toBe(80000);
		expect(usage!.percent).toBe(Math.round((usage!.tokens / 80000) * 100));
	});

	it('CR-02: completion-only usage is not a checkpoint; full branch estimate returned', () => {
		const messages = [
			{ role: 'user', content: para(5000) },
			{ role: 'assistant', content: para(4000), usage: { completion_tokens: 650 } }
		];

		const usage = computeContextUsage({
			messages,
			systemText: 'sys',
			threshold: 80000,
			contextWindow: null
		});

		expect(usage).not.toBeNull();
		expect(hasPromptSideUsage({ completion_tokens: 650 })).toBe(false);
		// The old bug collapsed the count to the lone reply (~650 tokens).
		const expected = estimateTokens('sys') + estimateMessagesTokens(messages);
		expect(usage!.tokens).toBe(expected);
		expect(usage!.tokens).toBeGreaterThan(1500);
	});

	it('CR-03: numeric zero usage fields are present, not missing (no truthiness fallthrough)', () => {
		expect(hasPromptSideUsage({ prompt_tokens: 0, completion_tokens: 5 })).toBe(true);
		// 0 must not fall through to absent/garbage fields: total is 0 + 5,
		// not something derived from other keys.
		expect(getUsageTokenCount({ prompt_tokens: 0, completion_tokens: 5 })).toBe(5);

		const messages = [
			{ role: 'user', content: para(9000) },
			{ role: 'assistant', content: 'ok', usage: { prompt_tokens: 0, completion_tokens: 5 } }
		];
		const usage = computeContextUsage({ messages, systemText: '', threshold: null });
		expect(usage).not.toBeNull();
		// Zero prompt side is still a checkpoint decision point (present), and
		// the branch tail estimate is what survives — not the old `||` chain.
		expect(hasPromptSideUsage(messages[1].usage)).toBe(true);
		expect(usage!.percent).toBeNull(); // no threshold, no window
	});

	it('CR-04: Ollama and llama.cpp usage shapes resolve', () => {
		// Ollama
		expect(hasPromptSideUsage({ prompt_eval_count: 1200, eval_count: 80 })).toBe(true);
		expect(getUsageTokenCount({ prompt_eval_count: 1200, eval_count: 80 })).toBe(1280);
		// llama.cpp: prompt_n + cache_n on the prompt side, predicted_n on the
		// completion side.
		const llama = { prompt_n: 500, cache_n: 300, predicted_n: 40 };
		expect(hasPromptSideUsage(llama)).toBe(true);
		expect(getUsageTokenCount(llama)).toBe(840);
		// llama.cpp with prompt_n: 0 → prompt side present (R3), total from predicted_n
		expect(getUsageTokenCount({ prompt_n: 0, cache_n: 0, predicted_n: 7 })).toBe(7);
	});

	it('CR-05: Anthropic-style usage sums prompt, output and cache fields', () => {
		const anthropic = {
			input_tokens: 1000,
			output_tokens: 200,
			cache_read_input_tokens: 500
		};
		expect(hasPromptSideUsage(anthropic)).toBe(true);
		expect(getUsageTokenCount(anthropic)).toBe(1700);

		// #R13 sum-wins: once both per-turn sides resolve, an explicit total
		// NEVER replaces the sum — not even one that is ≥ the sum (a larger
		// total is exactly the cumulative-counter shape that inflated the ring).
		expect(
			getUsageTokenCount({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 180 })
		).toBe(150);
		expect(
			getUsageTokenCount({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 120 })
		).toBe(150);

		// cache_creation_input_tokens is included too
		expect(
			getUsageTokenCount({
				input_tokens: 1000,
				output_tokens: 200,
				cache_read_input_tokens: 500,
				cache_creation_input_tokens: 100
			})
		).toBe(1800);
	});

	it('CR-06: custom compaction threshold is the denominator, never a hardcoded 80000', () => {
		// ~10000 estimated tokens (40000 chars / 4, incl. per-message overhead).
		const messages = [
			{ role: 'user', content: para(20000) },
			{ role: 'assistant', content: para(20000) }
		];
		const expectedTokens = estimateMessagesTokens(messages);
		expect(expectedTokens).toBeGreaterThanOrEqual(10000);

		const usage = computeContextUsage({ messages, systemText: '', threshold: 12000 });
		expect(usage).not.toBeNull();
		expect(usage!.denominator).toBe(12000);
		expect(usage!.percent).toBe(Math.min(100, Math.round((expectedTokens / 12000) * 100)));
		// If 80000 were hardcoded the percent would be ~12; it must not be.
		expect(usage!.percent).not.toBe(Math.round((expectedTokens / 80000) * 100));
	});

	it('CR-07: no threshold → percent vs context window; neither known → percent null', () => {
		const messages = [{ role: 'user', content: para(1000) }];
		const tokens = estimateMessagesTokens(messages);

		const windowed = computeContextUsage({ messages, systemText: '', contextWindow: 32768 });
		expect(windowed).not.toBeNull();
		expect(windowed!.denominator).toBe(32768);
		expect(windowed!.percent).toBe(Math.round((tokens / 32768) * 100));

		const bare = computeContextUsage({ messages, systemText: '' });
		expect(bare).not.toBeNull();
		expect(bare!.denominator).toBeNull();
		expect(bare!.percent).toBeNull(); // ring renders nothing (pure ContextRing)
		expect(bare!.tokens).toBe(tokens); // numerator still available
	});

	it('CR-08: summary checkpoint slices prior messages; tail still counted', () => {
		const messages = [
			{ role: 'user', content: para(9000) },
			{ role: 'assistant', content: 'old answer' },
			{ role: 'system', content: 'answer from summary', contextSummary: para(4000) },
			{ role: 'user', content: para(500) }
		];

		const checkpoint = findSummaryCheckpoint(messages);
		expect(checkpoint).toEqual({ index: 2, text: para(4000) });

		const usage = computeContextUsage({
			messages,
			systemText: '',
			summaryCheckpoint: checkpoint,
			threshold: null,
			contextWindow: null
		});
		expect(usage).not.toBeNull();
		// Pre-summary messages are out; the summary text plus the tail remain.
		expect(usage!.tokens).toBe(
			estimateTokens(para(4000)) + estimateMessagesTokens(messages.slice(2))
		);
		expect(usage!.tokens).toBeLessThan(estimateMessagesTokens(messages));
		expect(usage!.tokens).toBeGreaterThan(estimateMessagesTokens([messages[3]]));
	});
});

describe('context ring source label', () => {
	it('source: measured checkpoint vs estimated fallback', () => {
		// Valid prompt-side checkpoint supplies the numerator → measured.
		const checkpointMessages = [
			{ role: 'user', content: para(500) },
			{
				role: 'assistant',
				content: para(200),
				usage: { prompt_tokens: 4000, completion_tokens: 300 }
			}
		];
		const measured = computeContextUsage({
			messages: checkpointMessages,
			systemText: '',
			threshold: null
		});
		expect(measured).not.toBeNull();
		expect(measured!.source).toBe('measured');

		// No valid checkpoint (completion-only, #R2) → pure estimation.
		const estimatedMessages = [
			{ role: 'user', content: para(500) },
			{ role: 'assistant', content: para(200), usage: { completion_tokens: 650 } }
		];
		const estimated = computeContextUsage({
			messages: estimatedMessages,
			systemText: '',
			threshold: null
		});
		expect(estimated).not.toBeNull();
		expect(estimated!.source).toBe('estimated');
	});
});

// CR-12 (#R13): cumulative-counter providers (omlx) emit session-cumulative
// total_tokens beside per-turn prompt/completion fields; the checkpoint must be
// the per-turn sum, never the inflated total (100% ring root cause).
describe('per-turn sum beats cumulative totals (CR-12, #R13)', () => {
	it('omlx-shaped row → checkpoint is the per-turn sum, not the session total', () => {
		const omlxUsage = {
			prompt_tokens: 45307,
			completion_tokens: 2226,
			total_tokens: 615849,
			prompt_tokens_details: { cached_tokens: 425938 }
		};
		// 45307 + 2226 = 47533; the 615849 session-cumulative total must not win.
		expect(getUsageTokenCount(omlxUsage)).toBe(47533);

		// End-to-end at the checkpoint level: the ring numerator stays per-turn.
		const usage = computeContextUsage({
			messages: [{ role: 'assistant', content: 'ok', usage: omlxUsage }],
			systemText: '',
			threshold: 80000
		});
		expect(usage).not.toBeNull();
		expect(usage!.tokens).toBe(47533);
		expect(usage!.source).toBe('measured');
		// ~59% — nowhere near the 100% ring the total-based numerator produced.
		expect(usage!.percent).toBe(Math.round((47533 / 80000) * 100));
		expect(usage!.percent).toBeLessThan(100);
	});

	it('single-side + total infers the missing side when plausible', () => {
		// Only the completion side resolves → prompt inferred as 500 − 100 = 400.
		expect(getUsageTokenCount({ completion_tokens: 100, total_tokens: 500 })).toBe(500);
		// Implausible total (below the resolved side) → keep the resolved sum.
		expect(getUsageTokenCount({ prompt_tokens: 100, total_tokens: 50 })).toBe(100);
	});

	it('Anthropic-exclusive cache fields fold when no OpenAI prompt_tokens is present', () => {
		// input_tokens excludes the cache (Anthropic-style names, no
		// prompt_tokens) → fold valid: 1000 + 2000 + 50.
		expect(
			getUsageTokenCount({
				input_tokens: 1000,
				cache_read_input_tokens: 2000,
				output_tokens: 50
			})
		).toBe(3050);
	});
});

// CR-22 (#R22): when the run's provider usage lands on the live branch, a
// fresh compute over the mutated branch flips the ring to a measured
// checkpoint + tail — no chat reload required.
describe('measured flip when usage lands on the branch (CR-22, #R22)', () => {
	it('newest assistant gaining a prompt-side usage blob yields measured checkpoint + tail', () => {
		const branch: any[] = [
			{ role: 'user', content: para(9000) },
			{ role: 'assistant', content: para(2000) },
			{ role: 'user', content: para(50) }
		];

		// Before finalize: no prompt-side usage anywhere → honest estimate.
		const before = computeContextUsage({
			messages: [...branch],
			systemText: '',
			threshold: 65536,
			contextWindow: null
		});
		expect(before).not.toBeNull();
		expect(before!.source).toBe('estimated');

		// Stream finalize attaches the run's usage to the newest assistant.
		branch[1] = { ...branch[1], usage: { prompt_tokens: 40000, completion_tokens: 500 } };

		const after = computeContextUsage({
			messages: [...branch],
			systemText: '',
			threshold: 65536,
			contextWindow: null
		});
		expect(after).not.toBeNull();
		expect(after!.source).toBe('measured');
		// Checkpoint = 40000 + 500; only messages after the checkpoint add on.
		expect(after!.tokens).toBe(40500 + estimateMessagesTokens([branch[2]]));
	});
});

// CR-24 (#R24): the backend persists compaction markers as
// `open_webui:context_compaction` items inside message.output arrays in
// addition to contextSummary/context_summary string fields
// (backend/open_webui/utils/context_compaction.py `_apply_latest_summary_checkpoint`).
// The frontend must recognize both shapes, and the tooltip cache row must
// resolve against the same post-slice branch the ring numerator scans.
describe('backend compaction marker parity (CR-24, #R24)', () => {
	it('CR-24: output-item open_webui:context_compaction marker yields a checkpoint; string fields keep priority', () => {
		const messages: any[] = [
			{ role: 'user', content: 'q' },
			{
				role: 'assistant',
				content: 'a',
				output: [
					{ type: 'function_call', call_id: 'c1' },
					{ type: 'open_webui:context_compaction', call_id: 'c1', summary: 'S' }
				]
			},
			{ role: 'user', content: 'next' }
		];
		expect(findSummaryCheckpoint(messages)).toEqual({ index: 1, text: 'S' });

		// A string-field marker on a LATER message wins over the output item.
		messages[2] = { ...messages[2], contextSummary: 'S2' };
		expect(findSummaryCheckpoint(messages)).toEqual({ index: 2, text: 'S2' });

		// Within the SAME message the string field wins (backend per-message order).
		const same = [
			{
				role: 'assistant',
				contextSummary: 'PRIORITY',
				output: [{ type: 'open_webui:context_compaction', call_id: 'c1', summary: 'S' }]
			}
		];
		expect(findSummaryCheckpoint(same)).toEqual({ index: 0, text: 'PRIORITY' });

		// Empty / non-string summaries on a marker are ignored.
		expect(
			findSummaryCheckpoint([
				{
					role: 'assistant',
					output: [{ type: 'open_webui:context_compaction', call_id: 'c1', summary: '' }]
				}
			])
		).toBeNull();
		expect(
			findSummaryCheckpoint([
				{ role: 'assistant', output: [{ type: 'open_webui:context_compaction', summary: 42 }] }
			])
		).toBeNull();

		// Defensive: null messages / non-array / junk output never throw.
		expect(
			findSummaryCheckpoint([
				null,
				{ role: 'assistant', output: null },
				{ role: 'assistant', output: 'not-an-array' },
				{ role: 'assistant', output: [null, 'junk', { type: 'open_webui:context_compaction' }] }
			])
		).toBeNull();
	});

	it('CR-24: computeContextUsage slices at the output-item marker; pre-marker usage checkpoints are out of range', () => {
		const messages: any[] = [
			{ role: 'user', content: para(9000) },
			// Prompt-side usage checkpoint BEFORE the marker — it sits on a
			// message the slice excludes, so it must never supply the numerator.
			{
				role: 'assistant',
				content: 'old answer',
				usage: { prompt_tokens: 40000, completion_tokens: 500 }
			},
			{
				role: 'assistant',
				content: 'compact',
				output: [
					{ type: 'function_call', call_id: 'c1' },
					{ type: 'open_webui:context_compaction', call_id: 'c1', summary: para(4000) }
				]
			},
			{ role: 'user', content: para(500) }
		];

		const checkpoint = findSummaryCheckpoint(messages);
		expect(checkpoint).toEqual({ index: 2, text: para(4000) });

		const usage = computeContextUsage({
			messages,
			systemText: '',
			summaryCheckpoint: checkpoint,
			threshold: null,
			contextWindow: null
		});
		expect(usage).not.toBeNull();
		// Pre-marker messages are out; the summary text plus the post-marker
		// tail remain — the pre-marker usage blob is invisible to the slice.
		expect(usage!.tokens).toBe(
			estimateTokens(para(4000)) + estimateMessagesTokens(messages.slice(2))
		);
		expect(usage!.source).toBe('estimated');
		expect(usage!.tokens).toBeLessThan(estimateMessagesTokens(messages));
		expect(usage!.tokens).toBeGreaterThan(estimateMessagesTokens([messages[3]]));

		// A POST-marker checkpoint is still honored (measured, tail-only).
		const withPostUsage = [...messages];
		withPostUsage[3] = {
			...withPostUsage[3],
			usage: { prompt_tokens: 2000, completion_tokens: 100 }
		};
		const measured = computeContextUsage({
			messages: withPostUsage,
			systemText: '',
			summaryCheckpoint: checkpoint,
			threshold: null,
			contextWindow: null
		});
		expect(measured).not.toBeNull();
		expect(measured!.source).toBe('measured');
		expect(measured!.tokens).toBe(2100);
	});

	it('CR-24: cache-row lookup honors the summary slice; no checkpoint keeps full-branch behavior', () => {
		const cachedBlob = {
			prompt_tokens: 5000,
			completion_tokens: 10,
			prompt_tokens_details: { cached_tokens: 4000 }
		};
		const messages = [
			{ role: 'assistant', content: 'old', usage: cachedBlob },
			{ role: 'system', content: 'summary', contextSummary: 'S' },
			{ role: 'user', content: 'tail' }
		];
		const checkpoint = findSummaryCheckpoint(messages);
		expect(checkpoint).toEqual({ index: 1, text: 'S' });

		// Blob sits BEFORE the slice start → invisible to the cache row, so it
		// can never contradict the numerator (spec #R24).
		expect(findRecentCacheUsage(messages, checkpoint)).toBeNull();

		// The same blob AFTER the slice start → found.
		const afterStart = [
			messages[1],
			{ role: 'assistant', content: 'fresh', usage: cachedBlob },
			messages[2]
		];
		expect(findRecentCacheUsage(afterStart, findSummaryCheckpoint(afterStart))).toBe(cachedBlob);

		// cached_tokens === 0 is not a cache hit; top-level alias and
		// info.usage fallback resolve like the numerator's usage lookup.
		expect(
			findRecentCacheUsage(
				[
					{
						role: 'assistant',
						usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } }
					}
				],
				null
			)
		).toBeNull();
		const aliasBlob = { prompt_tokens: 10, cached_tokens: 7 };
		expect(findRecentCacheUsage([{ role: 'assistant', usage: aliasBlob }])).toBe(aliasBlob);
		const infoBlob = { prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 3 } };
		expect(findRecentCacheUsage([{ role: 'assistant', info: { usage: infoBlob } }], null)).toBe(
			infoBlob
		);

		// No checkpoint → full-branch scan preserved (pre-fix MessageInput behavior).
		expect(findRecentCacheUsage(messages, null)).toBe(cachedBlob);
		expect(findRecentCacheUsage(messages)).toBe(cachedBlob);

		// Defensive: malformed entries never throw.
		expect(findRecentCacheUsage([null, { usage: null }, { info: {} }], checkpoint)).toBeNull();
	});

	it('CR-08 regression: string contextSummary slicing behaves exactly as before', () => {
		const messages = [
			{ role: 'system', content: 'older summary', contextSummary: 'OLD' },
			{ role: 'user', content: 'q' },
			{ role: 'system', content: 'newest summary', contextSummary: 'NEW' }
		];
		// Newest string marker still wins and keeps its index/text.
		expect(findSummaryCheckpoint(messages)).toEqual({ index: 2, text: 'NEW' });

		const usage = computeContextUsage({
			messages,
			systemText: '',
			summaryCheckpoint: findSummaryCheckpoint(messages),
			threshold: null,
			contextWindow: null
		});
		expect(usage).not.toBeNull();
		expect(usage!.tokens).toBe(estimateTokens('NEW') + estimateMessagesTokens(messages.slice(2)));
	});
});
