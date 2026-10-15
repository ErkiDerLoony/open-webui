// Local branch: live run stats store (see ChatStats/ChatStatsBar.svelte).
// Chat.svelte feeds it through tiny hook calls; the bar renders from here.
import { get, writable } from 'svelte/store';
import {
	claimRequestId,
	estimateTokensFromText,
	resolveEngineModel
} from '$lib/utils/streamTiming';
import type { EngineActivity, EngineModelActivity } from '$lib/utils/streamTiming';

export type StatsStep = {
	label: string;
	startedAt: number;
	endedAt?: number | null;
	icon?: string;
};

export type RunStats = {
	messageId: string;
	modelId: string;
	urlIdx: number | null;
	startedAt: number;
	firstDeltaAt: number | null;
	estTokens: number;
	usage: any | null;
	step: StatsStep | null;
	steps: StatsStep[];
	claimedRequestId: string | null;
	context: number | null;
	contextThreshold: number | null;
	engineActivity: any | null;
};

export const runStats = writable<RunStats | null>(null);

export const beginRun = (messageId: string, modelId: string, urlIdx: number | null) => {
	runStats.set({
		messageId,
		modelId,
		urlIdx,
		startedAt: Date.now(),
		firstDeltaAt: null,
		estTokens: 0,
		usage: null,
		step: null,
		steps: [],
		claimedRequestId: null,
		context: null,
		contextThreshold: null,
		engineActivity: null
	});
};

// Live engine activity snapshot mirrored from Chat's poll so message-level
// chips can render phases without prop drilling.
export const setEngineActivity = (activity: any | null) => {
	runStats.update((run) => (run ? { ...run, engineActivity: activity } : run));
};

// Live context usage pushed from Chat's reactive block while a run is active.
export const setRunContext = (context: number | null, contextThreshold: number | null) => {
	runStats.update((run) => (run ? { ...run, context, contextThreshold } : run));
};

export const endRun = () => {
	runStats.set(null);
};

export const endRunIf = (messageId: string) => {
	const run = get(runStats);
	if (run && run.messageId === messageId) {
		runStats.set(null);
	}
};

// One call per streamed chunk: marks first token, updates token estimate.
// While a run is active we adopt any message id: WS bridge mode streams
// under ids different from the one beginRun() stamped at submit time.
export const noteStreamUpdate = (messageId: string, content: string, usage?: any) => {
	runStats.update((run) => {
		if (!run) return run;
		const next = { ...run };
		if (next.messageId !== messageId) {
			next.messageId = messageId;
		}
		if (!next.firstDeltaAt && (content?.length ?? 0) > 0) {
			next.firstDeltaAt = Date.now();
		}
		next.estTokens = Math.max(next.estTokens ?? 0, estimateTokensFromText(content ?? ''));
		if (usage) next.usage = usage;
		// Real text flowing means we are past any tool/status step; close it.
		if (content?.length > 0 && next.step && !next.step.endedAt) {
			next.step = { ...next.step, endedAt: Date.now() };
		}
		return next;
	});
};

export const noteStep = (messageId: string, label: string, icon?: string) => {
	runStats.update((run) => {
		if (!run) return run;
		if (!label) return run;
		if (run.step?.label === label && !run.step?.endedAt) return run;
		const steps = run.steps.map((s) => (s.endedAt ? s : { ...s, endedAt: Date.now() }));
		if (run.step && !run.step.endedAt) {
			steps.push({ ...run.step, endedAt: Date.now() });
		}
		const step: StatsStep = { label, startedAt: Date.now(), icon };
		return { ...run, step, steps: steps.slice(-24) };
	});
};

export const noteStatus = (messageId: string, status: any) => {
	const description = status?.description;
	const label =
		typeof description === 'string'
			? description
			: Array.isArray(description)
				? description.map((part: any) => part?.text ?? '').join('')
				: '';
	noteStep(
		messageId,
		label || status?.action || 'working',
		status?.done ? undefined : status?.action
	);
};

// Track current step from Responses-style output item lifecycle events.
export const noteOutputEvent = (messageId: string, data: any) => {
	const type = data?.type ?? '';
	const item = data?.item ?? {};
	if (type === 'response.output_item.added' || type === 'response.output_item.done') {
		if (item.type === 'function_call') {
			const name = item.name ?? item?.function?.name ?? 'tool call';
			noteStep(messageId, `calling ${name}`, 'tool');
		} else if (item.type === 'reasoning') {
			noteStep(messageId, 'thinking', 'reasoning');
		}
	}
};

// Resolve + claim the engine activity row for the active run.
export const syncEngineClaim = (activity: EngineActivity | null): EngineModelActivity | null => {
	const run = get(runStats);
	if (!run || !activity?.supported) return null;
	const model = resolveEngineModel(activity, run.modelId);
	if (!model) return null;
	const claimed = claimRequestId(model, run.claimedRequestId);
	if (claimed !== run.claimedRequestId) {
		runStats.update((current) => (current ? { ...current, claimedRequestId: claimed } : current));
	}
	return model;
};
