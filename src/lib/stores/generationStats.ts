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
		claimedRequestId: null
	});
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
export const noteStreamUpdate = (messageId: string, content: string, usage?: any) => {
	runStats.update((run) => {
		if (!run || run.messageId !== messageId) return run;
		const next = { ...run };
		if (!next.firstDeltaAt && (content?.length ?? 0) > 0) {
			next.firstDeltaAt = Date.now();
		}
		next.estTokens = estimateTokensFromText(content ?? '');
		if (usage) next.usage = usage;
		return next;
	});
};

export const noteStep = (messageId: string, label: string, icon?: string) => {
	runStats.update((run) => {
		if (!run || run.messageId !== messageId) return run;
		if (!label) return run;
		if (run.step?.label === label) return run;
		const step: StatsStep = { label, startedAt: Date.now(), icon };
		return { ...run, step, steps: [...run.steps, step].slice(-24) };
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
