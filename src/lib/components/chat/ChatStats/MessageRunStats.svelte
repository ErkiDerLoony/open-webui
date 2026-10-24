<script lang="ts">
	// Local branch: run stats chip on messages. While a run is in flight it
	// renders inline right beside the streaming cursor (time · phase · tok/s);
	// finished runs show time · t/s in the actions row with the canonical dark
	// Tooltip (formatUsageTooltipHtml) for details — the same component and the
	// same content builder as the ⓘ usage button, so the actions row has exactly
	// one tooltip implementation and one unit/format path.
	// The context ring lives in the composer (MessageInput) instead.
	import { onDestroy } from 'svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import { runs, type RunStats } from '$lib/stores/generationStats';
	import {
		claimOwnRequestId,
		computeLiveTps,
		formatDuration,
		formatRate,
		formatTokens,
		formatUsageTooltipHtml,
		getClaimedRequestStats,
		getDisplayGenTokens,
		getDisplayPromptTokens,
		getDisplayView,
		resolveDurationMs,
		resolveDisplayPhase,
		resolveEngineModel,
		type EngineModelActivity
	} from '$lib/utils/streamTiming';

	export let message: any = null;
	export let chatId: string | null = null;

	// Each chip reads ITS OWN run out of the message-keyed registry: several chats
	// can generate at once and a chip must never borrow another chat's numbers.
	// Subscribing to the registry once (rather than a per-message derived store)
	// means a mid-flight message.id re-key, or a chip mounting mid-stream, finds
	// the right entry with no resubscribe churn.
	let run: RunStats | null = null;
	const unsubscribeRuns = runs.subscribe((r) => (run = r[message?.id] ?? null));

	$: usage = message?.usage ?? null;
	$: timing = usage?.timing ?? null;

	$: promptTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.prompt_eval_count ?? 0;
	$: completionTokens = usage?.completion_tokens ?? usage?.output_tokens ?? usage?.eval_count ?? 0;

	$: totalSec = timing?.total_time ?? null;
	$: ttftSec = timing?.ttft ?? null;

	const positiveRate = (v: any): number | null =>
		typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

	// Backend timing (seconds) is authoritative for total/TTFT. Provider-native
	// phase durations carry inconsistent units (ollama nanoseconds, oMLX/openai
	// seconds), so resolveDurationMs picks the scale and rejects implied rates
	// beyond plausibility — no local /1e6 guessing, no trillion-tok/s garbage.
	$: decodeMs =
		completionTokens > 0
			? (resolveDurationMs(usage?.eval_duration, completionTokens) ??
				resolveDurationMs(
					totalSec !== null && ttftSec !== null ? totalSec - ttftSec : null,
					completionTokens
				))
			: null;
	$: decodeRate =
		positiveRate(usage?.generation_tokens_per_second ?? usage?.completion_tokens_per_second) ??
		(decodeMs !== null ? (completionTokens / decodeMs) * 1000 : null);

	// In-flight view while THIS message has an open run in the registry.
	$: live = !!run && !(message?.done ?? false);

	let nowTick = Date.now();
	let timer: ReturnType<typeof setInterval> | null = null;
	// Client-side fallback rate: count content growth (~4 chars ≈ 1 token) so
	// tok/s still ticks even when the engine claim is unavailable (e.g. admin
	// activity blocked). Engine-reported rate always wins when present.
	let prevContentLen = 0;
	let prevRateTick = Date.now();
	let clientRate = 0;

	$: {
		if (live) {
			if (!timer) {
				prevContentLen = (message?.content ?? '').length;
				prevRateTick = Date.now();
				clientRate = 0;
				timer = setInterval(() => {
					nowTick = Date.now();
					const len = (message?.content ?? '').length;
					const dt = (nowTick - prevRateTick) / 1000;
					if (dt > 0 && len > prevContentLen) {
						const inst = (len - prevContentLen) / 4 / dt;
						clientRate = clientRate === 0 ? inst : clientRate * 0.6 + inst * 0.4;
					}
					prevContentLen = len;
					prevRateTick = nowTick;
				}, 250);
			}
		} else if (timer) {
			clearInterval(timer);
			timer = null;
		}
	}

	onDestroy(() => {
		unsubscribeRuns();
		if (timer) clearInterval(timer);
		if (pollTimer) clearInterval(pollTimer);
	});

	$: liveSec = live && run ? (nowTick - run.startedAt) / 1000 : 0;

	// Engine activity is SELF-POLLED here: the Chat.svelte store mirror can be
	// stale for lazily-mounted message chips (split reactive instances showed
	// frozen activity), while this component always needs current rows.
	// Claim stays local — this component never writes the run registry (a store
	// write from a reactive block reading it is a cycle Svelte kills).
	let engineModel: EngineModelActivity | null = null;
	let claimedId: string | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	// Console dump of the raw activity payload once per run when
	// localStorage.owui.statsDebug === '1' (reset when the run ends).
	let loggedActivity = false;

	const pollActivity = async () => {
		try {
			const r = run;
			const idx = r?.urlIdx ?? 0;
			const res = await fetch(`/api/v1/engine/stats/activity?url_idx=${idx}`, {
				headers: { Authorization: `Bearer ${localStorage.token ?? ''}` }
			});
			if (!res.ok) return;
			const data = await res.json();
			if (!loggedActivity && localStorage.getItem('owui.statsDebug') === '1') {
				console.log('[run-stats]', chatId ?? '', message?.id ?? '', JSON.stringify(data));
				loggedActivity = true;
			}
			if (!data?.supported) return;
			// Prefer our own fresh poll; fall back to Chat.svelte's store copy.
			// The store mirror can lag by a tick, so when the fresh snapshot has
			// no live rows but the mirror still does, trust the mirror.
			const fresh = resolveEngineModel(data, r?.modelId ?? null);
			const mirrored = resolveEngineModel(r?.engineActivity, r?.modelId ?? null);
			const hasRows = (m: EngineModelActivity | null) =>
				!!m &&
				(m.prefilling?.length ?? 0) + (m.generating?.length ?? 0) + (m.waiting?.length ?? 0) > 0;
			engineModel = hasRows(fresh) ? fresh : hasRows(mirrored) ? mirrored : (fresh ?? mirrored);
			// Ownership evidence required before claiming (spec #R11): no claim
			// attempts until THIS run's stream produced its first token, and only
			// rows that started with the run are candidates.
			claimedId = claimOwnRequestId(engineModel, r, claimedId, {
				modelId: r?.modelId ?? null,
				chatId: r?.chatId ?? chatId
			});
			// Drop stale claims so the view falls back to the positional pick
			// over claimable rows (inside getDisplayView).
			if (claimedId && !getClaimedRequestStats(engineModel, claimedId)) claimedId = null;
			nowTick = Date.now();
		} catch {
			// transient errors: keep the last snapshot
		}
	};

	$: {
		if (live) {
			if (!pollTimer) {
				engineModel = null;
				claimedId = null;
				loggedActivity = false;
				void pollActivity();
				pollTimer = setInterval(() => void pollActivity(), 700);
			}
		} else if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
			engineModel = null;
			claimedId = null;
			loggedActivity = false;
		}
	}
	// Merged engine view for the chip (spec #R11): narrowed to rows THIS run
	// may claim — id-matched claim first, positional pick inside the claimable
	// rows when the engine omits request_ids. Before this run's own stream
	// produced its first token nothing is claimable, so the view stays neutral:
	// foreign rows' token counts and queued/prefill phase words never surface.
	$: view = getDisplayView(engineModel, run, claimedId, {
		modelId: run?.modelId ?? null,
		chatId: run?.chatId ?? chatId
	});

	// Active backend status/event text for this run ('' when the backend has
	// sent none). Reasoning-flavoured statuses map to the reasoning word.
	const backendStatusText = () => {
		const st = message?.status;
		if (!st || st.done || st.endedAt) return '';
		const d = st.description;
		const text =
			typeof d === 'string' ? d : Array.isArray(d) ? d.map((p: any) => p?.text ?? '').join('') : '';
		const label = `${text || st.action || run?.step?.label || ''}`.toLowerCase().trim();
		if (!label) return 'tooling';
		if (label.includes('think')) return 'thinking';
		return label.length > 28 ? `${label.slice(0, 27)}…` : label;
	};

	// Rich model-loading text (#R20: reached ONLY while the run has no own
	// output yet — firstDeltaAt, which counts reasoning deltas per #R19,
	// suppresses the loading word entirely).
	const loadingPhaseText = () => {
		const elapsed = engineModel?.loading_elapsed_seconds ?? null;
		const estimate = engineModel?.loading_estimated_seconds ?? null;
		const remaining = engineModel?.loading_remaining_seconds_estimate ?? null;
		if (estimate && elapsed !== null) {
			const pct = Math.min(99, Math.max(1, Math.round((elapsed / estimate) * 100)));
			const eta = remaining ?? Math.max(0, estimate - elapsed);
			return `loading model ${pct}%${eta > 0 ? ` ~${Math.ceil(eta)}s` : ''}`;
		}
		const eta = remaining ?? estimate ?? null;
		return `loading model${eta ? ` ~${Math.ceil(eta)}s` : ''}`;
	};

	// Phase word of what is BOUND to this run: claimable-filtered engine rows
	// (#R11 — queued/prefill first, decoding last) and backend status/event
	// text. Null when nothing is bound, so the display falls back to
	// own-stream evidence per #R20 instead of a foreign row's phase word.
	const boundPhase = (): string | null => {
		if (view.phase === 'waiting') return 'queued';
		if (view.phase === 'prefilling') return 'prefill';
		const status = backendStatusText();
		if (status) return status;
		if (view.phase === 'generating') return 'generating';
		return null;
	};

	// Phase hierarchy (spec #R20): bound row phase wins; else own-stream
	// evidence names thinking/generating; loading only before any own output;
	// otherwise the neutral waiting word.
	const livePhaseText = () => {
		if (!live) return '';

		const phase = resolveDisplayPhase({
			loadingEvidence: !!engineModel?.is_loading || view.phase === 'loading',
			claimablePhase: boundPhase(),
			firstDeltaAt: run?.firstDeltaAt ?? null,
			hasOwnDeltas: (message?.content ?? '').length > 0 || !!run?.firstDeltaAt,
			reasoningActive: run?.lastDeltaWasReasoning === true || run?.step?.icon === 'reasoning'
		});

		switch (phase) {
			case 'loading':
				return loadingPhaseText();
			case 'queued': {
				// Queue position when the bound row reports one.
				const pos = view.waiting?.queue_position ?? 0;
				return pos > 0 ? `queued #${pos}` : 'queued';
			}
			case 'prefill': {
				// Percent when the engine reports prompt progress.
				const p = view.prefill;
				if (p?.total) {
					return `prefill ${Math.min(99, Math.max(1, Math.round(((p.processed ?? 0) / p.total) * 100)))}%`;
				}
				return 'prefilling';
			}
			case 'generating':
				// tok/s on the chip speaks for itself.
				return liveTps() > 0 ? '' : 'generating';
			case 'thinking':
				return 'thinking';
			case 'waiting':
				// Cold start: submitted, no own evidence and no bound row —
				// neutral word (same wording as the ChatStatsBar fallback).
				return 'waiting for model';
			default:
				// Backend status/event text (tools, retrieval…) — display-ready.
				return phase;
		}
	};

	const storeTps = () => {
		if (!run?.firstDeltaAt) return 0;
		const elapsed = (Date.now() - run.firstDeltaAt) / 1000;
		if (elapsed <= 0) return 0;
		return (run.estTokens ?? 0) / elapsed;
	};

	const liveTps = () => computeLiveTps(view, run, storeTps(), clientRate);

	// Generated-token count on the chip: engine-reported only for rows carrying
	// THIS run's ownership evidence (spec #R11), else the client length/4
	// estimate carried on the run — pre-first-token this yields 0 and the
	// segment is omitted, never another request's counter.
	const liveGenTokens = () => getDisplayGenTokens(view) ?? run?.estTokens ?? 0;

	// Prompt size mid-stream: usage wins when the provider already sent it,
	// else a claimable engine row (prefill/generating/waiting) reports it;
	// foreign rows contribute nothing (spec #R11).
	const livePromptTokens = () => {
		if (promptTokens > 0) return promptTokens;
		return getDisplayPromptTokens(view) ?? 0;
	};

	const liveChipText = () => {
		const parts: string[] = [];
		const phase = livePhaseText();
		if (phase) parts.push(phase);
		const tps = liveTps();
		if (tps > 0) parts.push(`${formatRate(tps)} tok/s`);
		const gen = liveGenTokens();
		if (gen > 0) parts.push(`${formatTokens(gen)} tok`);
		const prompt = livePromptTokens();
		if (prompt > 0) parts.push(`${formatTokens(prompt)} in`);
		return parts.join(' · ');
	};

	$: visible =
		live ||
		((message?.done ?? false) && !message?.error && (totalSec !== null || decodeRate !== null));

	const label = () => {
		const parts: string[] = [];
		if (totalSec !== null) parts.push(formatDuration(totalSec));
		if (decodeRate) parts.push(`${formatRate(decodeRate)} tok/s`);
		if (completionTokens > 0) parts.push(`${formatTokens(completionTokens)} tok`);
		if (promptTokens > 0) parts.push(`${formatTokens(promptTokens)} in`);
		return parts.join(' · ');
	};
</script>

{#if visible}
	{#if live && run}
		<span
			class="flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] leading-none text-gray-400 tabular-nums dark:text-gray-500"
		>
			<span class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"></span>
			<!-- elapsed + phase + rate in ONE interpolation: the elapsed text
			     node demonstrably updates, the separate `{#if}` spans did not -->
			{`${formatDuration(liveSec)} · ${liveChipText()}`}
		</span>
	{:else}
		<Tooltip content={formatUsageTooltipHtml(usage)} placement="bottom">
			<span
				class="cursor-default px-1.5 py-1 text-[11px] leading-none text-gray-400 dark:text-gray-500 tabular-nums"
			>
				{label()}
			</span>
		</Tooltip>
	{/if}
{/if}
