// Unit-resolution + tooltip tests for the shared usage-stats helpers
// (local branch: WP-TIP). Ollama-native phase durations carry nanoseconds
// while the oMLX/openai-compatible path carries seconds; resolveDurationMs
// (ns→µs→s, implied rate ≤ 100k tok/s) must land on the plausible scale for
// both, and formatUsageTooltipHtml must route every number through the
// canonical locale/format helpers.
//
// WP-RATE appends the own-run attribution conformance rows CR-09/CR-10
// (.opencode/specs/context-ring-usage.md #R11/#R12): engine activity is
// connection-global, so rows may only be claimed for a run whose own stream
// produced its first token, and the chip shows zero tok/s before that.
// WP-R11-DISPLAY appends CR-11 (#R11): the chip's display selectors are built
// from claimable-filtered rows, so foreign busy rows leak neither token counts
// nor queued/prefill phase words.
// WP-NUMERATOR appends CR-13 (#R14): cached > prompt is an impossible per-turn
// ratio (cumulative-vs-per-turn provider mismatch) — cache-hit percent and the
// cached-prompt tooltip rows are suppressed rather than shown bogus.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
	claimOwnRequestId,
	computeLiveTps,
	formatContextTooltipHtml,
	formatUsageTooltipHtml,
	getCacheHitPercent,
	getDisplayGenTokens,
	getDisplayPromptTokens,
	getDisplayView,
	isClaimable,
	resolveDurationMs,
	withClaimableRows
} from './streamTiming';
import {
	beginRun,
	currentChatId,
	endRun,
	noteStreamUpdate,
	runStats,
	runs,
	type RunStats
} from '$lib/stores/generationStats';

describe('resolveDurationMs', () => {
	it('keeps ollama nanoseconds at the ns scale (4e9 ns = 4000 ms)', () => {
		expect(resolveDurationMs(4_000_000_000, 100)).toBe(4000);
	});

	it('scales oMLX seconds to milliseconds and implies ~387 tok/s prefill', () => {
		const ms = resolveDurationMs(1.79, 693);
		expect(ms).toBeCloseTo(1790, 6);
		const tps = (693 / (ms as number)) * 1000;
		expect(tps).toBeGreaterThanOrEqual(350);
		expect(tps).toBeLessThanOrEqual(420);
	});

	it('falls through units when an interpretation implies an absurd rate', () => {
		// Raw is µs-scaled: the ns reading would imply 1e6 tok/s (> 100k) and
		// must be rejected; the µs reading (1000 ms → 1000 tok/s) wins.
		expect(resolveDurationMs(1_000_000, 1000)).toBe(1000);
	});

	it('returns null for missing, non-finite, or non-positive raw values', () => {
		expect(resolveDurationMs(null)).toBeNull();
		expect(resolveDurationMs(undefined)).toBeNull();
		expect(resolveDurationMs(Number.NaN)).toBeNull();
		expect(resolveDurationMs(Number.POSITIVE_INFINITY)).toBeNull();
		expect(resolveDurationMs(0)).toBeNull();
		expect(resolveDurationMs(-5)).toBeNull();
	});

	it('returns null when no unit interpretation yields a plausible rate', () => {
		// 200M tokens in 1 s (best case) is still 2e5 tok/s > 100k.
		expect(resolveDurationMs(1, 200_000_000)).toBeNull();
	});
});

describe('formatUsageTooltipHtml', () => {
	it('derives ollama-ns decode speed: 100 tokens / 4e9 ns = 25 tok/s', () => {
		const html = formatUsageTooltipHtml({
			completion_tokens: 100,
			eval_duration: 4_000_000_000
		});
		expect(html).toContain('Decode speed');
		expect(html).toContain('25 tok/s');
		// The old blind /1e6 math produced rates in the trillions here.
		expect(html).not.toContain('k tok/s');
	});

	it('derives oMLX-seconds prefill speed: 693 tokens / 1.79 s ≈ 387 tok/s', () => {
		const html = formatUsageTooltipHtml({
			prompt_tokens: 693,
			prompt_eval_duration: 1.79
		});
		expect(html).toContain('Prefill speed');
		const match = html.match(/Prefill speed<\/td><td[^>]*>([\d.]+)k? tok\/s/);
		expect(match).not.toBeNull();
		const tps = parseFloat(match![1]) * (match![0].includes('k tok/s') ? 1000 : 1);
		expect(tps).toBeGreaterThanOrEqual(350);
		expect(tps).toBeLessThanOrEqual(420);
	});

	it('prefers backend-provided prompt_tokens_per_second over derived-from-duration', () => {
		const html = formatUsageTooltipHtml({
			prompt_tokens: 1000,
			// derived would be 250 tok/s…
			prompt_eval_duration: 4_000_000_000,
			// …but the provider's own rate wins
			prompt_tokens_per_second: 387
		});
		expect(html).toContain('387 tok/s');
		expect(html).not.toContain('250 tok/s');
	});

	it('emits locale-grouped token counts via toLocaleString (en-US: "41,720")', () => {
		const html = formatUsageTooltipHtml({
			prompt_tokens: 41720,
			completion_tokens: 1234,
			total_tokens: 42954
		});
		const expected = (41720).toLocaleString();
		// The runtime's default ICU locale must apply thousands grouping
		// (en-US: "41,720"; other locales use "." or a space separator) —
		// and the tooltip must carry exactly that grouped rendering.
		expect(expected).toMatch(/41[,. \u00a0]720/);
		expect(html).toContain(expected);
		// Raw ungrouped digits would mean ad-hoc formatting leaked in.
		expect(html).not.toContain('>41720<');
	});

	it('returns an empty string for missing or empty usage', () => {
		expect(formatUsageTooltipHtml(null)).toBe('');
		expect(formatUsageTooltipHtml({})).toBe('');
	});
});

// CR-09 (#R11) / CR-10 (#R12): engine activity is connection-global —
// attribution requires ownership evidence, and zero tok/s renders before our
// own stream's first token no matter how busy the engine looks.
describe('own-run engine attribution — isClaimable (CR-09, #R11)', () => {
	const run = (over: Partial<RunStats> = {}): RunStats =>
		({
			messageId: 'm1',
			chatId: 'c1',
			modelId: 'model-a',
			urlIdx: null,
			startedAt: 10_000,
			firstDeltaAt: 12_000,
			estTokens: 0,
			usage: null,
			step: null,
			steps: [],
			claimedRequestId: null,
			context: null,
			contextThreshold: null,
			engineActivity: null,
			...over
		}) as RunStats & typeof over;
	const ctx = { modelId: 'model-a', chatId: 'c1' };

	it('is unclaimable for any row while the run has no first token', () => {
		const waiting = { request_id: 'r0', elapsed_seconds: 1, startedAt: 10_100 };
		const row = { request_id: 'r1', elapsed_seconds: 0.5, startedAt: 10_200 };
		expect(isClaimable(row, run({ firstDeltaAt: null }), ctx)).toBe(false);
		expect(isClaimable(waiting, run({ firstDeltaAt: null }), ctx)).toBe(false);
		expect(isClaimable(row, run(), ctx)).toBe(true);
	});

	it('rejects rows that started before the run beyond the 250 ms slack', () => {
		const foreign = { request_id: 'bg', elapsed_seconds: 3, startedAt: 9_700 };
		expect(isClaimable(foreign, run(), ctx)).toBe(false);
		// exactly at the slack boundary still qualifies (clock alignment)
		expect(isClaimable({ request_id: 'ok', startedAt: 9_750 }, run(), ctx)).toBe(true);
	});

	it('derives row start from elapsed_seconds and rejects pre-run ages', () => {
		vi.useFakeTimers();
		vi.setSystemTime(20_000);
		try {
			// began at 17s: after the run (10s) → ours
			expect(isClaimable({ request_id: 'ours', elapsed_seconds: 3 }, run(), ctx)).toBe(true);
			// began at 5s: a minute before our submit → foreign
			expect(isClaimable({ request_id: 'theirs', elapsed_seconds: 15 }, run(), ctx)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('rejects rows echoing a foreign chat_id or modelId', () => {
		expect(
			isClaimable({ request_id: 'x', startedAt: 10_100, chat_id: 'other-chat' }, run(), ctx)
		).toBe(false);
		expect(
			isClaimable({ request_id: 'y', startedAt: 10_100, modelId: 'other-model' }, run(), ctx)
		).toBe(false);
		expect(isClaimable({ request_id: 'z', startedAt: 10_100, chat_id: 'c1' }, run(), ctx)).toBe(
			true
		);
	});

	it('passes rows without age evidence (partial payloads) through the firstDeltaAt gate only', () => {
		expect(isClaimable({ request_id: 'no-age' }, run(), ctx)).toBe(true);
		expect(isClaimable({ request_id: 'no-age' }, run({ firstDeltaAt: null }), ctx)).toBe(false);
	});

	it('claimOwnRequestId never claims before first token and only picks own-age rows', () => {
		const model = {
			id: 'model-a',
			generating: [
				{ request_id: 'foreign', elapsed_seconds: 10, startedAt: 5_000, tokens_per_second: 40 },
				{ request_id: 'own', elapsed_seconds: 1, startedAt: 10_300, tokens_per_second: 38 }
			]
		};
		// pre-first-token: no claim attempts at all
		expect(claimOwnRequestId(model, run({ firstDeltaAt: null }), null, ctx)).toBeNull();
		// post-first-token: the foreign older row is filtered out
		expect(claimOwnRequestId(model, run(), null, ctx)).toBe('own');
		// only foreign rows left → nothing claimable
		expect(
			claimOwnRequestId({ id: 'model-a', generating: [model.generating[0]] }, run(), null, ctx)
		).toBeNull();
	});

	it('keeps a live claim while its row remains claimable, drops it once foreign', () => {
		const ownRow = { request_id: 'own', elapsed_seconds: 1, startedAt: 10_300 };
		expect(claimOwnRequestId({ id: 'model-a', generating: [ownRow] }, run(), 'own', ctx)).toBe(
			'own'
		);
		// the claimed row aged out (started before our run) → claim released
		expect(
			claimOwnRequestId(
				{ id: 'model-a', generating: [{ ...ownRow, startedAt: 5_000 }] },
				run(),
				'own',
				ctx
			)
		).toBeNull();
	});

	it('withClaimableRows filters all phases and keeps id-less busy rows for synthetic claims', () => {
		const model = {
			id: 'model-a',
			prefilling: [{ request_id: 'p-old', elapsed: 30, startedAt: 5_000 }],
			generating: [{ request_id: 'g-own', elapsed_seconds: 1, startedAt: 10_300 }],
			waiting: [{ request_id: 'w-old', elapsed_seconds: 20, startedAt: 6_000 }]
		};
		const filtered = withClaimableRows(model, run(), ctx);
		expect(filtered?.prefilling ?? []).toHaveLength(0);
		expect(filtered?.waiting ?? []).toHaveLength(0);
		expect(filtered?.generating?.map((r) => r.request_id)).toEqual(['g-own']);
		expect(withClaimableRows(null, run(), ctx)).toBeNull();
	});
});

describe('zero rate before first token — computeLiveTps (CR-10, #R12)', () => {
	const run = (firstDeltaAt: number | null): RunStats =>
		({
			messageId: 'm1',
			chatId: 'c1',
			modelId: 'model-a',
			urlIdx: null,
			startedAt: 10_000,
			firstDeltaAt,
			estTokens: 0,
			usage: null,
			step: null,
			steps: [],
			claimedRequestId: null,
			context: null,
			contextThreshold: null,
			engineActivity: null
		}) as RunStats;

	it('returns 0 with active generating rows while no first token arrived', () => {
		expect(
			computeLiveTps({ phase: 'generating', generating: { tokens_per_second: 42 } }, run(null))
		).toBe(0);
	});

	it('returns 0 with an active prefill row while no first token arrived', () => {
		expect(computeLiveTps({ phase: 'prefilling', prefill: { speed: 900 } }, run(null))).toBe(0);
	});

	it('adopts the engine row rate once the run has streamed its first token', () => {
		expect(
			computeLiveTps({ phase: 'generating', generating: { tokens_per_second: 42 } }, run(12_000))
		).toBe(42);
		expect(computeLiveTps({ phase: 'prefilling', prefill: { speed: 900 } }, run(12_000))).toBe(900);
	});

	it('merges client rates unchanged alongside the engine rate', () => {
		expect(computeLiveTps({ phase: 'idle' }, run(12_000), 7, 3)).toBe(7);
		expect(computeLiveTps({ phase: 'idle' }, run(12_000), 0, 3)).toBe(3);
		// client rates stay gated on streamed content upstream: a run without
		// first token still renders 0 even with non-zero client inputs.
		expect(computeLiveTps({ phase: 'idle' }, run(null), 7, 3)).toBe(0);
	});

	it('returns 0 for idle or missing views and runs', () => {
		expect(computeLiveTps(null, run(12_000))).toBe(0);
		expect(computeLiveTps({ phase: 'idle' }, null)).toBe(0);
	});
});

// CR-11 (#R11): the chip's display selectors derive exclusively from rows the
// run may claim. A foreign busy row (older startedAt, no own firstDeltaAt)
// surfaces no engine token counts and no queued/prefill phase words — the view
// is neutral; once the run's own row is claimable, its numbers reappear.
describe('chip display gated on own evidence — getDisplayView (CR-11, #R11)', () => {
	const run = (firstDeltaAt: number | null): RunStats =>
		({
			messageId: 'm1',
			chatId: 'c1',
			modelId: 'model-a',
			urlIdx: null,
			startedAt: 10_000,
			firstDeltaAt,
			estTokens: 0,
			usage: null,
			step: null,
			steps: [],
			claimedRequestId: null,
			context: null,
			contextThreshold: null,
			engineActivity: null
		}) as RunStats;
	const ctx = { modelId: 'model-a', chatId: 'c1' };
	// Busy engine whose every row predates this run's submit — all foreign.
	const foreignModel = {
		id: 'model-a',
		prefilling: [
			{
				request_id: 'p-bg',
				processed: 5000,
				total: 8000,
				speed: 900,
				elapsed: 30,
				startedAt: 5_000,
				prompt_tokens: 8000
			}
		],
		generating: [
			{
				request_id: 'g-bg',
				elapsed_seconds: 25,
				startedAt: 4_000,
				generated_tokens: 1200,
				tokens_per_second: 40,
				prompt_tokens: 9000
			}
		],
		waiting: [
			{
				request_id: 'w-bg',
				queue_position: 3,
				elapsed_seconds: 20,
				startedAt: 6_000,
				prompt_tokens: 4000
			}
		]
	};

	it('renders a neutral view without engine tokens for foreign rows before own first token', () => {
		const view = getDisplayView(foreignModel, run(null), null, ctx);
		expect(view.phase).toBe('idle');
		expect(view.prefill).toBeUndefined();
		expect(view.generating).toBeUndefined();
		expect(view.waiting).toBeUndefined();
		expect(getDisplayGenTokens(view)).toBeNull();
		expect(getDisplayPromptTokens(view)).toBeNull();
	});

	it('stays neutral while only foreign rows are busy, even after the first token', () => {
		// Older startedAt marks the rows foreign regardless of firstDeltaAt:
		// no queued #N / prefill NN% / token counts may come from them.
		const view = getDisplayView(foreignModel, run(12_000), null, ctx);
		expect(view.phase).toBe('idle');
		expect(view.waiting).toBeUndefined();
		expect(view.prefill).toBeUndefined();
		expect(getDisplayGenTokens(view)).toBeNull();
		expect(getDisplayPromptTokens(view)).toBeNull();
		// Rate gating unchanged: this neutral view contributes 0 tok/s.
		expect(computeLiveTps(view, run(12_000))).toBe(0);
	});

	it('surfaces own-row tokens once firstDeltaAt is set and rows are claimable', () => {
		const ownRow = {
			request_id: 'own',
			elapsed_seconds: 1,
			startedAt: 10_300,
			generated_tokens: 120,
			tokens_per_second: 38,
			prompt_tokens: 900
		};
		const model = { ...foreignModel, generating: [...foreignModel.generating, ownRow] };
		const claim = claimOwnRequestId(model, run(12_000), null, ctx);
		expect(claim).toBe('own');
		const view = getDisplayView(model, run(12_000), claim, ctx);
		expect(view.phase).toBe('generating');
		expect(view.generating?.request_id).toBe('own');
		expect(view.waiting).toBeUndefined();
		expect(getDisplayGenTokens(view)).toBe(120);
		expect(getDisplayPromptTokens(view)).toBe(900);
	});

	it('returns null tokens for missing views and runs', () => {
		expect(getDisplayView(null, run(12_000), null, ctx).phase).toBe('idle');
		expect(getDisplayView(foreignModel, null, null, ctx).phase).toBe('idle');
		expect(getDisplayGenTokens(null)).toBeNull();
		expect(getDisplayPromptTokens(undefined)).toBeNull();
	});
});

// CR-13 (#R14): cached > prompt is impossible per-turn — a provider emitting a
// session-cumulative cached counter beside a per-turn prompt count (omlx shape)
// must not produce a bogus cache-hit percent or an inflated cached-prompt row.
describe('impossible cache ratio suppressed (CR-13, #R14)', () => {
	// Real omlx usage row: cached_tokens (425938) dwarfs per-turn prompt (45307).
	const omlxUsage = {
		prompt_tokens: 45307,
		completion_tokens: 2226,
		total_tokens: 615849,
		prompt_tokens_details: { cached_tokens: 425938 }
	};

	it('getCacheHitPercent returns null when cached exceeds prompt', () => {
		expect(getCacheHitPercent(omlxUsage)).toBeNull();
		expect(getCacheHitPercent({ prompt_tokens: 800, cached_tokens: 1600 })).toBeNull();
	});

	it('getCacheHitPercent keeps valid ratios (incl. the cached === prompt boundary)', () => {
		expect(
			getCacheHitPercent({ prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 500 } })
		).toBe(50);
		expect(getCacheHitPercent({ prompt_tokens: 800, cached_tokens: 800 })).toBe(100);
		expect(getCacheHitPercent({ prompt_tokens: 300, cached_tokens: 301 })).toBeNull();
	});

	it('message tooltip suppresses Cache hit and Cached tokens rows on cached > prompt', () => {
		const html = formatUsageTooltipHtml(omlxUsage);
		expect(html).not.toContain('Cache hit');
		expect(html).not.toContain('Cached tokens');
		// The valid per-turn rows still render.
		expect(html).toContain('Prompt tokens');
		expect(html).toContain('Completion tokens');
	});

	it('message tooltip keeps cache rows when the ratio is valid', () => {
		const html = formatUsageTooltipHtml({
			prompt_tokens: 1000,
			completion_tokens: 100,
			prompt_tokens_details: { cached_tokens: 500 }
		});
		expect(html).toContain('Cache hit');
		expect(html).toContain('50%');
		expect(html).toContain('Cached tokens');
	});

	it('context ring tooltip suppresses Cache hit and Cached prompt on cached > prompt', () => {
		const html = formatContextTooltipHtml(omlxUsage, { tokens: 47533, threshold: 80000 });
		expect(html).not.toContain('Cache hit');
		expect(html).not.toContain('Cached prompt');
		// The ring's own context row is unaffected.
		expect(html).toContain('Context');
	});

	it('context ring tooltip keeps cache rows when the ratio is valid', () => {
		const html = formatContextTooltipHtml(
			{
				prompt_tokens: 1000,
				completion_tokens: 100,
				prompt_tokens_details: { cached_tokens: 500 }
			},
			{ tokens: 1100, threshold: 80000 }
		);
		expect(html).toContain('Cache hit');
		expect(html).toContain('50%');
		expect(html).toContain('Cached prompt');
	});
});

describe('anonymous-run hygiene — mirror scoping and expiry (#R11)', () => {
	beforeEach(() => {
		endRun();
		currentChatId.set('');
	});
	afterEach(() => {
		endRun();
		currentChatId.set('');
		vi.useRealTimers();
	});

	it("never mirrors another chat's run into the current-chat view", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		beginRun('foreign-msg', 'model-b', null, 'other-chat');
		currentChatId.set('c1');
		expect(get(runStats)).toBeNull();
		beginRun('own-msg', 'model-a', null, 'c1');
		expect(get(runStats)?.messageId).toBe('own-msg');
	});

	it('expires stale anonymous runs instead of adopting them, and keeps fresh ones', () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		beginRun('anon-old', 'model-a', null, '');
		vi.advanceTimersByTime(61_000);
		// a foreign background stream tries to adopt the 61s-old anonymous run
		noteStreamUpdate('foreign-msg', 'hello there', undefined, '');
		expect(get(runs)['anon-old']).toBeUndefined();
		expect(get(runs)['foreign-msg']).toBeUndefined();

		beginRun('anon-fresh', 'model-a', null, '');
		noteStreamUpdate('fresh-msg', 'hello there', undefined, '');
		expect(get(runs)['anon-fresh']).toBeUndefined();
		expect(get(runs)['fresh-msg']?.firstDeltaAt).not.toBeNull();
	});
});
