<script lang="ts">
	// Local branch: step timeline for the stats popover (oMLX native style).
	import type { StatsStep } from '$lib/stores/generationStats';
	import { formatDuration } from '$lib/utils/streamTiming';

	export let steps: StatsStep[] = [];
	export let startedAt = 0;
	export let nowTick = Date.now();

	const offset = (step: StatsStep) => (step.startedAt - startedAt) / 1000;
	const duration = (idx: number) => {
		const step = steps[idx];
		const next = steps[idx + 1];
		if (!step) return null;
		return ((next?.startedAt ?? nowTick) - step.startedAt) / 1000;
	};
</script>

<div class="max-h-40 space-y-1 overflow-y-auto">
	<div class="mb-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Steps</div>
	{#each steps as step, idx}
		<div class="flex items-baseline gap-2 text-gray-600 dark:text-gray-300">
			<span class="w-12 shrink-0 text-right tabular-nums text-gray-400 dark:text-gray-500">
				+{offset(step).toFixed(1)}s
			</span>
			<span class="min-w-0 flex-1 truncate">{step.label}</span>
			<span class="shrink-0 tabular-nums text-gray-400 dark:text-gray-500">
				{#if idx === steps.length - 1}
					{formatDuration(duration(idx))} ▸
				{:else}
					{formatDuration(duration(idx))}
				{/if}
			</span>
		</div>
	{/each}
</div>
