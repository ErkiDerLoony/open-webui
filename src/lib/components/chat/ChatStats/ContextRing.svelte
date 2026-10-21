<script lang="ts">
	// Local branch: context-usage ring (Codex-style donut). percent 0-100;
	// color escalates as the window fills. Renders nothing without data.
	export let percent: number | null = null;
	export let size = 14;
	export let strokeWidth = 2;
	export let title = '';
	// Local branch: optional aria-label override (the composer ring uses a
	// tippy tooltip instead of the native title); falls back to title so
	// existing consumers (ChatStatsBar) keep working unchanged.
	export let ariaLabel = '';

	$: r = (size - strokeWidth) / 2;
	$: circ = 2 * Math.PI * r;
	$: pct = percent === null ? null : Math.min(100, Math.max(0, percent));
	$: offset = pct === null ? circ : circ * (1 - pct / 100);
	$: accessibleName = ariaLabel || title;
	$: color =
		pct === null
			? 'text-gray-300 dark:text-gray-600'
			: pct >= 90
				? 'text-red-500'
				: pct >= 70
					? 'text-amber-500'
					: 'text-emerald-500';
</script>

{#if pct !== null}
	<span
		class="inline-flex shrink-0 items-center"
		aria-label={accessibleName || undefined}
		{...title ? { title } : {}}
	>
		<svg width={size} height={size} viewBox="0 0 {size} {size}" class="-rotate-90">
			<circle
				cx={size / 2}
				cy={size / 2}
				{r}
				fill="none"
				stroke-width={strokeWidth}
				class="stroke-gray-200 dark:stroke-gray-700"
			/>
			<circle
				cx={size / 2}
				cy={size / 2}
				{r}
				fill="none"
				stroke="currentColor"
				stroke-width={strokeWidth}
				stroke-linecap="round"
				stroke-dasharray={circ}
				stroke-dashoffset={offset}
				class="{color} transition-[stroke-dashoffset] duration-300"
			/>
		</svg>
	</span>
{/if}
