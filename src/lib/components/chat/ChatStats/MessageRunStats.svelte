<script lang="ts">
	// Local branch: run stats chip on messages. While a run is in flight it
	// renders inline right beside the streaming cursor (time · phase · tok/s);
	// finished runs show time · t/s in the actions row with a details table.
	// The context ring lives in the composer (MessageInput) instead.
	import { onDestroy } from 'svelte';
	import { runs, type RunStats } from '$lib/stores/generationStats';
	import {
		claimRequestId,
		formatDuration,
		formatRate,
		getClaimedRequestStats,
		getCacheHitPercent,
		getEnginePhase,
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
	$: thinkingSec = timing?.thinking_time ?? null;

	// Provider-native timings (ollama) when backend stamps are absent.
	$: nativePrefillMs = usage?.prompt_eval_duration
		? usage.prompt_eval_duration / 1_000_000
		: ttftSec !== null
			? ttftSec * 1000
			: null;
	$: nativeDecodeMs = usage?.eval_duration
		? usage.eval_duration / 1_000_000
		: totalSec !== null && ttftSec !== null
			? (totalSec - ttftSec) * 1000
			: null;

	$: prefillTps =
		nativePrefillMs && nativePrefillMs > 0 && promptTokens > 0
			? (promptTokens / nativePrefillMs) * 1000
			: null;
	$: decodeTps =
		nativeDecodeMs && nativeDecodeMs > 0 && completionTokens > 0
			? (completionTokens / nativeDecodeMs) * 1000
			: null;

	$: cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens ?? 0;

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
			claimedId = claimRequestId(engineModel, claimedId);
			// Drop stale claims so phase falls back to the positional pick
			// inside getClaimedRequestStats / getEnginePhase.
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
	$: claimed = getClaimedRequestStats(engineModel, claimedId);
	// Merged engine view: id-matched claim first, positional pick when the
	// rows carry no request_id (claimRequestId then hands back a synthetic
	// claim, and getEnginePhase covers a model resolved mid-poll).
	$: view = claimed ?? getEnginePhase(engineModel);

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

	// Any signal the backend has produced for this run yet — the gate that
	// keeps the idle-phase word off the chip until the server has started.
	const backendSeen = () =>
		!!run?.firstDeltaAt ||
		(message?.content ?? '').length > 0 ||
		!!message?.status ||
		!!engineModel?.is_loading ||
		view.phase !== 'idle';

	const livePhaseText = () => {
		if (!live) return '';

		// 1) Model still loading — the row can be absent from the snapshot
		//    until resident; resolveEngineModel synthesizes it.
		if (engineModel?.is_loading || view.phase === 'loading') {
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
		}

		// 2) Queued behind other requests.
		if (view.phase === 'waiting') {
			const pos = view.waiting?.queue_position ?? 0;
			return pos > 0 ? `queued #${pos}` : 'queued';
		}

		// 3) Prefilling the prompt — percent when the engine reports progress.
		if (view.phase === 'prefilling') {
			const p = view.prefill;
			if (p?.total) {
				return `prefill ${Math.min(99, Math.max(1, Math.round(((p.processed ?? 0) / p.total) * 100)))}%`;
			}
			return 'prefilling';
		}

		// 4) Backend status/event for this run (tools, retrieval, reasoning…).
		const status = backendStatusText();
		if (status) return status;

		// 5) Engine decoding — tok/s on the chip speaks for itself.
		if (view.phase === 'generating')
			return (view.generating?.tokens_per_second ?? 0) > 0 ? '' : 'generating';

		// 6) Tokens flowing client-side without an engine row match.
		if (liveTps() > 0) return '';
		if ((message?.content ?? '').length > 0) return 'generating';

		// 7) Engine idle mid-run (round-trip/tool gap) — only once the
		//    backend has produced its first signal.
		if (liveSec > 2 && backendSeen()) return 'thinking';

		// 8) Cold start: submitted, nothing back from the backend yet.
		return 'loading';
	};

	const storeTps = () => {
		if (!run?.firstDeltaAt) return 0;
		const elapsed = (Date.now() - run.firstDeltaAt) / 1000;
		if (elapsed <= 0) return 0;
		return (run.estTokens ?? 0) / elapsed;
	};

	const liveTps = () => {
		// Prefill speed is the honest rate while the prompt is being eaten —
		// a decode number from a concurrent request would lie on this chip.
		if (view.phase === 'prefilling') return view.prefill?.speed ?? 0;
		const engine = view.phase === 'generating' ? (view.generating?.tokens_per_second ?? 0) : 0;
		const rate = Math.max(engine, storeTps(), clientRate);
		return rate > 0 ? rate : 0;
	};

	const liveChipText = () => {
		const parts: string[] = [];
		const phase = livePhaseText();
		if (phase) parts.push(phase);
		const tps = liveTps();
		if (tps > 0) parts.push(`${formatRate(tps)} tok/s`);
		return parts.join(' · ');
	};

	const rows = () => {
		const items: Array<[string, string]> = [];
		if (totalSec !== null) items.push(['Total time', formatDuration(totalSec)]);
		if (ttftSec !== null) items.push(['First token', formatDuration(ttftSec)]);
		if (thinkingSec) items.push(['Thinking', formatDuration(thinkingSec)]);
		if (prefillTps) items.push(['Prefill speed', `${formatRate(prefillTps)} tok/s`]);
		if (decodeTps) items.push(['Decode speed', `${formatRate(decodeTps)} tok/s`]);
		if (promptTokens) items.push(['Prompt tokens', promptTokens.toLocaleString()]);
		if (completionTokens) items.push(['Completion tokens', completionTokens.toLocaleString()]);
		if (cachedTokens) items.push(['Cached tokens', cachedTokens.toLocaleString()]);
		const cachePct = usage ? getCacheHitPercent(usage) : null;
		if (cachePct !== null) items.push(['Cache hit', `${cachePct}%`]);
		return items;
	};

	const liveRows = () => {
		const items: Array<[string, string]> = [];
		items.push(['Run time', formatDuration(liveSec)]);
		const phase = livePhaseText() || (view.phase !== 'idle' ? view.phase : '');
		if (phase) items.push(['Phase', phase]);
		const tps = liveTps();
		if (tps > 0)
			items.push([
				view.phase === 'prefilling' ? 'Prefill speed' : 'Decode speed',
				`${formatRate(tps)} tok/s`
			]);
		if (run?.firstDeltaAt) {
			items.push(['First token', formatDuration((run.firstDeltaAt - run.startedAt) / 1000)]);
		}
		if (run?.estTokens) items.push(['Tokens so far', run.estTokens.toLocaleString()]);
		if (view.prefill?.total) {
			items.push([
				'Prefill',
				`${(view.prefill.processed ?? 0).toLocaleString()}/${view.prefill.total.toLocaleString()}`
			]);
		}
		const waiting =
			engineModel?.waiting_requests ??
			run?.engineActivity?.active_models?.total_waiting_requests ??
			0;
		if (waiting > 0) items.push(['Queue', `${waiting} waiting`]);
		return items;
	};

	// fixed so the actions row's overflow-x:auto can't clip it. Flip to
	// below-chip near the viewport top; re-anchor once measured.
	const anchorPop = (rect: DOMRect) => {
		const below = rect.top < 260;
		const left = Math.min(Math.max(rect.right - 208, 8), window.innerWidth - 216);
		popStyle = below
			? `position:fixed; left:${left}px; top:${rect.bottom + 6}px;`
			: `position:fixed; left:${left}px; bottom:${window.innerHeight - rect.top + 6}px;`;
	};
	let popOpen = false;
	let popStyle = '';

	$: popoverRows = live ? liveRows() : rows();

	$: visible =
		live ||
		((message?.done ?? false) &&
			!message?.error &&
			(totalSec !== null || prefillTps !== null || decodeTps !== null));

	const label = () => {
		const parts: string[] = [];
		if (totalSec !== null) parts.push(formatDuration(totalSec));
		if (decodeTps) parts.push(`${formatRate(decodeTps)} tok/s`);
		return parts.join(' · ');
	};
</script>

{#if visible}
	<div
		class="group inline-flex items-center"
		on:mouseenter={(e) => {
			const rect = e.currentTarget.getBoundingClientRect();
			anchorPop(rect);
			popOpen = true;
			requestAnimationFrame(() => {
				const p = document.getElementById('run-stats-popover');
				if (p) {
					const below = rect.top < p.offsetHeight + 12;
					const left = Math.min(Math.max(rect.right - 208, 8), window.innerWidth - 216);
					popStyle = below
						? `position:fixed; left:${left}px; top:${rect.bottom + 6}px;`
						: `position:fixed; left:${left}px; bottom:${window.innerHeight - rect.top + 6}px;`;
				}
			});
		}}
		on:mouseleave={() => {
			popOpen = false;
		}}
	>
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
			<span
				class="cursor-default px-1.5 py-1 text-[11px] leading-none text-gray-400 dark:text-gray-500 tabular-nums"
			>
				{label()}
			</span>
		{/if}
		{#if popoverRows.length > 0 && popOpen}
			<div
				id="run-stats-popover"
				class="fixed z-30 w-52 rounded-xl border border-gray-100 bg-white p-2.5 text-[11px] shadow-xl dark:border-gray-800 dark:bg-gray-900"
				style={popStyle}
			>
				<div class="mb-1.5 font-medium text-gray-700 dark:text-gray-200">
					{live ? 'Live run' : 'Run details'}
				</div>
				<div class="grid grid-cols-[auto_auto] gap-x-3 gap-y-1">
					{#each popoverRows as [k, v]}
						<div class="text-gray-500 dark:text-gray-400">{k}</div>
						<div class="text-right tabular-nums text-gray-700 dark:text-gray-200">{v}</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}
