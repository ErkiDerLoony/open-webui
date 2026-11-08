// Local branch: live inference stats helpers (see ChatStats/ChatStatsBar.svelte).
// Pure functions kept out of components so upstream rebase conflicts stay tiny.

export type EnginePrefillRow = {
	request_id?: string;
	processed?: number;
	total?: number;
	speed?: number;
	eta?: number | null;
	elapsed?: number | null;
	// Absolute epoch-ms when the engine began the request; when absent it is
	// derived from elapsed (see getEngineRowStartedAt).
	startedAt?: number | null;
	// Origin chat when the engine echoes one (future-proofing; rows are
	// connection-global today). See isClaimable.
	chat_id?: string | null;
	// Model id when the engine echoes one on the row (see isClaimable).
	modelId?: string | null;
	prompt_tokens?: number;
	detail?: string;
};

export type EngineGeneratingRow = {
	request_id?: string;
	elapsed_seconds?: number | null;
	generated_tokens?: number;
	tokens_per_second?: number;
	last_activity_age_seconds?: number | null;
	startedAt?: number | null;
	chat_id?: string | null;
	modelId?: string | null;
	prompt_tokens?: number;
	max_tokens?: number | null;
};

export type EngineWaitingRow = {
	request_id?: string;
	queue_position?: number;
	elapsed_seconds?: number | null;
	startedAt?: number | null;
	chat_id?: string | null;
	modelId?: string | null;
	prompt_tokens?: number;
};

export type EngineModelActivity = {
	id: string;
	is_loading?: boolean;
	loaded?: boolean;
	loading_elapsed_seconds?: number | null;
	loading_estimated_seconds?: number | null;
	loading_remaining_seconds_estimate?: number | null;
	estimated_size_formatted?: string | null;
	active_requests?: number;
	waiting_requests?: number;
	prefilling?: EnginePrefillRow[];
	generating?: EngineGeneratingRow[];
	waiting?: EngineWaitingRow[];
	idle_seconds?: number | null;
	ttl_remaining_seconds?: number | null;
};

export type EngineActivity = {
	supported: boolean;
	reason?: string;
	active_models?: {
		models?: EngineModelActivity[];
		total_active_requests?: number;
		total_waiting_requests?: number;
	};
};

export const formatDuration = (seconds: number | null | undefined): string => {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
	if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
	if (seconds < 3600) {
		const m = Math.floor(seconds / 60);
		const s = Math.round(seconds % 60);
		return `${m}m ${s}s`;
	}
	const h = Math.floor(seconds / 3600);
	const m = Math.round((seconds % 3600) / 60);
	return `${h}h ${m}m`;
};

export const formatRate = (tps: number | null | undefined): string => {
	if (!tps || !Number.isFinite(tps)) return '';
	return tps >= 1000 ? `${(tps / 1000).toFixed(1)}k` : `${Math.round(tps)}`;
};

export const formatTokens = (n: number | null | undefined): string => {
	if (n === null || n === undefined || !Number.isFinite(n)) return '';
	if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return `${Math.round(n)}`;
};

// Estimate tokens generated from streamed text before usage data arrives (~4 chars/token).
export const estimateTokensFromText = (text: string): number =>
	Math.max(0, Math.round(text.length / 4));

// #R19: reasoning/thinking text carried by a stream delta — all provider
// aliases (reasoning_content / reasoning / thinking) — or by a relayed
// Responses reasoning event (type + delta). Reasoning deltas ARE generated
// output: first-token/TTFT evidence must count them, not just visible content.
export const getReasoningText = (delta: any): string => {
	if (
		typeof delta?.type === 'string' &&
		(delta.type === 'response.reasoning_text.delta' ||
			delta.type === 'response.reasoning_summary_text.delta')
	) {
		return typeof delta.delta === 'string' ? delta.delta : '';
	}
	return delta?.reasoning_content || delta?.reasoning || delta?.thinking || '';
};

// Defensive shape for the oMLX "loading model is absent from
// active_models.models" case: the model may show up in a separate loading
// list (or as a bare id string) until it is resident.
const asEngineModelRow = (entry: any, fallbackId: string): EngineModelActivity => ({
	...(entry && typeof entry === 'object' ? entry : {}),
	id: typeof entry === 'string' ? entry : (entry?.id ?? fallbackId),
	is_loading: (entry && typeof entry === 'object' ? entry.is_loading : null) ?? true
});

// Pick the engine model row matching the running model; fall back to any
// busy/loading model (mirrors the native oMLX chat resolver).
export const resolveEngineModel = (
	activity: EngineActivity | null | undefined,
	modelId: string | null | undefined
): EngineModelActivity | null => {
	const models = activity?.active_models?.models ?? [];
	if (modelId) {
		const exact = models.find((m) => m.id === modelId);
		if (exact) return exact;
		// A model that is still loading is commonly absent from
		// active_models.models — check the auxiliary loading lists so the
		// chip can show the loading phase instead of falling through to a
		// generic word.
		const loadingLists: any[] = [
			...(Array.isArray((activity as any)?.loading_models) ? (activity as any).loading_models : []),
			...(Array.isArray((activity as any)?.loading) ? (activity as any).loading : [])
		];
		const entry =
			loadingLists.find((e) => (typeof e === 'string' ? e === modelId : e?.id === modelId)) ??
			(loadingLists.length === 1 ? loadingLists[0] : null);
		if (entry) return asEngineModelRow(entry, modelId);
	}
	if (models.length === 0) return null;
	const busy = models.find((m) => (m.prefilling?.length ?? 0) + (m.generating?.length ?? 0) > 0);
	if (busy) return busy;
	return models.find((m) => m.is_loading) ?? null;
};

// Marker prefix for claims made without a real request_id (see claimRequestId).
export const SYNTHETIC_CLAIM_PREFIX = 'engine:positional:';

export type EnginePhase = 'prefilling' | 'generating' | 'waiting' | 'loading' | 'idle';

export type EnginePhaseInfo = {
	phase: EnginePhase;
	prefill?: EnginePrefillRow;
	generating?: EngineGeneratingRow;
	waiting?: EngineWaitingRow;
};

// Best-effort phase for a model row WITHOUT requiring request_id on the rows
// (older/partial oMLX builds omit them). Picks the most informative row
// positionally: prefill wins (highest processed progress), then the newest
// generating row, then the newest waiting row.
export const getEnginePhase = (model: EngineModelActivity | null | undefined): EnginePhaseInfo => {
	if (!model) return { phase: 'idle' };
	const prefill = [...(model.prefilling ?? [])].sort(
		(a, b) => (b.processed ?? 0) - (a.processed ?? 0) || (b.elapsed ?? 0) - (a.elapsed ?? 0)
	)[0];
	if (prefill) return { phase: 'prefilling', prefill };
	const generating = [...(model.generating ?? [])].sort(
		(a, b) => (a.elapsed_seconds ?? 0) - (b.elapsed_seconds ?? 0)
	)[0];
	if (generating) return { phase: 'generating', generating };
	const waiting = [...(model.waiting ?? [])].sort(
		(a, b) => (a.elapsed_seconds ?? 0) - (b.elapsed_seconds ?? 0)
	)[0];
	if (waiting) return { phase: 'waiting', waiting };
	if (model.is_loading) return { phase: 'loading' };
	return { phase: 'idle' };
};

// Claim the engine request id for a run: keep the current claim while still
// active; otherwise claim the NEWEST active request. OWUI fires background
// generations (titles, follow-ups, tags) seconds after every reply, so two
// rows are commonly busy while our own run streams — the current run is the
// one that just started, which makes `min elapsed` a reliable heuristic and
// keeps the chip informative instead of frozen on "starting".
export const claimRequestId = (
	model: EngineModelActivity | null,
	currentClaim: string | null
): string | null => {
	if (!model) return null;
	const allRows = [
		...(model.prefilling ?? []),
		...(model.generating ?? []),
		...(model.waiting ?? [])
	];
	const rows = allRows.filter((r) => Boolean(r.request_id));
	if (currentClaim && rows.some((r) => r.request_id === currentClaim)) return currentClaim;
	// A synthetic claim stays valid while rows still carry no ids; the phase
	// inside it refreshes through getClaimedRequestStats on every poll.
	if (currentClaim?.startsWith(SYNTHETIC_CLAIM_PREFIX) && allRows.length > 0) return currentClaim;
	if (rows.length === 0) {
		// Busy engine whose rows lack request_id: hand back a synthetic claim
		// so consumers resolve a phase positionally instead of falling through
		// to a generic default.
		if (allRows.length === 0) return null;
		return `${SYNTHETIC_CLAIM_PREFIX}${getEnginePhase(model).phase}`;
	}
	if (rows.length === 1) return rows[0].request_id ?? null;
	const elapsedOf = (r: (typeof rows)[number]): number =>
		(r as EngineGeneratingRow).elapsed_seconds ??
		(r as EngineWaitingRow).elapsed_seconds ??
		(r as EnginePrefillRow).elapsed ??
		0;
	const newest = [...rows].sort((a, b) => elapsedOf(a) - elapsedOf(b))[0];
	return newest.request_id ?? null;
};

// Own-run attribution (spec #R11/#R12): the engine activity endpoint is
// connection-global, so a positional pick alone cannot tell our request from
// foreign traffic (title/follow-up background tasks, other chats' streams).
// Evidence required before a row may be claimed for a run:
//  1. before the run's first token a row may bind ONLY as the model's single
//     busy row with start-time evidence not earlier than the run start
//     (chat-status-line.md#R7); two or more concurrent busy rows bind nothing.
//  2. the row started no earlier than the run began (250 ms clock-alignment
//     slack for submit-vs-schedule skew) — a row that predates our run cannot
//     be ours;
//  3. when the row carries a model id, it must be the run's model; when the
//     caller supplies its chat id and the row echoes one, they must match.
//  4. before firstDeltaAt, a row is claimable ONLY IF it has start-time
//     evidence (startedAt or elapsed-derived age), matches model/chat, started
//     no earlier than run.startedAt - 250 ms, AND the model has exactly one
//     busy row total (prevents binding foreign activity). Rows lacking
//     start-time evidence are never bound pre-token.
const CLAIM_START_SLACK_MS = 250;

// Returns true when the engine model has at least one busy row
// (prefill / generate / waiting). Used by the display to suppress the
// "loading model" word when actual activity evidence exists.
export const hasBusyRows = (model: EngineModelActivity | null | undefined): boolean =>
	!!(
		(model?.prefilling?.length ?? 0) +
			(model?.generating?.length ?? 0) +
			(model?.waiting?.length ?? 0) >
		0
	);

export type ClaimRunView = {
	startedAt: number;
	firstDeltaAt: number | null;
	chatId?: string | null;
};

// Shared model/chat matcher extracted from isClaimable — reused by
// withClaimableRows' pre-token path so both code paths share one implementation.
const modelMatchesRow = (
	row: EnginePrefillRow | EngineGeneratingRow | EngineWaitingRow,
	run: ClaimRunView | null | undefined,
	ctx?: { modelId?: string | null; chatId?: string | null }
): boolean => {
	const expectedModel = ctx?.modelId ?? null;
	if (expectedModel && row.modelId != null && row.modelId !== expectedModel) return false;
	const expectedChat = ctx?.chatId ?? run?.chatId ?? null;
	if (expectedChat && row.chat_id != null && row.chat_id !== expectedChat) return false;
	return true;
};

// Absolute epoch-ms a row began. Prefer the engine's own startedAt; else
// derive from its elapsed seconds against the current clock; null when the
// row carries neither.
export const getEngineRowStartedAt = (
	row: EnginePrefillRow | EngineGeneratingRow | EngineWaitingRow | null | undefined,
	now: number = Date.now()
): number | null => {
	if (!row) return null;
	if (typeof row.startedAt === 'number' && Number.isFinite(row.startedAt)) return row.startedAt;
	const elapsedSec =
		(row as EngineGeneratingRow).elapsed_seconds ??
		(row as EngineWaitingRow).elapsed_seconds ??
		(row as EnginePrefillRow).elapsed ??
		null;
	if (elapsedSec === null || !Number.isFinite(elapsedSec) || elapsedSec < 0) return null;
	return now - elapsedSec * 1000;
};

export const isClaimable = (
	row: EnginePrefillRow | EngineGeneratingRow | EngineWaitingRow | null | undefined,
	run: ClaimRunView | null | undefined,
	ctx?: { modelId?: string | null; chatId?: string | null }
): boolean => {
	if (!row || !run) return false;
	if (run.firstDeltaAt === null || run.firstDeltaAt === undefined) return false;
	if (!modelMatchesRow(row, run, ctx)) return false;
	const startedAt = getEngineRowStartedAt(row);
	if (startedAt !== null && startedAt < run.startedAt - CLAIM_START_SLACK_MS) return false;
	return true;
};

// Model narrowed to the rows a run may legitimately claim (isClaimable). The
// synthetic-claim path in claimRequestId keys off row presence, so it keeps
// working on the filtered model.
// Pre-token path (firstDeltaAt null): a row is claimable only if it has
// start-time evidence (startedAt or elapsed), matches model/chat, and the
// model has exactly one busy row total — prevents binding foreign activity.
export const withClaimableRows = (
	model: EngineModelActivity | null | undefined,
	run: ClaimRunView | null | undefined,
	ctx?: { modelId?: string | null; chatId?: string | null }
): EngineModelActivity | null => {
	if (!model) return null;
	const preToken = run?.firstDeltaAt === null || run?.firstDeltaAt === undefined;
	const allRows = [
		...(model.prefilling ?? []),
		...(model.generating ?? []),
		...(model.waiting ?? [])
	];
	const busyTotal = allRows.length;
	const isClaimablePre = (
		r: EnginePrefillRow | EngineGeneratingRow | EngineWaitingRow
	): boolean => {
		const startedAt = getEngineRowStartedAt(r);
		if (startedAt === null || !run) return false;
		if (startedAt < run.startedAt - CLAIM_START_SLACK_MS) return false;
		return modelMatchesRow(r, run, ctx);
	};
	const rowFilter = (r: EnginePrefillRow | EngineGeneratingRow | EngineWaitingRow): boolean =>
		preToken ? busyTotal === 1 && isClaimablePre(r) : isClaimable(r, run, ctx);
	return {
		...model,
		prefilling: (model.prefilling ?? []).filter(rowFilter),
		generating: (model.generating ?? []).filter(rowFilter),
		waiting: (model.waiting ?? []).filter(rowFilter)
	};
};

// Claim for a run: if a claim already exists and its row is still active, keep it;
// otherwise claim the newest active request with matching ownership evidence.
// Pre-token (firstDeltaAt null): claimable model is filtered but no id is
// claimed (returns null); display binds positionally inside the filtered model
// via getDisplayView.
export const claimOwnRequestId = (
	model: EngineModelActivity | null | undefined,
	run: ClaimRunView | null | undefined,
	currentClaim: string | null,
	ctx?: { modelId?: string | null; chatId?: string | null }
): string | null => {
	if (!model || !run) return null;
	const claimable = withClaimableRows(model, run, ctx);
	if (!claimable) return null;
	const allClaimableRows = [
		...(claimable.prefilling ?? []),
		...(claimable.generating ?? []),
		...(claimable.waiting ?? [])
	];
	if (allClaimableRows.length === 0) return null;
	if (run.firstDeltaAt === null || run.firstDeltaAt === undefined) return null;
	return claimRequestId(claimable, currentClaim);
};

// Engine-derived tok/s for the live chip (spec #R12).
// Pre-token: prefill rows report prompt-side speed even before first token
// (the bound prefill row carries the prompt evaluation rate).
// Post-token: decode-side tok/s uses the max of engine/store/client.
export const computeLiveTps = (
	view: { phase?: string; prefill?: EnginePrefillRow; generating?: EngineGeneratingRow } | null,
	run: ClaimRunView | null | undefined,
	storeTps: number = 0,
	clientRate: number = 0
): number => {
	// Prefill speed is the honest rate while the prompt is being eaten —
	// a decode number from a concurrent request would lie on this chip.
	if (view?.phase === 'prefilling') return view.prefill?.speed ?? 0;
	if (!run || run.firstDeltaAt === null || run.firstDeltaAt === undefined) return 0;
	const engine = view?.phase === 'generating' ? (view.generating?.tokens_per_second ?? 0) : 0;
	const rate = Math.max(engine, storeTps, clientRate);
	return rate > 0 ? rate : 0;
};

export type ClaimedRequestStats = {
	phase: 'prefilling' | 'generating' | 'waiting';
	request_id: string;
	prefill?: EnginePrefillRow;
	generating?: EngineGeneratingRow;
	waiting?: EngineWaitingRow;
};

export const getClaimedRequestStats = (
	model: EngineModelActivity | null,
	claimedId: string | null
): ClaimedRequestStats | null => {
	if (!model || !claimedId) return null;
	const generating = (model.generating ?? []).find((r) => r.request_id === claimedId) ?? null;
	if (generating) return { phase: 'generating', request_id: claimedId, generating };
	const prefill = (model.prefilling ?? []).find((r) => r.request_id === claimedId) ?? null;
	if (prefill) return { phase: 'prefilling', request_id: claimedId, prefill };
	const waiting = (model.waiting ?? []).find((r) => r.request_id === claimedId) ?? null;
	if (waiting) return { phase: 'waiting', request_id: claimedId, waiting };
	// Synthetic claim (rows without request_id): resolve positionally so the
	// phase still tracks the engine as it moves prefill → generate.
	if (claimedId.startsWith(SYNTHETIC_CLAIM_PREFIX)) {
		const info = getEnginePhase(model);
		if (info.prefill) return { phase: 'prefilling', request_id: claimedId, prefill: info.prefill };
		if (info.generating)
			return { phase: 'generating', request_id: claimedId, generating: info.generating };
		if (info.waiting) return { phase: 'waiting', request_id: claimedId, waiting: info.waiting };
	}
	return null;
};

// The engine view the live chip renders (spec #R11): built exclusively from
// rows this run may claim. Id-matched claim first; positional pick inside the
// claimable rows for engines that omit request_ids. When nothing is claimable
// — before the run's own first token, or while only foreign rows are busy —
// the view stays neutral (idle, or loading without row payloads), so another
// request's token counts and queued/prefill phase words cannot surface here.
export const getDisplayView = (
	model: EngineModelActivity | null | undefined,
	run: ClaimRunView | null | undefined,
	claimedId: string | null,
	ctx?: { modelId?: string | null; chatId?: string | null }
): EnginePhaseInfo => {
	const claimable = withClaimableRows(model, run, ctx);
	return getClaimedRequestStats(claimable, claimedId) ?? getEnginePhase(claimable);
};

// #R20: display-phase hierarchy for the live chip. A bound engine row's phase
// wins; otherwise the run's own stream evidence names thinking/generating
// (reasoning deltas count as evidence — #R19); the model-loading word is only
// allowed while the run has NO own output yet, so a loading display can never
// shadow a streaming answer; with nothing at all the chip waits neutrally.
export type DisplayPhaseContext = {
	// Engine reports the model not yet resident (loading row / synthesized).
	loadingEvidence: boolean;
	// Phase of a row bound to THIS run ('queued' | 'prefill' | 'thinking' |
	// 'generating' | backend status text); null when nothing is bound.
	claimablePhase: string | null;
	// Epoch-ms of the run's first streamed token (#R19: incl. reasoning).
	firstDeltaAt: number | null;
	// The run's own stream has emitted any output (content or reasoning).
	hasOwnDeltas: boolean;
	// Most recent streamed deltas were reasoning rather than content.
	reasoningActive?: boolean;
};

export const resolveDisplayPhase = (ctx: DisplayPhaseContext): string => {
	if (ctx.claimablePhase) return ctx.claimablePhase;
	if ((ctx.firstDeltaAt !== null && ctx.firstDeltaAt !== undefined) || ctx.hasOwnDeltas) {
		return ctx.reasoningActive === true ? 'thinking' : 'generating';
	}
	if (ctx.loadingEvidence) return 'loading';
	return 'waiting';
};

// Text carried by Responses-style output items (the shape Chat.svelte keeps
// on message.output): 'message' items expose their content-part text (exact
// getOutputText shape from structuredOutput.ts), 'reasoning' items their
// summary-part text (falling back to content parts, as the reasoning renderer
// does). Other item kinds (function calls…) contribute nothing.
const getOutputItemText = (items: any): string => {
	if (!Array.isArray(items)) return '';
	let text = '';
	for (const item of items) {
		let parts: any = null;
		if (item?.type === 'message') {
			parts = item?.content;
		} else if (item?.type === 'reasoning') {
			parts = Array.isArray(item?.summary) && item.summary.length ? item.summary : item?.content;
		}
		if (Array.isArray(parts)) {
			text += parts.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('');
		}
	}
	return text;
};

// #R3 (chat-status-line): single source of truth for "this run has already
// produced its own visible text", covering every channel the waiting/loading
// latch must release on: the run's stamped first delta (#R2 stamps it from any
// content/alias/output-item chunk), the message's content body, reasoning/
// thinking text via the existing getReasoningText aliases (#R19 — never a
// forked alias list), and output-item text on message.output. Callers pass
// their live message; without one the predicate degrades to the run's stamped
// evidence.
export const hasOwnOutputEvidence = (
	message: any,
	run?: { firstDeltaAt?: number | null } | null
): boolean => {
	if (run && run.firstDeltaAt !== null && run.firstDeltaAt !== undefined) return true;
	if (message?.content) return true;
	if (getReasoningText(message).length > 0) return true;
	return getOutputItemText(message?.output).trim().length > 0;
};

// Generated-token count for the chip: engine-reported only from a claimable
// generating row (spec #R11). Null means "no own evidence yet" — callers fall
// back to their client-side estimate or omit the segment; they never render
// another request's counter.
export const getDisplayGenTokens = (view: EnginePhaseInfo | null | undefined): number | null =>
	view?.generating?.generated_tokens ?? null;

// Prompt-token count for the chip from claimable engine rows only (spec #R11);
// null when no own row reports one.
export const getDisplayPromptTokens = (view: EnginePhaseInfo | null | undefined): number | null =>
	view?.prefill?.prompt_tokens ??
	view?.generating?.prompt_tokens ??
	view?.waiting?.prompt_tokens ??
	null;

// Prompt cache hit share from a usage payload (OpenAI prompt_tokens_details).
// #R14: cached > prompt is impossible per-turn — that ratio means the provider
// emitted a session-cumulative cached counter beside a per-turn prompt count
// (omlx-style mismatch), so return null rather than a bogus percentage.
export const getCacheHitPercent = (usage: any): number | null => {
	const cached = usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens ?? null;
	const prompt = usage?.prompt_tokens ?? usage?.input_tokens ?? null;
	if (!cached || !prompt || prompt <= 0) return null;
	if (cached > prompt) return null;
	return Math.min(100, Math.round((cached / prompt) * 100));
};

// Resolve a raw provider duration to milliseconds without trusting its unit.
// Providers disagree: ollama-native prompt_eval_duration/eval_duration are
// nanoseconds, while the oMLX/openai-compatible path supplies seconds (~1.79).
// Candidates ns→µs→s in order; the first candidate that is finite, positive,
// and — when a token count is supplied — implies a plausible token rate
// (≤ 100_000 tok/s) wins. Blind /1e6 math shrinks 1.79s to 1.79e-6 ms and
// yields ~1e13 tok/s garbage; the plausibility guard rejects that scale and
// falls through to the correct one.
export const resolveDurationMs = (
	raw: number | null | undefined,
	tokens?: number | null
): number | null => {
	if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
	const knownTokens = typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0;
	for (const ms of [raw / 1_000_000, raw / 1_000, raw * 1_000]) {
		if (!Number.isFinite(ms) || ms <= 0) continue;
		if (knownTokens) {
			const impliedTps = ((tokens as number) / ms) * 1000;
			if (!Number.isFinite(impliedTps) || impliedTps > 100_000) continue;
		}
		return ms;
	}
	return null;
};

// Pretty HTML table for message usage tooltips (local branch: stats).
export const formatUsageTooltipHtml = (usage: any): string => {
	if (!usage || typeof usage !== 'object') return '';
	const rows: Array<[string, string]> = [];
	const num = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);
	// Derive tok/s from a raw provider phase duration whose unit is unknown
	// (ollama ns vs oMLX s) — resolveDurationMs picks the scale.
	const rateFromDuration = (tokens: number | null, rawDuration: any): number | null => {
		if (tokens === null || tokens <= 0) return null;
		const ms = resolveDurationMs(num(rawDuration), tokens);
		return ms === null ? null : (tokens / ms) * 1000;
	};
	const prompt = num(usage.prompt_tokens ?? usage.input_tokens ?? usage.prompt_eval_count);
	const completion = num(usage.completion_tokens ?? usage.output_tokens ?? usage.eval_count);
	const total = num(usage.total_tokens ?? usage.total_generated_tokens);
	const cached = num(usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens);
	const ttft = num(usage.timing?.ttft ?? usage.time_to_first_token);
	const thinking = num(usage.timing?.thinking_time);
	const totalT = num(usage.timing?.total_time ?? usage.total_time);
	// Backend-provided rates win; only fall back to derived-from-duration.
	const prefillTps =
		num(usage.prompt_tokens_per_second ?? usage.prompt_eval_per_second) ??
		rateFromDuration(prompt, usage.prompt_eval_duration);
	const genTps =
		num(usage.generation_tokens_per_second ?? usage.completion_tokens_per_second) ??
		rateFromDuration(completion, usage.eval_duration);
	if (prompt) rows.push(['Prompt tokens', prompt.toLocaleString()]);
	if (completion) rows.push(['Completion tokens', completion.toLocaleString()]);
	// #R15: cumulative-counter providers (omlx shape) emit a session-wide total
	// beside per-turn sides. When both sides render but the total deviates from
	// their sum by more than 5% (floor 1 token), the two numbers describe
	// different scopes — drop the 'Total tokens' row instead of contradicting
	// the per-turn rows. Sides incomplete → no basis to judge → keep the row.
	const turnSum = prompt && completion ? prompt + completion : null;
	const totalInconsistent =
		turnSum !== null && total !== null && Math.abs(total - turnSum) > Math.max(0.05 * turnSum, 1);
	if (total && !totalInconsistent) rows.push(['Total tokens', total.toLocaleString()]);
	// #R14: cached > prompt is an impossible per-turn ratio (cumulative-vs-
	// per-turn provider mismatch) — suppress the cache rows instead of showing
	// a bogus hit percentage or an inflated cached count.
	const cacheImpossible = cached !== null && prompt !== null && cached > prompt;
	if (cached && !cacheImpossible) rows.push(['Cached tokens', cached.toLocaleString()]);
	if (cached && prompt && !cacheImpossible)
		rows.push(['Cache hit', `${Math.min(100, Math.round((cached / prompt) * 100))}%`]);
	if (ttft !== null && ttft > 0) rows.push(['Time to first token', formatDuration(ttft)]);
	if (thinking !== null && thinking > 0) rows.push(['Thinking time', formatDuration(thinking)]);
	if (totalT !== null && totalT > 0) rows.push(['Total time', formatDuration(totalT)]);
	if (prefillTps) rows.push(['Prefill speed', `${formatRate(prefillTps)} tok/s`]);
	if (genTps) rows.push(['Decode speed', `${formatRate(genTps)} tok/s`]);
	if (rows.length === 0) return '';
	const body = rows
		.map(
			([k, v]) =>
				`<tr><td style="padding:1px 14px 1px 0;opacity:.7">${k}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${v}</td></tr>`
		)
		.join('');
	return `<table style="border-collapse:collapse;font-size:11px">${body}</table>`;
};

// Rich tooltip for the composer context ring (local branch: stats). Same
// table styling as formatUsageTooltipHtml; every row is omitted when its
// data is absent. ctx carries what the ring knows beyond the usage payload:
// the effective truncation window, cache hits from the last reported usage,
// and whether the numbers are engine-measured or client-estimated.
export const formatContextTooltipHtml = (
	usage: any,
	ctx?: {
		tokens?: number | null;
		threshold?: number | null;
		cached?: number | null;
		prompt?: number | null;
		cachedPct?: number | null;
		source?: string | null;
	}
): string => {
	if (!usage || typeof usage !== 'object') return '';
	const rows: Array<[string, string]> = [];
	const num = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);
	// ctx.tokens/threshold are the ring's own numerator/denominator pair; when
	// the caller supplies them the tooltip recomputes percent from that exact
	// pair so fill and tooltip can never disagree (spec #R6). usage.percent is
	// only a fallback when the pair is incomplete.
	const tokens = num(ctx?.tokens) ?? num(usage.estimated_tokens ?? usage.tokens);
	const threshold = num(ctx?.threshold) ?? num(usage.threshold);
	const rawPercent = num(usage.percent);
	const percent =
		tokens !== null && threshold !== null && threshold > 0
			? Math.min(100, Math.max(0, Math.round((tokens / threshold) * 100)))
			: rawPercent !== null
				? Math.min(100, Math.max(0, Math.round(rawPercent)))
				: null;
	// Matches ContextRing's color escalation (gray / emerald / amber / red).
	const dotColor =
		percent === null
			? '#d1d5db'
			: percent >= 90
				? '#ef4444'
				: percent >= 70
					? '#f59e0b'
					: '#10b981';
	const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${dotColor};margin-right:6px"></span>`;
	if (tokens !== null || threshold !== null || percent !== null) {
		let value = `${dot}${formatTokens(tokens)}`;
		if (threshold !== null) value += ` / ${formatTokens(threshold)}`;
		if (percent !== null) value += ` (${percent}%)`;
		rows.push(['Context', value]);
	}
	if (threshold !== null && tokens !== null && threshold > tokens)
		rows.push(['Remaining', `${formatTokens(threshold - tokens)} before truncation`]);
	const source = ctx?.source ?? usage.source ?? null;
	if (typeof source === 'string' && source)
		rows.push(['Source', source === 'estimated' ? 'estimated' : 'measured']);
	const cachedPct = num(ctx?.cachedPct) ?? getCacheHitPercent(usage);
	const cached = num(
		ctx?.cached ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens
	);
	const promptTokens = num(ctx?.prompt ?? usage.prompt_tokens ?? usage.input_tokens);
	// #R14: cached > prompt is an impossible per-turn ratio (cumulative-vs-
	// per-turn provider mismatch, e.g. omlx) — suppress the cache rows instead
	// of showing a bogus hit percentage or an inflated cached count.
	const cacheImpossible =
		cached !== null &&
		cached > 0 &&
		promptTokens !== null &&
		promptTokens > 0 &&
		cached > promptTokens;
	if (cachedPct !== null && !cacheImpossible) rows.push(['Cache hit', `${Math.round(cachedPct)}%`]);
	if (cached !== null && cached > 0 && !cacheImpossible)
		rows.push(['Cached prompt', cached.toLocaleString()]);
	if (rows.length === 0) return '';
	const body = rows
		.map(
			([k, v]) =>
				`<tr><td style="padding:1px 14px 1px 0;opacity:.7">${k}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${v}</td></tr>`
		)
		.join('');
	return `<table style="border-collapse:collapse;font-size:11px">${body}</table>`;
};

// Breakdown of the current context from a usage payload.
export const getContextBreakdown = (
	usage: any
): { prompt: number; completion: number; cached: number } | null => {
	const prompt = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
	const completion = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
	const cached = usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens ?? 0;
	if (!prompt && !completion) return null;
	return { prompt, completion, cached };
};
