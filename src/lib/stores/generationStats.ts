// Local branch: live run stats store (see ChatStats/ChatStatsBar.svelte).
// Chat.svelte feeds it through tiny hook calls; the bar renders from here.
//
// `runs` is a REGISTRY keyed by message id: several chats can generate at once
// and each message chip reads its own run. A single slot made the most recently
// started chat win, which is why background chats lost their stats.
// `runStats` remains exported as a mirror of the newest run for consumers that
// only ever care about that one (ChatStatsBar).
import { derived, get, writable } from 'svelte/store';
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
	chatId: string | null;
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

// Quiet chats never report their end; sweep their leftovers when a new run
// starts in that chat. MAX_RUNS bounds the registry if nothing ever ends.
const STALE_RUN_MS = 30 * 60 * 1000;
const MAX_RUNS = 16;

export const runs = writable<Record<string, RunStats>>({});

// Mirror of the newest-by-startedAt entry, refreshed by every mutation so the
// pre-existing single-run consumers keep working.
export const runStats = writable<RunStats | null>(null);

const newestRun = (registry: Record<string, RunStats>): RunStats | null => {
	let newest: RunStats | null = null;
	for (const entry of Object.values(registry)) {
		if (!entry) continue;
		if (!newest || (entry.startedAt ?? 0) >= (newest.startedAt ?? 0)) newest = entry;
	}
	return newest;
};

const writeRuns = (registry: Record<string, RunStats>) => {
	runs.set(registry);
	runStats.set(newestRun(registry));
};

// Returning null means "nothing changed" — no notification, no mirror churn.
const updateRuns = (
	mutate: (registry: Record<string, RunStats>) => Record<string, RunStats> | null
) => {
	const next = mutate(get(runs));
	if (next) writeRuns(next);
};

const patchRun = (messageId: string, patch: Partial<RunStats>) => {
	updateRuns((registry) => {
		const entry = registry[messageId];
		if (!entry) return null;
		return { ...registry, [messageId]: { ...entry, ...patch } };
	});
};

export const runStatsFor = (messageId: string) =>
	derived(runs, (registry) => registry?.[messageId] ?? null);

export const beginRun = (
	messageId: string,
	modelId: string,
	urlIdx: number | null,
	chatId: string | null = null
) => {
	const startedAt = Date.now();
	updateRuns((registry) => {
		const next: Record<string, RunStats> = {};
		for (const [key, entry] of Object.entries(registry)) {
			const sameChat = (entry?.chatId ?? '') === (chatId ?? '');
			if (sameChat && startedAt - (entry?.startedAt ?? 0) > STALE_RUN_MS) continue;
			next[key] = entry;
		}
		next[messageId] = {
			messageId,
			chatId,
			modelId,
			urlIdx,
			startedAt,
			firstDeltaAt: null,
			estTokens: 0,
			usage: null,
			step: null,
			steps: [],
			claimedRequestId: null,
			context: null,
			contextThreshold: null,
			engineActivity: null
		};
		// Bound the registry by evicting the oldest, never the run just begun.
		const keys = Object.keys(next)
			.filter((key) => key !== messageId)
			.sort((a, b) => (next[a]?.startedAt ?? 0) - (next[b]?.startedAt ?? 0));
		for (let i = 0; keys.length + 1 - i > MAX_RUNS; i++) delete next[keys[i]];
		return next;
	});
};

// A chat with no id yet (brand-new chat) owns anonymous entries; once a real
// id shows up it claims them. Chat-less calls would smear one chat's engine
// state across every other running chat, so they are a no-op.
const mergeIntoChat = (
	registry: Record<string, RunStats>,
	chatId: string,
	patch: Partial<RunStats>
): Record<string, RunStats> | null => {
	let next: Record<string, RunStats> | null = null;
	for (const [key, entry] of Object.entries(registry)) {
		if (!entry) continue;
		const entryChatId = entry.chatId ?? '';
		if (entryChatId !== chatId && entryChatId !== '') continue;
		if (!next) next = { ...registry };
		next[key] = { ...entry, ...patch, chatId: entryChatId || chatId };
	}
	return next;
};

// Live engine activity snapshot mirrored from Chat's poll so message-level
// chips can render phases without prop drilling.
export const setEngineActivity = (activity: any | null, chatId: string | null = null) => {
	if (chatId === null || chatId === undefined) return;
	updateRuns((registry) => mergeIntoChat(registry, chatId, { engineActivity: activity }));
};

// Live context usage pushed from Chat's reactive block while a run is active.
export const setRunContext = (
	context: number | null,
	contextThreshold: number | null,
	chatId: string | null = null
) => {
	if (chatId === null || chatId === undefined) return;
	updateRuns((registry) => mergeIntoChat(registry, chatId, { context, contextThreshold }));
};

// Whole-app reset: forget every run. Per-chat idles use endRunForChat().
export const endRun = () => {
	if (Object.keys(get(runs)).length === 0) return;
	writeRuns({});
};

export const endRunIf = (messageId: string) => {
	updateRuns((registry) => {
		if (!registry[messageId]) return null;
		const next = { ...registry };
		delete next[messageId];
		return next;
	});
};

// The chat went idle: drop every run it still holds, leave other chats alone.
export const endRunForChat = (chatId: string | null) => {
	if (chatId === null || chatId === undefined) return;
	updateRuns((registry) => {
		let next: Record<string, RunStats> | null = null;
		for (const [key, entry] of Object.entries(registry)) {
			if (!entry || (entry.chatId ?? '') !== chatId) continue;
			if (!next) next = { ...registry };
			delete next[key];
		}
		return next;
	});
};

const applyStream = (
	entry: RunStats,
	messageId: string,
	content: string,
	usage?: any,
	chatId?: string | null
): RunStats => {
	const now = Date.now();
	const next: RunStats = { ...entry, messageId };
	// A run begun before its chat had an id gets claimed by the first real id.
	if (!next.chatId && chatId) next.chatId = chatId;
	if (!next.firstDeltaAt && (content?.length ?? 0) > 0) next.firstDeltaAt = now;
	next.estTokens = Math.max(next.estTokens ?? 0, estimateTokensFromText(content ?? ''));
	if (usage) next.usage = usage;
	// Real text flowing means we are past any tool/status step; close it.
	if (content?.length > 0 && next.step && !next.step.endedAt) {
		next.step = { ...next.step, endedAt: now };
	}
	return next;
};

// One call per streamed chunk: marks first token, updates token estimate.
// WS bridge mode can stream under an id different from the one beginRun()
// stamped, so a still-unbound (never streamed) open run in the SAME chat may
// be re-keyed onto this message. Unknown ids are ignored: we never move a run
// from one chat to another, and never adopt into a run of another chat.
export const noteStreamUpdate = (
	messageId: string,
	content: string,
	usage?: any,
	chatId: string | null = null
) => {
	updateRuns((registry) => {
		const entry = registry[messageId];
		if (entry) {
			return { ...registry, [messageId]: applyStream(entry, messageId, content, usage, chatId) };
		}
		// null chatId means the caller has no chat context — never guess across
		// chats. '' (a chat that has no id yet) may only claim anonymous runs.
		if (!messageId || chatId === null || chatId === undefined) return null;
		const unbound = Object.keys(registry).filter((key) => {
			const run = registry[key];
			const runChatId = run?.chatId ?? '';
			return !!run && run.firstDeltaAt === null && (runChatId === '' || runChatId === chatId);
		});
		if (unbound.length !== 1) return null;
		const next = { ...registry };
		next[messageId] = applyStream(next[unbound[0]], messageId, content, usage, chatId);
		delete next[unbound[0]];
		return next;
	});
};

export const noteStep = (messageId: string, label: string, icon?: string) => {
	if (!label) return;
	const now = Date.now();
	updateRuns((registry) => {
		const run = registry[messageId];
		if (!run) return null;
		if (run.step?.label === label && !run.step?.endedAt) return null;
		const steps = run.steps.map((s) => (s.endedAt ? s : { ...s, endedAt: now }));
		if (run.step && !run.step.endedAt) {
			steps.push({ ...run.step, endedAt: now });
		}
		const step: StatsStep = { label, startedAt: now, icon };
		return { ...registry, [messageId]: { ...run, step, steps: steps.slice(-24) } };
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

// Resolve + claim the engine activity row for the newest active run. The claim
// lives on that run's registry entry, so other chats keep theirs.
export const syncEngineClaim = (activity: EngineActivity | null): EngineModelActivity | null => {
	const run = get(runStats);
	if (!run || !activity?.supported) return null;
	const model = resolveEngineModel(activity, run.modelId);
	if (!model) return null;
	const claimed = claimRequestId(model, run.claimedRequestId);
	if (claimed !== run.claimedRequestId) {
		patchRun(run.messageId, { claimedRequestId: claimed });
	}
	return model;
};
