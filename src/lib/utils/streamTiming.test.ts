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
// produced its first token; decode-side tok/s stays zero pre-token,
// and a bound prefill row's prompt-side speed is exempt (chat-status-line.md#R9).
// WP-R11-DISPLAY appends CR-11 (#R11): the chip's display selectors are built
// from claimable-filtered rows, so foreign busy rows leak neither token counts
// nor queued/prefill phase words.
// WP-NUMERATOR appends CR-13 (#R14): cached > prompt is an impossible per-turn
// ratio (cumulative-vs-per-turn provider mismatch) — cache-hit percent and the
// cached-prompt tooltip rows are suppressed rather than shown bogus.
// WP-POLISH appends CR-14 (#R15): a provider total deviating from the per-turn
// prompt+completion sum by >5% is the cumulative-counter shape — the 'Total
// tokens' tooltip row is suppressed instead of shown beside per-turn counts.
// WP-PHASE appends CR-17 (#R19): reasoning/thinking deltas are generated
// tokens — firstDeltaAt must stamp on reasoning-only chunks (store-level rows
// live here) — and CR-18 (#R20): resolveDisplayPhase hierarchy, own-stream
// evidence outranks the model-loading word.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
	claimOwnRequestId,
	computeLiveTps,
	formatContextTooltipHtml,
	formatDuration,
	formatUsageTooltipHtml,
	getCacheHitPercent,
	getDisplayGenTokens,
	getDisplayPromptTokens,
	getDisplayView,
	getReasoningText,
	hasBusyRows,
	hasOwnOutputEvidence,
	isClaimable,
	resolveDisplayPhase,
	resolveDurationMs,
	withClaimableRows
} from './streamTiming';
import {
	applyStream,
	beginRun,
	currentChatId,
	endRun,
	needsRunRehydration,
	noteStatus,
	noteStep,
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
// attribution requires ownership evidence; decode-side tok/s stays zero
// pre-token, but a bound prefill row's prompt-side speed is exempt (#R9).
describe('own-run engine attribution — isClaimable (CR-09, #R11)', () => {
	const run = (over: Partial<RunStats> = {}): RunStats =>
		({
			messageId: 'm1',
			chatId: 'c1',
			modelId: 'model-a',
			urlIdx: null,
			startedAt: 10_000,
			firstDeltaAt: 12_000,
			lastDeltaWasReasoning: false,
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

	it('claimOwnRequestId: pre-token binds positionally via the filtered view but never claims the request id', () => {
		const model = {
			id: 'model-a',
			generating: [
				{ request_id: 'foreign', elapsed_seconds: 10, startedAt: 5_000, tokens_per_second: 40 },
				{ request_id: 'own', elapsed_seconds: 1, startedAt: 10_300, tokens_per_second: 38 }
			]
		};
		const singleModel = { id: 'model-a', generating: [model.generating[1]] };
		// post-first-token: the foreign older row is filtered out
		expect(claimOwnRequestId(model, run(), null, ctx)).toBe('own');
		// pre-token with one row → claimable model has the row; with two rows → single-busy-row rule blocks
		expect(claimOwnRequestId(singleModel, run({ firstDeltaAt: null }), null, ctx)).toBeNull();
		expect(claimOwnRequestId(model, run({ firstDeltaAt: null }), null, ctx)).toBeNull();
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
			lastDeltaWasReasoning: false,
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

	it('returns prefill speed (not 0) when bound to a prefill row before first token (LP-05)', () => {
		expect(computeLiveTps({ phase: 'prefilling', prefill: { speed: 900 } }, run(null))).toBe(900);
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
		// first token still renders 0 even with non-zero client inputs (decode-side).
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
			lastDeltaWasReasoning: false,
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

// CR-14 (#R15): a provider total deviating from the per-turn sides sum by >5%
// is the cumulative-counter shape (omlx) — the tooltip suppresses the
// 'Total tokens' row instead of presenting an inconsistent total beside per-turn
// counts. With per-turn sides missing there is no basis to judge; it stays.
describe('inconsistent total row suppressed (CR-14, #R15)', () => {
	// Real omlx usage row: total (615849) is session-cumulative, far off the
	// per-turn sum 45307 + 2226 = 47533.
	it('omlx cumulative total hides the Total tokens row but keeps per-turn rows', () => {
		const html = formatUsageTooltipHtml({
			prompt_tokens: 45307,
			completion_tokens: 2226,
			total_tokens: 615849
		});
		expect(html).toContain('Prompt tokens');
		expect(html).toContain('Completion tokens');
		expect(html).not.toContain('Total tokens');
	});

	it('consistent total (within 5%) keeps the Total tokens row', () => {
		const html = formatUsageTooltipHtml({
			prompt_tokens: 100,
			completion_tokens: 50,
			total_tokens: 150
		});
		expect(html).toContain('Total tokens');
	});

	it('total without per-turn sides stays — no basis to judge', () => {
		expect(formatUsageTooltipHtml({ total_tokens: 500 })).toContain('Total tokens');
	});

	it('boundary: exact sum keeps the row, >5% deviation suppresses it', () => {
		// |1050 − (1000+50)| = 0 → consistent.
		expect(
			formatUsageTooltipHtml({ prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 })
		).toContain('Total tokens');
		// |1200 − (1000+50)| = 150 > max(0.05·1050, 1) = 52.5 → suppressed.
		expect(
			formatUsageTooltipHtml({ prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1200 })
		).not.toContain('Total tokens');
	});
});

// WP-RELOAD appends CR-16 (#R18): reloading a chat mid-generation must
// reconstruct the in-flight run so the stats line survives. The pure
// rehydration predicate is store-side (generationStats), verified here
// alongside beginRun's opts.startedAt override (persisted timestamp path).
describe('run rehydration predicate — needsRunRehydration (CR-16, #R18)', () => {
	it('true for an undone assistant message with partial content', () => {
		expect(needsRunRehydration({ role: 'assistant', content: 'half a t', done: false })).toBe(true);
	});

	it('true for an undone assistant with no content yet (pre-first-token)', () => {
		expect(needsRunRehydration({ role: 'assistant', content: '', done: false })).toBe(true);
		expect(needsRunRehydration({ role: 'assistant' })).toBe(true);
	});

	it('false for a done assistant message', () => {
		expect(needsRunRehydration({ role: 'assistant', content: 'full', done: true })).toBe(false);
	});

	it('false for a user message', () => {
		expect(needsRunRehydration({ role: 'user', content: 'hi', done: false })).toBe(false);
	});

	it('false for null/undefined message', () => {
		expect(needsRunRehydration(null)).toBe(false);
		expect(needsRunRehydration(undefined)).toBe(false);
	});

	it('false for an assistant message carrying an error', () => {
		expect(
			needsRunRehydration({ role: 'assistant', content: 'half', done: false, error: 'boom' })
		).toBe(false);
	});
});

describe('beginRun startedAt override (CR-16, #R18)', () => {
	beforeEach(() => {
		endRun();
		currentChatId.set('');
	});
	afterEach(() => {
		endRun();
		currentChatId.set('');
		vi.useRealTimers();
	});

	it('honours opts.startedAt so a rehydrated run carries the persisted start', () => {
		vi.useFakeTimers();
		vi.setSystemTime(50_000);
		beginRun('m1', 'model-a', null, 'c1', { startedAt: 20_000 });
		const run = get(runs)['m1'];
		expect(run?.startedAt).toBe(20_000);
		expect(run?.firstDeltaAt).toBeNull();
		expect(run?.chatId).toBe('c1');
	});

	it('falls back to Date.now() without a usable override', () => {
		vi.useFakeTimers();
		vi.setSystemTime(50_000);
		beginRun('m2', 'model-a', null, 'c1');
		expect(get(runs)['m2']?.startedAt).toBe(50_000);
		beginRun('m3', 'model-a', null, 'c1', {});
		expect(get(runs)['m3']?.startedAt).toBe(50_000);
		beginRun('m4', 'model-a', null, 'c1', { startedAt: Number.NaN });
		expect(get(runs)['m4']?.startedAt).toBe(50_000);
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

// CR-17 (#R19): reasoning/thinking deltas are generated output. A chunk that
// carries only reasoning — the deepseek/omlx shape of content:'' beside
// reasoning_content — must still stamp firstDeltaAt on the run (the backend
// ttft mark mirrors this condition in middleware.py).
describe('reasoning deltas count as first token — applyStream/noteStreamUpdate (CR-17, #R19)', () => {
	beforeEach(() => {
		endRun();
		currentChatId.set('');
	});
	afterEach(() => {
		endRun();
		currentChatId.set('');
	});

	it('noteStreamUpdate stamps firstDeltaAt on a reasoning_content-only delta', () => {
		beginRun('m1', 'model-a', null, 'c1');
		noteStreamUpdate('m1', '', undefined, 'c1', { reasoning_content: 'pondering' });
		expect(get(runs)['m1']?.firstDeltaAt).not.toBeNull();
	});

	it("explicit empty content beside non-empty reasoning still counts ('' must not mask)", () => {
		beginRun('m2', 'model-a', null, 'c1');
		noteStreamUpdate('m2', '', undefined, 'c1', { content: '', reasoning_content: 'x' });
		expect(get(runs)['m2']?.firstDeltaAt).not.toBeNull();
	});

	it('reasoning aliases (reasoning, thinking) and a plain string delta count too', () => {
		beginRun('m3', 'model-a', null, 'c1');
		noteStreamUpdate('m3', '', undefined, 'c1', { reasoning: 'x' });
		expect(get(runs)['m3']?.firstDeltaAt).not.toBeNull();
		beginRun('m4', 'model-a', null, 'c1');
		noteStreamUpdate('m4', '', undefined, 'c1', { thinking: 'x' });
		expect(get(runs)['m4']?.firstDeltaAt).not.toBeNull();
		beginRun('m5', 'model-a', null, 'c1');
		noteStreamUpdate('m5', '', undefined, 'c1', 'x');
		expect(get(runs)['m5']?.firstDeltaAt).not.toBeNull();
	});

	it('relayed Responses reasoning events count as evidence', () => {
		beginRun('m6', 'model-a', null, 'c1');
		noteStreamUpdate('m6', '', undefined, 'c1', {
			type: 'response.reasoning_text.delta',
			delta: 'hmm'
		});
		expect(get(runs)['m6']?.firstDeltaAt).not.toBeNull();
	});

	it('no evidence (empty content, empty reasoning) leaves firstDeltaAt null', () => {
		beginRun('m7', 'model-a', null, 'c1');
		noteStreamUpdate('m7', '', undefined, 'c1', { content: '', reasoning_content: '' });
		expect(get(runs)['m7']?.firstDeltaAt).toBeNull();
	});

	it('getReasoningText extracts every alias plus relayed event shapes', () => {
		expect(getReasoningText({ reasoning_content: 'a' })).toBe('a');
		expect(getReasoningText({ reasoning: 'b' })).toBe('b');
		expect(getReasoningText({ thinking: 'c' })).toBe('c');
		expect(getReasoningText({ type: 'response.reasoning_summary_text.delta', delta: 'd' })).toBe(
			'd'
		);
		expect(getReasoningText({ content: 'visible' })).toBe('');
		expect(getReasoningText(undefined)).toBe('');
	});

	it('applyStream flags reasoning-only flow and clears the flag once content flows', () => {
		const entry: RunStats = {
			messageId: 'm8',
			chatId: 'c1',
			modelId: 'model-a',
			urlIdx: null,
			startedAt: 1,
			firstDeltaAt: null,
			lastDeltaWasReasoning: false,
			estTokens: 0,
			usage: null,
			step: null,
			steps: [],
			claimedRequestId: null,
			context: null,
			contextThreshold: null,
			engineActivity: null
		};
		const thinking = applyStream(entry, 'm8', '', undefined, 'c1', { reasoning_content: 'x' });
		expect(thinking.firstDeltaAt).not.toBeNull();
		expect(thinking.lastDeltaWasReasoning).toBe(true);
		const answering = applyStream(thinking, 'm8', 'visible', undefined, 'c1', {
			content: 'visible'
		});
		expect(answering.lastDeltaWasReasoning).toBe(false);
	});
});

// CR-18 (#R20): the chip's display-phase hierarchy. A bound row's phase wins;
// own-stream evidence outranks the model-loading word (firstDeltaAt set —
// including via reasoning deltas per #R19 — must never show 'loading');
// loading only before any own output; nothing known waits neutrally.
describe('display phase hierarchy — resolveDisplayPhase (CR-18, #R20)', () => {
	it('bound row phase wins over loading and own evidence', () => {
		expect(
			resolveDisplayPhase({
				loadingEvidence: true,
				claimablePhase: 'prefill',
				firstDeltaAt: 1234,
				hasOwnDeltas: true
			})
		).toBe('prefill');
		expect(
			resolveDisplayPhase({
				loadingEvidence: false,
				claimablePhase: 'queued',
				firstDeltaAt: null,
				hasOwnDeltas: false
			})
		).toBe('queued');
	});

	it('own first token with reasoning active reads thinking, never loading', () => {
		expect(
			resolveDisplayPhase({
				loadingEvidence: true,
				claimablePhase: null,
				firstDeltaAt: 1234,
				hasOwnDeltas: true,
				reasoningActive: true
			})
		).toBe('thinking');
	});

	it('own first token without reasoning reads generating', () => {
		expect(
			resolveDisplayPhase({
				loadingEvidence: true,
				claimablePhase: null,
				firstDeltaAt: 1234,
				hasOwnDeltas: true
			})
		).toBe('generating');
	});

	it('model-loading phase only with loading evidence and no own output yet', () => {
		expect(
			resolveDisplayPhase({
				loadingEvidence: true,
				claimablePhase: null,
				firstDeltaAt: null,
				hasOwnDeltas: false
			})
		).toBe('loading');
	});

	it('nothing at all waits for the model', () => {
		expect(
			resolveDisplayPhase({
				loadingEvidence: false,
				claimablePhase: null,
				firstDeltaAt: null,
				hasOwnDeltas: false
			})
		).toBe('waiting');
	});
});

// WP-STAT1 (.opencode/specs/chat-status-line.md #R1-#R4): the waiting latch
// must release once the run's own streamed text shows on ANY channel — the
// content body, reasoning-alias deltas, or output items — not content alone.
// CS-01/CS-02 pin the shared predicate plus phase resolution, CS-04 the
// store-side first-delta stamping, and the cold-start rows guard #R4/CS-05.
describe('status-line evidence (CS-01/CS-02/CS-04, #R1-#R4)', () => {
	beforeEach(() => {
		endRun();
		currentChatId.set('');
	});
	afterEach(() => {
		endRun();
		currentChatId.set('');
	});

	const reasoningAliases = [
		{ reasoning_content: 'pondering' },
		{ reasoning: 'pondering' },
		{ thinking: 'pondering' }
	];
	const messageItem = (text: string) => ({
		type: 'message',
		content: [{ type: 'output_text', text }]
	});
	const reasoningItem = (text: string) => ({
		type: 'reasoning',
		summary: [{ type: 'summary_text', text }]
	});
	const freshEntry = (): RunStats =>
		({
			messageId: 'm1',
			chatId: 'c1',
			modelId: 'model-a',
			urlIdx: null,
			startedAt: 10_000,
			firstDeltaAt: null,
			lastDeltaWasReasoning: false,
			estTokens: 0,
			usage: null,
			step: null,
			steps: [],
			claimedRequestId: null,
			context: null,
			contextThreshold: null,
			engineActivity: null
		}) as RunStats;

	// CS-01 (#R1/#R3): thoughts-only output — empty content, thinking text on
	// each getReasoningText alias — is own-text evidence…
	it('CS-01: hasOwnOutputEvidence true for each reasoning alias', () => {
		for (const alias of reasoningAliases) {
			expect(hasOwnOutputEvidence({ content: '', ...alias }, null)).toBe(true);
		}
		// …and the relayed Responses reasoning shape carries evidence too.
		expect(
			hasOwnOutputEvidence(
				{ content: '', type: 'response.reasoning_text.delta', delta: 'hmm' },
				null
			)
		).toBe(true);
	});

	it('CS-01: resolveDisplayPhase with reasoning evidence never returns waiting', () => {
		for (const alias of reasoningAliases) {
			const hasOwnDeltas = hasOwnOutputEvidence({ content: '', ...alias }, null);
			expect(hasOwnDeltas).toBe(true);
			// No loading evidence in play: the word is thinking, not waiting.
			expect(
				resolveDisplayPhase({
					loadingEvidence: false,
					claimablePhase: null,
					firstDeltaAt: null,
					hasOwnDeltas,
					reasoningActive: true
				})
			).toBe('thinking');
			// Even with the model still loading, own text outranks the loading word.
			expect(
				resolveDisplayPhase({
					loadingEvidence: true,
					claimablePhase: null,
					firstDeltaAt: null,
					hasOwnDeltas,
					reasoningActive: true
				})
			).toBe('thinking');
		}
	});

	// CS-02 (#R3): output-item text (the shape Chat.svelte keeps on
	// message.output) counts with content still empty.
	it('CS-02: hasOwnOutputEvidence true for output-item-text-only messages', () => {
		expect(hasOwnOutputEvidence({ content: '', output: [messageItem('streamed')] }, null)).toBe(
			true
		);
		// Reasoning items carry the on-screen thoughts in their summary parts.
		expect(hasOwnOutputEvidence({ content: '', output: [reasoningItem('hmm')] }, null)).toBe(true);
		expect(
			resolveDisplayPhase({
				loadingEvidence: false,
				claimablePhase: null,
				firstDeltaAt: null,
				hasOwnDeltas: hasOwnOutputEvidence({ content: '', output: [messageItem('x')] }, null)
			})
		).toBe('generating');
	});

	it('predicate false without any own-text channel; stamped run counts as recorded evidence', () => {
		expect(hasOwnOutputEvidence(null, null)).toBe(false);
		expect(hasOwnOutputEvidence(undefined, undefined)).toBe(false);
		expect(hasOwnOutputEvidence({ content: '' }, null)).toBe(false);
		expect(hasOwnOutputEvidence({ output: [] }, null)).toBe(false);
		// Function-call items carry no text of their own.
		expect(
			hasOwnOutputEvidence({ content: '', output: [{ type: 'function_call', name: 'x' }] }, null)
		).toBe(false);
		// Whitespace-only item text matches getOutputText's trim filter.
		expect(hasOwnOutputEvidence({ content: '', output: [messageItem('   ')] }, null)).toBe(false);
		// A stamped first delta is recorded output evidence (#R2).
		expect(hasOwnOutputEvidence({ content: '' }, { firstDeltaAt: 12_000 })).toBe(true);
	});

	// CS-04 (#R2): stamping covers ANY delta carrying text — alias fields…
	it('CS-04: applyStream stamps firstDeltaAt on reasoning-alias-only deltas', () => {
		for (const alias of reasoningAliases) {
			expect(
				applyStream(freshEntry(), 'm1', '', undefined, 'c1', alias).firstDeltaAt
			).not.toBeNull();
		}
	});

	// …and the new channel: chunks carrying only output-item text (WS-bridge /
	// relayed structured-output payloads).
	it('CS-04: applyStream stamps on output-item-only chunks (#R2 new channel)', () => {
		expect(
			applyStream(freshEntry(), 'm1', '', undefined, 'c1', {
				content: '',
				output: [messageItem('streamed')]
			}).firstDeltaAt
		).not.toBeNull();
		expect(
			applyStream(freshEntry(), 'm1', '', undefined, 'c1', {
				content: '',
				output: [reasoningItem('hmm')]
			}).firstDeltaAt
		).not.toBeNull();
		// Without any text the stamp stays off (no evidence to latch on).
		expect(
			applyStream(freshEntry(), 'm1', '', undefined, 'c1', {
				content: '',
				output: [{ type: 'function_call', name: 'x' }]
			}).firstDeltaAt
		).toBeNull();
	});

	it('status/step events never stamp firstDeltaAt (not output tokens)', () => {
		beginRun('m1', 'model-a', null, 'c1');
		noteStatus('m1', { description: 'searching the web', action: 'search' });
		noteStep('m1', 'thinking', 'reasoning');
		expect(get(runs)['m1']?.firstDeltaAt).toBeNull();
	});

	// CS-05 guard (#R4): with no evidence on any channel the cold-start words
	// still render — the predicate must not short-circuit them.
	it('cold start unchanged: no evidence anywhere still resolves to waiting', () => {
		const message = { content: '', output: [] };
		expect(hasOwnOutputEvidence(message, { firstDeltaAt: null })).toBe(false);
		expect(
			resolveDisplayPhase({
				loadingEvidence: false,
				claimablePhase: null,
				firstDeltaAt: null,
				hasOwnDeltas: false
			})
		).toBe('waiting');
		expect(
			resolveDisplayPhase({
				loadingEvidence: true,
				claimablePhase: null,
				firstDeltaAt: null,
				hasOwnDeltas: false
			})
		).toBe('loading');
	});
});

// LP-01..LP-06: own-row pre-token binding. Before firstDeltaAt, the engine
// view must still reflect a single busy row whose start-time is evidenced
// (startedAt or elapsed-derived), matches model/chat, and is not earlier than
// the run start minus 250 ms. Multiple busy rows or rows lacking age evidence
// stay unbound so foreign activity never leaks into the chip.
describe('own-row pre-token binding (LP-01..LP-06)', () => {
	const run = (over: Partial<RunStats> = {}): RunStats =>
		({
			messageId: 'm1',
			chatId: 'c1',
			modelId: 'model-a',
			urlIdx: null,
			startedAt: 10_000,
			firstDeltaAt: null,
			lastDeltaWasReasoning: false,
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

	// LP-01: single prefill row with valid startedAt → claimed
	it('LP-01: single prefill row with startedAt=run.startedAt+100 is claimable before first token', () => {
		const model = {
			id: 'model-a',
			prefilling: [
				{
					request_id: 'p1',
					processed: 500,
					total: 8000,
					speed: 900,
					elapsed: 0.1,
					startedAt: 10_100,
					prompt_tokens: 8000
				}
			]
		};
		const view = getDisplayView(model, run(), null, ctx);
		expect(view.phase).toBe('prefilling');
		expect(view.prefill?.request_id).toBe('p1');
		// computeLiveTps should return the prefill speed even before first token
		expect(computeLiveTps(view, run(), 0, 0)).toBe(900);
	});

	// LP-02: row that predates the run beyond slack → not claimable
	it('LP-02: row with startedAt=run.startedAt-5000 (predates run) is not claimable pre-token', () => {
		const model = {
			id: 'model-a',
			prefilling: [
				{
					request_id: 'p2',
					processed: 500,
					total: 8000,
					speed: 900,
					elapsed: 5,
					startedAt: 5_000,
					prompt_tokens: 8000
				}
			]
		};
		const view = getDisplayView(model, run(), null, ctx);
		expect(view.phase).not.toBe('prefilling');
		expect(computeLiveTps(view, run(), 0, 0)).toBe(0);
	});

	// LP-03: two busy rows → single-busy-row rule blocks binding
	it('LP-03: pre-token with TWO busy rows (prefill+generating) → nothing claimable', () => {
		const model = {
			id: 'model-a',
			prefilling: [
				{
					request_id: 'p3a',
					processed: 500,
					total: 8000,
					speed: 900,
					elapsed: 0.1,
					startedAt: 10_100,
					prompt_tokens: 8000
				}
			],
			generating: [
				{
					request_id: 'p3b',
					elapsed_seconds: 0.2,
					generated_tokens: 10,
					tokens_per_second: 50,
					startedAt: 10_200,
					prompt_tokens: 8000
				}
			]
		};
		const view = getDisplayView(model, run(), null, ctx);
		expect(view.phase).not.toBe('prefilling');
		expect(computeLiveTps(view, run(), 0, 0)).toBe(0);
	});

	// LP-04: row without age evidence → not claimable pre-token + hasBusyRows predicate
	it('LP-04: single pre-token row without age evidence is not claimable; hasBusyRows works', () => {
		const model = {
			id: 'model-a',
			is_loading: true,
			prefilling: [{ request_id: 'p4', processed: 500, total: 8000, speed: 900 }]
		};
		// no startedAt, no elapsed → pre-token path requires age evidence
		const view = getDisplayView(model, run(), null, ctx);
		expect(view.phase).not.toBe('prefilling');
		// hasBusyRows should be true for a populated model
		expect(hasBusyRows(model)).toBe(true);
		expect(hasBusyRows(null)).toBe(false);
		expect(hasBusyRows(undefined)).toBe(false);
	});

	// LP-05: computeLiveTps prefill/generating before and after first token
	it('LP-05: computeLiveTps prefill view (speed 900) + null firstDeltaAt → 900', () => {
		const prefillView = { phase: 'prefilling', prefill: { speed: 900 } };
		expect(computeLiveTps(prefillView, run({ firstDeltaAt: null }), 0, 0)).toBe(900);
	});

	it('LP-05: generating view (tps 80) + null firstDeltaAt → 0 (decode-side gated)', () => {
		const genView = { phase: 'generating', generating: { tokens_per_second: 80 } };
		expect(computeLiveTps(genView, run({ firstDeltaAt: null }), 0, 0)).toBe(0);
	});

	it('LP-05: run with firstDeltaAt set + generating view → 80', () => {
		const genView = { phase: 'generating', generating: { tokens_per_second: 80 } };
		expect(computeLiveTps(genView, run({ firstDeltaAt: 12_000 }), 0, 0)).toBe(80);
	});

	// LP-06: row.modelId mismatch → not claimable pre-token
	it('LP-06: single pre-token row with mismatched modelId is not claimable', () => {
		const model = {
			id: 'model-a',
			prefilling: [
				{
					request_id: 'p6',
					processed: 500,
					total: 8000,
					speed: 900,
					elapsed: 0.1,
					startedAt: 10_100,
					modelId: 'other-model',
					prompt_tokens: 8000
				}
			]
		};
		const view = getDisplayView(model, run(), null, ctx);
		expect(view.phase).not.toBe('prefilling');
		expect(computeLiveTps(view, run(), 0, 0)).toBe(0);
	});
});

// WP-SECS1: no sub-second precision in any displayed time — chip/timeline
// durations render whole seconds only, rounded up (Math.ceil, house style
// of MessageRunStats' `~${Math.ceil(eta)}s`).
describe('formatDuration whole-second precision', () => {
	it('rounds sub-10s durations up to whole seconds (exact strings)', () => {
		expect(formatDuration(0)).toBe('0s');
		expect(formatDuration(0.2)).toBe('1s');
		expect(formatDuration(3.74)).toBe('4s');
		expect(formatDuration(9.99)).toBe('10s');
	});

	it('never emits a decimal point across all branches', () => {
		for (const v of [0, 0.2, 3.74, 9.99, 10.4, 59.2, 61.6, 3601.4]) {
			expect(formatDuration(v)).not.toContain('.');
		}
	});
});
