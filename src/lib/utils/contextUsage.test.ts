// Conformance tests for the composer context ring contract
// (.opencode/specs/context-ring-usage.md). Ids CR-01..CR-08 map to spec
// #R1-#R8; CR-12 covers #R13 (per-turn sum beats cumulative provider totals).
import { describe, it, expect } from 'vitest';
import {
	computeContextUsage,
	estimateMessagesTokens,
	estimateTokens,
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
