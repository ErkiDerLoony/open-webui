<script lang="ts">
	// Local branch: run stats chip on messages. While a run is in flight it
	// shows live time + context ring at the same spot where the completed
	// chip will settle; finished runs show time · t/s with a details popover.
	import { onDestroy } from 'svelte';
	import { runStats } from '$lib/stores/generationStats';
	import { formatDuration, formatRate, formatTokens } from '$lib/utils/streamTiming';
	import ContextRing from './ContextRing.svelte';

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
	$: liveCtxPct =
		live && $runStats?.context && $runStats?.contextThreshold
			? Math.round(($runStats.context / $runStats.contextThreshold) * 100)
			: null;

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
		return items;
	};

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
	<div class="group relative flex items-center">
		{#if live && $runStats}
			<span
				class="flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] leading-none text-gray-400 tabular-nums dark:text-gray-500"
			>
				<span class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"></span>
				{formatDuration(liveSec)}
				<ContextRing
					percent={liveCtxPct}
					title={$runStats.context
						? `Context ${formatTokens($runStats.context)} / ${formatTokens($runStats.contextThreshold)} (${liveCtxPct ?? '?'}%)`
						: ''}
				/>
				{#if liveCtxPct !== null}
					<span class="text-gray-400 dark:text-gray-500">{liveCtxPct}%</span>
				{/if}
			</span>
		{:else}
			<button
				type="button"
				class="rounded-md px-1.5 py-1 text-[11px] leading-none text-gray-400 transition hover:bg-black/5 hover:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-300 tabular-nums"
			>
				{label()}
			</button>
			{#if rows().length > 0}
				<div
					class="pointer-events-none absolute bottom-full right-0 z-30 mb-1 hidden w-52 rounded-xl border border-gray-100 bg-white p-2.5 text-[11px] shadow-xl group-hover:block dark:border-gray-800 dark:bg-gray-900"
				>
					<div class="mb-1.5 font-medium text-gray-700 dark:text-gray-200">Run details</div>
					<div class="grid grid-cols-[auto_auto] gap-x-3 gap-y-1">
						{#each rows() as [k, v]}
							<div class="text-gray-500 dark:text-gray-400">{k}</div>
							<div class="text-right tabular-nums text-gray-700 dark:text-gray-200">{v}</div>
						{/each}
					</div>
				</div>
			{/if}
		{/if}
	</div>
{/if}
