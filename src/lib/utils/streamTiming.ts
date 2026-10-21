// Local branch: live inference stats helpers (see ChatStats/ChatStatsBar.svelte).
// Pure functions kept out of components so upstream rebase conflicts stay tiny.

export type EnginePrefillRow = {
	request_id?: string;
	processed?: number;
	total?: number;
	speed?: number;
	eta?: number | null;
	elapsed?: number | null;
	prompt_tokens?: number;
	detail?: string;
};

export type EngineGeneratingRow = {
	request_id?: string;
	elapsed_seconds?: number | null;
	generated_tokens?: number;
	tokens_per_second?: number;
	last_activity_age_seconds?: number | null;
	prompt_tokens?: number;
	max_tokens?: number | null;
};

export type EngineWaitingRow = {
	request_id?: string;
	queue_position?: number;
	elapsed_seconds?: number | null;
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

// Prompt cache hit share from a usage payload (OpenAI prompt_tokens_details).
export const getCacheHitPercent = (usage: any): number | null => {
	const cached = usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens ?? null;
	const prompt = usage?.prompt_tokens ?? usage?.input_tokens ?? null;
	if (!cached || !prompt || prompt <= 0) return null;
	return Math.min(100, Math.round((cached / prompt) * 100));
};

// Pretty HTML table for message usage tooltips (local branch: stats).
export const formatUsageTooltipHtml = (usage: any): string => {
	if (!usage || typeof usage !== 'object') return '';
	const rows: Array<[string, string]> = [];
	const num = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);
	const prompt = num(usage.prompt_tokens ?? usage.input_tokens ?? usage.prompt_eval_count);
	const completion = num(usage.completion_tokens ?? usage.output_tokens ?? usage.eval_count);
	const total = num(usage.total_tokens ?? usage.total_generated_tokens);
	const cached = num(usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens);
	const ttft = num(usage.timing?.ttft ?? usage.time_to_first_token);
	const thinking = num(usage.timing?.thinking_time);
	const totalT = num(usage.timing?.total_time ?? usage.total_time);
	const prefillTps = num(usage.prompt_tokens_per_second ?? usage.prompt_eval_per_second);
	const genTps = num(
		(usage.generation_tokens_per_second ??
			usage.completion_tokens_per_second ??
			usage.eval_duration)
			? num(usage.completion_tokens ?? usage.output_tokens) != null && num(usage.eval_duration)
				? ((num(usage.completion_tokens ?? usage.output_tokens) as number) /
						(num(usage.eval_duration) as number)) *
					1_000_000
				: null
			: null
	);
	if (prompt) rows.push(['Prompt tokens', prompt.toLocaleString()]);
	if (completion) rows.push(['Completion tokens', completion.toLocaleString()]);
	if (total) rows.push(['Total tokens', total.toLocaleString()]);
	if (cached) rows.push(['Cached tokens', cached.toLocaleString()]);
	if (cached && prompt)
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
	const tokens = num(usage.estimated_tokens ?? usage.tokens);
	const threshold = num(ctx?.threshold ?? usage.threshold);
	const rawPercent = num(usage.percent);
	const percent =
		rawPercent !== null
			? Math.min(100, Math.max(0, Math.round(rawPercent)))
			: threshold && tokens !== null
				? Math.min(100, Math.max(0, Math.round((tokens / threshold) * 100)))
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
	if (cachedPct !== null) rows.push(['Cache hit', `${Math.round(cachedPct)}%`]);
	const cached = num(
		ctx?.cached ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens
	);
	if (cached !== null && cached > 0) rows.push(['Cached prompt', cached.toLocaleString()]);
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
