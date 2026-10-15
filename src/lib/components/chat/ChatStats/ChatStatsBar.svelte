<script lang="ts">
	// Local branch: live inference stats bar (see stores/generationStats.ts).
	import { onMount, onDestroy } from 'svelte';

	import { runStats, syncEngineClaim } from '$lib/stores/generationStats';
	import {
		formatDuration,
		formatRate,
		formatTokens,
		getCacheHitPercent,
		getClaimedRequestStats,
		getContextBreakdown
	} from '$lib/utils/streamTiming';
	import StepTimeline from './StepTimeline.svelte';

	export let active = false;
	export let activity: any = null;
	export let contextUsage: any = null;

	const STORAGE_KEY = 'owui.showGenerationStats';

	let expanded = false;
	let enabled = true;
	let nowTick = Date.now();
	let timer: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		try {
			enabled = localStorage.getItem(STORAGE_KEY) !== '0';
		} catch (e) {
			// private mode
		}
	});

	onDestroy(() => {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	});

	$: {
		if (enabled && active && $runStats) {
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

	$: run = $runStats;
	$: visible = enabled && active && !!run;

	// Resolve + claim the engine activity row belonging to this run.
	$: engineModel = visible ? syncEngineClaim(activity) : null;
	$: claimed = engineModel
		? getClaimedRequestStats(engineModel, run?.claimedRequestId ?? null)
		: null;
	$: breakdown = run ? getContextBreakdown(run.usage) : null;
	$: cachedPct = run ? getCacheHitPercent(run.usage) : null;

	$: totalSec = run ? (nowTick - run.startedAt) / 1000 : 0;
	$: ttftSec = run?.firstDeltaAt ? (run.firstDeltaAt - run.startedAt) / 1000 : null;
	$: stepSec = run?.step ? (nowTick - run.step.startedAt) / 1000 : null;

	const clientTps = () => {
		if (!run?.firstDeltaAt) return 0;
		const elapsed = (nowTick - run.firstDeltaAt) / 1000;
		if (elapsed <= 0) return 0;
		return (run.estTokens ?? 0) / elapsed;
	};

	const prefillRow = () => claimed?.prefill ?? null;
	const genRow = () => claimed?.generating ?? null;

	const prefillPct = () => {
		const row = prefillRow();
		if (!row?.total) return null;
		return Math.min(99, Math.max(1, Math.round(((row.processed ?? 0) / row.total) * 100)));
	};

	const loading = () => engineModel?.is_loading ?? false;
	const loadingPct = () => {
		const elapsed = engineModel?.loading_elapsed_seconds ?? 0;
		const estimate = engineModel?.loading_estimated_seconds ?? null;
		if (estimate && estimate > 0) {
			return Math.min(95, Math.max(2, Math.round((elapsed / estimate) * 100)));
		}
		return null;
	};

	const decodeTps = () => genRow()?.tokens_per_second ?? clientTps();

	const phaseLabel = () => {
		if (loading()) return 'loading model';
		if (claimed?.phase === 'waiting') return `queued #${claimed.waiting?.queue_position ?? '?'}`;
		if (claimed?.phase === 'prefilling') return 'prefilling';
		if (claimed?.phase === 'generating') return 'generating';
		if (run?.firstDeltaAt) return 'generating';
		return 'waiting for model';
	};

	const toggleEnabled = () => {
		enabled = !enabled;
		try {
			localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
		} catch (e) {
			// private mode
		}
	};
</script>

<div class="mx-auto w-full max-w-[58rem] pb-1">
	{#if visible && run}
		<div class="relative">
			{#if expanded}
				<div
					class="absolute bottom-full left-2 z-30 mb-1 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-100 bg-white p-3 text-xs shadow-xl dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
				>
					<div class="mb-1.5 font-medium text-gray-700 dark:text-gray-200">Run details</div>
					<div class="grid grid-cols-2 gap-x-3 gap-y-1">
						<div class="text-gray-500">Total time</div>
						<div class="text-right tabular-nums">{formatDuration(totalSec)}</div>
						{#if ttftSec !== null}
							<div class="text-gray-500">First token</div>
							<div class="text-right tabular-nums">{formatDuration(ttftSec)}</div>
						{/if}
						<div class="text-gray-500">Current phase</div>
						<div class="text-right">{phaseLabel()}</div>
						{#if run.step}
							<div class="text-gray-500">Current step</div>
							<div class="truncate text-right">{run.step.label} · {formatDuration(stepSec)}</div>
						{/if}
						{#if prefillRow()}
							<div class="text-gray-500">Prefill</div>
							<div class="text-right tabular-nums">
								{prefillRow()?.processed ?? 0}/{prefillRow()?.total ?? '?'} tok
								{#if prefillRow()?.speed}
									· {formatRate(prefillRow()?.speed)} t/s
								{/if}
							</div>
							{#if prefillRow()?.eta}
								<div class="text-gray-500">Prefill ETA</div>
								<div class="text-right tabular-nums">~{formatDuration(prefillRow()?.eta)}</div>
							{/if}
						{/if}
						{#if genRow()}
							<div class="text-gray-500">Generated</div>
							<div class="text-right tabular-nums">
								{genRow()?.generated_tokens ?? 0} tok · {formatRate(genRow()?.tokens_per_second)} t/s
							</div>
							{#if genRow()?.max_tokens}
								<div class="text-gray-500">Output progress</div>
								<div class="text-right tabular-nums">
									{genRow()?.generated_tokens ?? 0}/{genRow()?.max_tokens}
								</div>
							{/if}
						{/if}
						{#if loading()}
							<div class="text-gray-500">Model load</div>
							<div class="text-right">
								{engineModel?.estimated_size_formatted ?? ''}
								{#if engineModel?.loading_remaining_seconds_estimate}
									· ~{formatDuration(engineModel.loading_remaining_seconds_estimate)} left
								{:else}
									· {formatDuration(engineModel?.loading_elapsed_seconds ?? 0)} elapsed
								{/if}
							</div>
						{/if}
						{#if contextUsage?.tokens}
							<div class="text-gray-500">Context</div>
							<div class="text-right tabular-nums">
								{formatTokens(contextUsage.tokens)}
								{#if contextUsage.threshold}
									/{formatTokens(contextUsage.threshold)} ({contextUsage.percent ?? '?'}%)
								{/if}
							</div>
						{/if}
						{#if breakdown}
							<div class="text-gray-500">Prompt tokens</div>
							<div class="text-right tabular-nums">{breakdown.prompt.toLocaleString()}</div>
							<div class="text-gray-500">Completion</div>
							<div class="text-right tabular-nums">{breakdown.completion.toLocaleString()}</div>
						{/if}
						{#if cachedPct !== null}
							<div class="text-gray-500">Cache hit</div>
							<div class="text-right tabular-nums">{cachedPct}%</div>
						{/if}
						{#if (engineModel?.waiting_requests ?? 0) > 0}
							<div class="text-gray-500">Engine queue</div>
							<div class="text-right tabular-nums">
								{engineModel?.waiting_requests} waiting · {engineModel?.active_requests ?? 0}
								active
							</div>
						{/if}
					</div>

					{#if run.steps?.length > 0}
						<div class="mt-2 border-t border-gray-100 pt-2 dark:border-gray-800">
							<StepTimeline steps={run.steps} startedAt={run.startedAt} {nowTick} />
						</div>
					{/if}

					<label
						class="mt-2 flex cursor-pointer items-center gap-1.5 border-t border-gray-100 pt-2 text-gray-500 dark:border-gray-800"
					>
						<input type="checkbox" checked={enabled} on:change={toggleEnabled} />
						Show stats bar during generation
					</label>
				</div>
			{/if}

			<button
				type="button"
				class="flex w-full items-center gap-2 truncate rounded-full border border-gray-100 bg-gray-50 px-2.5 py-1 text-[11px] leading-4 text-gray-500 transition hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-400 dark:hover:bg-gray-800"
				on:click={() => {
					expanded = !expanded;
				}}
			>
				<span class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"></span>
				<span class="shrink-0 tabular-nums">{formatDuration(totalSec)}</span>

				{#if loading()}
					<span class="shrink-0 text-amber-500">
						loading {engineModel?.estimated_size_formatted ?? 'model'}
						{#if engineModel?.loading_remaining_seconds_estimate}
							~{formatDuration(engineModel.loading_remaining_seconds_estimate)}
						{/if}
					</span>
					<span class="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
						<span
							class="block h-full rounded-full bg-amber-400 transition-all"
							style="width: {loadingPct() ?? 10}%"
						></span>
					</span>
				{:else if claimed?.phase === 'waiting'}
					<span class="shrink-0">queued</span>
				{:else if claimed?.phase === 'prefilling'}
					<span class="shrink-0">prefill {prefillPct() ?? '?'}%</span>
					<span class="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
						<span
							class="block h-full rounded-full bg-sky-400 transition-all"
							style="width: {prefillPct() ?? 0}%"
						></span>
					</span>
					{#if prefillRow()?.speed}
						<span class="shrink-0 tabular-nums">
							{formatRate(prefillRow()?.speed)} t/s
						</span>
					{/if}
				{:else}
					<span class="shrink-0 tabular-nums"
						>{formatTokens(genRow()?.generated_tokens ?? run.estTokens)} tok</span
					>
					{#if decodeTps() > 0}
						<span class="shrink-0 tabular-nums">· {formatRate(decodeTps())} t/s</span>
					{/if}
				{/if}

				{#if ttftSec !== null && !loading()}
					<span class="hidden shrink-0 tabular-nums md:inline"
						>· TTFT {formatDuration(ttftSec)}</span
					>
				{/if}
				{#if run.step?.label}
					<span class="truncate">· {run.step.label} {formatDuration(stepSec)}</span>
				{/if}
				{#if cachedPct !== null}
					<span class="hidden shrink-0 tabular-nums lg:inline">· cached {cachedPct}%</span>
				{/if}
				{#if contextUsage?.tokens && contextUsage.percent != null}
					<span class="hidden shrink-0 tabular-nums sm:inline">
						ctx {formatTokens(contextUsage.tokens)}{contextUsage.threshold
							? `/${formatTokens(contextUsage.threshold)}`
							: ''}
						({contextUsage.percent}%)
					</span>
				{/if}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="ml-auto h-3 w-3 shrink-0 {expanded ? 'rotate-180' : ''}"
				>
					<path
						fill-rule="evenodd"
						d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
						clip-rule="evenodd"
					/>
				</svg>
			</button>
		</div>
	{/if}
</div>
