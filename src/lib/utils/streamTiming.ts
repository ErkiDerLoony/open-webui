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

// Pick the engine model row matching the running model; fall back to any
// busy/loading model (mirrors the native oMLX chat resolver).
export const resolveEngineModel = (
	activity: EngineActivity | null | undefined,
	modelId: string | null | undefined
): EngineModelActivity | null => {
	const models = activity?.active_models?.models ?? [];
	if (models.length === 0) return null;
	if (modelId) {
		const exact = models.find((m) => m.id === modelId);
		if (exact) return exact;
	}
	const busy = models.find((m) => (m.prefilling?.length ?? 0) + (m.generating?.length ?? 0) > 0);
	if (busy) return busy;
	return models.find((m) => m.is_loading) ?? null;
};

// Claim the engine request id for a run: keep the current claim while still
// active, otherwise take the oldest unclaimed row (native oMLX heuristic).
export const claimRequestId = (
	model: EngineModelActivity | null,
	currentClaim: string | null
): string | null => {
	if (!model) return null;
	const activeIds = [
		...(model.prefilling ?? []).map((r) => r.request_id),
		...(model.generating ?? []).map((r) => r.request_id),
		...(model.waiting ?? []).map((r) => r.request_id)
	].filter((id): id is string => Boolean(id));
	if (currentClaim && activeIds.includes(currentClaim)) return currentClaim;
	return activeIds[0] ?? null;
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
	return null;
};

// Prompt cache hit share from a usage payload (OpenAI prompt_tokens_details).
export const getCacheHitPercent = (usage: any): number | null => {
	const cached = usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens ?? null;
	const prompt = usage?.prompt_tokens ?? usage?.input_tokens ?? null;
	if (!cached || !prompt || prompt <= 0) return null;
	return Math.min(100, Math.round((cached / prompt) * 100));
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
