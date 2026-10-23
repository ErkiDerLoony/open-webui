// Shared context-usage computation for the composer context ring
// (spec: .opencode/specs/context-ring-usage.md). One implementation used by
// both Chat.svelte and MessageInput.svelte (#R7) so the ring, its tooltip and
// the run-stats snapshot never diverge.

export type UsageBlob = Record<string, unknown> | null | undefined;

export interface ContextUsageResult {
	tokens: number;
	estimated_tokens: number;
	threshold: number | null;
	denominator: number | null;
	percent: number | null;
	source: string;
}

// Presence check for provider usage fields: value 0 is PRESENT (#R3) — the old
// `||` chains treated numeric 0 as missing and fell through the precedence
// chain, corrupting checkpoint totals.
const hasUsageField = (usage: UsageBlob, key: string): boolean => {
	if (!usage || typeof usage !== 'object') return false;
	const value = usage[key];
	return value !== null && value !== undefined && Number.isFinite(Number(value));
};

const numUsageField = (usage: UsageBlob, key: string): number => {
	const value = usage?.[key];
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

const firstPresentField = (usage: UsageBlob, keys: string[]): number | null => {
	for (const key of keys) {
		if (hasUsageField(usage, key)) return numUsageField(usage, key);
	}
	return null;
};

// True when the usage blob reports any prompt-side token count (#R2/#R3).
// A block with only completion/output fields (e.g. {completion_tokens: 650})
// is NOT a context checkpoint: it says nothing about prior history.
export const hasPromptSideUsage = (usage: UsageBlob): boolean =>
	hasUsageField(usage, 'prompt_tokens') ||
	hasUsageField(usage, 'prompt_eval_count') ||
	hasUsageField(usage, 'input_tokens') ||
	hasUsageField(usage, 'prompt_n');

// Provider-agnostic checkpoint total: prompt side + completion side, with
// field precedence OpenAI → Ollama → llama.cpp → Anthropic (#R3). Anthropic
// input_tokens excludes cached/creation cache tokens, so those are added on
// top of the resolved prompt side. An explicit total (OpenAI total_tokens)
// wins only when it is ≥ the sum of the known parts.
export const getUsageTokenCount = (usage?: UsageBlob): number => {
	if (!usage || typeof usage !== 'object') return 0;

	// Prompt-side precedence: OpenAI → Ollama → llama.cpp → Anthropic.
	// llama.cpp counts prompt_n + cache_n; Anthropic adds cache fields on top
	// of input_tokens. Presence (not truthiness) decides the family (#R3).
	let prompt: number;
	if (hasUsageField(usage, 'prompt_tokens')) {
		prompt = numUsageField(usage, 'prompt_tokens');
	} else if (hasUsageField(usage, 'prompt_eval_count')) {
		prompt = numUsageField(usage, 'prompt_eval_count');
	} else if (hasUsageField(usage, 'prompt_n') || hasUsageField(usage, 'cache_n')) {
		prompt = numUsageField(usage, 'prompt_n') + numUsageField(usage, 'cache_n');
	} else if (hasUsageField(usage, 'input_tokens')) {
		prompt =
			numUsageField(usage, 'input_tokens') +
			numUsageField(usage, 'cache_read_input_tokens') +
			numUsageField(usage, 'cache_creation_input_tokens');
	} else {
		prompt = 0;
	}

	const completion =
		firstPresentField(usage, ['completion_tokens', 'output_tokens', 'eval_count', 'predicted_n']) ??
		0;

	const sum = prompt + completion;

	const total = hasUsageField(usage, 'total_tokens') ? numUsageField(usage, 'total_tokens') : null;
	return total !== null && total >= sum ? total : sum;
};

// Rough length/4 estimator (no tokenizer available client-side).
export const estimateTokens = (value: unknown): number => {
	if (value === null || value === undefined || value === '') {
		return 0;
	}
	if (typeof value !== 'string') {
		try {
			value = JSON.stringify(value);
		} catch {
			value = String(value);
		}
	}
	return Math.max(1, Math.floor((value as string).length / 4));
};

// Estimate a message list: content + streamed output + tool-call payloads +
// file metadata (base64 data URIs stripped so attachments don't dominate).
export const estimateMessagesTokens = (messages: any[]): number =>
	(messages ?? []).reduce((total, message) => {
		let next = total + 4 + estimateTokens(message.content);
		next += estimateTokens(message.output);
		next += estimateTokens(message.tool_calls);
		if (message.files?.length) {
			next += estimateTokens(
				JSON.stringify(message.files).replace(/data:[\w/+.;=%-]*;base64,[A-Za-z0-9+/=]*/g, '')
			);
		}
		return next;
	}, 0);

// Newest compaction summary marker on the branch (#R1): messages before it are
// represented by the summary text instead of being counted raw.
export const findSummaryCheckpoint = (messages: any[]): { index: number; text: string } | null => {
	let checkpoint: { index: number; text: string } | null = null;
	for (let idx = 0; idx < (messages ?? []).length; idx += 1) {
		const value = messages[idx]?.contextSummary ?? messages[idx]?.context_summary;
		if (typeof value === 'string' && value.trim()) {
			checkpoint = { index: idx, text: value };
		}
	}
	return checkpoint;
};

const clampPercent = (tokens: number, denominator: number): number =>
	Math.min(100, Math.max(0, Math.round((tokens / denominator) * 100)));

// Single source of truth for the context ring (#R7).
//
// Numerator (#R1/#R2): scan the active branch backwards for the NEWEST valid
// usage checkpoint — valid means the blob reports a prompt-side count
// (hasPromptSideUsage); completion-only blobs are skipped, never trusted as
// covering all prior history. Found → checkpoint + estimate of messages after
// it. None found → estimate everything (system text + summary + branch).
// A `contextSummary` marker slices pre-compaction messages out of the
// estimate; the summary text itself is counted instead (#R1).
//
// Denominator (#R4/#R5): compaction threshold first, then model context
// window; percent is null when neither is known (ring hides). Percent is
// clamped 0–100 and rounded once here so ring fill and tooltip agree (#R6).
export const computeContextUsage = (input: {
	messages: any[];
	systemText?: string | null;
	summaryCheckpoint?: { index: number; text: string } | null;
	threshold?: number | null;
	contextWindow?: number | null;
}): ContextUsageResult | null => {
	const messages = input?.messages ?? [];
	if (!messages.length) {
		return null;
	}

	const systemTokens = estimateTokens(input?.systemText ?? '');

	let startIdx = 0;
	let summaryTokens = 0;
	if (input.summaryCheckpoint && typeof input.summaryCheckpoint.text === 'string') {
		startIdx = Math.max(0, Math.min(input.summaryCheckpoint.index, messages.length - 1));
		summaryTokens = estimateTokens(input.summaryCheckpoint.text);
	}
	const activeMessages = messages.slice(startIdx);

	let tokens = systemTokens + summaryTokens + estimateMessagesTokens(activeMessages);
	// Truthful provenance for the ring label: 'measured' when a provider-reported
	// usage checkpoint supplies the numerator, 'estimated' for pure length/4
	// estimation. Consumers map non-'estimated' sources to a measured label.
	let source = 'estimated';

	for (let idx = activeMessages.length - 1; idx >= 0; idx -= 1) {
		const message = activeMessages[idx];
		const usage = message?.usage ?? message?.info?.usage;
		if (!hasPromptSideUsage(usage)) continue;
		const checkpointTokens = getUsageTokenCount(usage);
		if (checkpointTokens > 0) {
			tokens = checkpointTokens + estimateMessagesTokens(activeMessages.slice(idx + 1));
			source = 'measured';
			break;
		}
	}

	const threshold =
		input?.threshold != null &&
		Number.isFinite(Number(input.threshold)) &&
		Number(input.threshold) > 0
			? Number(input.threshold)
			: null;
	const contextWindow =
		input?.contextWindow != null &&
		Number.isFinite(Number(input.contextWindow)) &&
		Number(input.contextWindow) > 0
			? Number(input.contextWindow)
			: null;
	const denominator = threshold ?? contextWindow;

	return {
		tokens,
		estimated_tokens: tokens,
		threshold,
		denominator,
		percent: denominator !== null ? clampPercent(tokens, denominator) : null,
		source
	};
};
