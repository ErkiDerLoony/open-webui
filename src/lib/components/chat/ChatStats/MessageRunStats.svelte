<script lang="ts">
	// Local branch: run stats chip on messages. While a run is in flight it
	// renders inline right beside the streaming cursor (time · phase · tok/s);
	// finished runs show time · t/s in the actions row with a details table.
	// The context ring lives in the composer (MessageInput) instead.
	import { onDestroy } from 'svelte';
	import { runStats, syncEngineClaim } from '$lib/stores/generationStats';
	import {
		formatDuration,
		formatRate,
		getClaimedRequestStats,
		getCacheHitPercent
	} from '$lib/utils/streamTiming';

	export let message: any = null;

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

	// In-flight view when the live run belongs to this message.
	$: live = $runStats && $runStats.messageId === message?.id && !(message?.done ?? false);

	let nowTick = Date.now();
	let timer: ReturnType<typeof setInterval> | null = null;
	$: {
		if (live) {
			if (!timer) {
				timer = setInterval(() => {
					nowTick = Date.now();
				}, 250);
			}
		} else if (timer) {
			clearInterval(timer);
			timer = null;
		}
	}
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	$: liveSec = live && $runStats ? (nowTick - $runStats.startedAt) / 1000 : 0;

	// Live phase straight from the engine activity mirrored into the store.
	$: engineModel = live ? syncEngineClaim($runStats?.engineActivity ?? null) : null;
	$: claimed = engineModel
		? getClaimedRequestStats(engineModel, $runStats?.claimedRequestId ?? null)
		: null;

	const clientTps = () => {
		if (!$runStats?.firstDeltaAt) return 0;
		const elapsed = (nowTick - $runStats.firstDeltaAt) / 1000;
		if (elapsed <= 0) return 0;
		return ($runStats.estTokens ?? 0) / elapsed;
	};

	const livePhaseText = () => {
		if (!live) return '';
		if (engineModel?.is_loading) {
			const eta =
				engineModel.loading_remaining_seconds_estimate ??
				engineModel.loading_estimated_seconds ??
				null;
			return `loading${eta ? ` ~${Math.ceil(eta)}s` : ''}`;
		}
		if (claimed?.phase === 'prefilling') {
			const p = claimed.prefill;
			if (p?.total) {
				return `prefill ${Math.min(99, Math.max(1, Math.round(((p.processed ?? 0) / p.total) * 100)))}%`;
			}
			return 'prefilling';
		}
		if (claimed?.phase === 'waiting') return 'queued';
		return '';
	};

	const liveTps = () => {
		const engine = claimed?.generating?.tokens_per_second;
		if (engine && engine > 0) return engine;
		return clientTps();
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
		const phase = livePhaseText();
		if (phase) items.push(['Phase', phase]);
		const tps = liveTps();
		if (tps > 0) items.push(['Decode speed', `${formatRate(tps)} tok/s`]);
		if ($runStats?.firstDeltaAt) {
			items.push([
				'First token',
				formatDuration(($runStats.firstDeltaAt - $runStats.startedAt) / 1000)
			]);
		}
		if ($runStats?.estTokens) items.push(['Tokens so far', $runStats.estTokens.toLocaleString()]);
		if (claimed?.prefill?.total) {
			items.push([
				'Prefill',
				`${(claimed.prefill.processed ?? 0).toLocaleString()}/${claimed.prefill.total.toLocaleString()}`
			]);
		}
		const waiting =
			engineModel?.waiting_requests ??
			$runStats?.engineActivity?.active_models?.total_waiting_requests ??
			0;
		if (waiting > 0) items.push(['Queue', `${waiting} waiting`]);
		return items;
	};

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
	<div class="group relative inline-flex items-center">
		{#if live && $runStats}
			<span
				class="flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] leading-none text-gray-400 tabular-nums dark:text-gray-500"
			>
				<span class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"></span>
				{formatDuration(liveSec)}
				{#if livePhaseText()}
					<span class="text-gray-400 dark:text-gray-500">· {livePhaseText()}</span>
				{/if}
				{#if liveTps() > 0}
					<span class="text-gray-400 dark:text-gray-500">
						· {formatRate(liveTps())} tok/s
					</span>
				{/if}
			</span>
		{:else}
			<button
				type="button"
				class="rounded-md px-1.5 py-1 text-[11px] leading-none text-gray-400 transition hover:bg-black/5 hover:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-300 tabular-nums"
			>
				{label()}
			</button>
		{/if}
		{#if popoverRows.length > 0}
			<div
				class="pointer-events-none absolute bottom-full right-0 z-30 mb-1 hidden w-52 rounded-xl border border-gray-100 bg-white p-2.5 text-[11px] shadow-xl group-hover:block dark:border-gray-800 dark:bg-gray-900"
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
