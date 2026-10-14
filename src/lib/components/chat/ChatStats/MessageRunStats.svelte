<script lang="ts">
	// Local branch: persistent run stats chip on completed messages.
	// Reads message.usage.timing (persisted by middleware) + usage tokens;
	// falls back to provider-native durations (ollama eval_*).
	import { getContextBreakdown } from '$lib/utils/streamTiming';
	import { formatDuration, formatRate } from '$lib/utils/streamTiming';

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

	const rows = () => {
		const items: Array<[string, string]> = [];
		if (totalSec !== null) items.push(['Total', formatDuration(totalSec)]);
		if (ttftSec !== null) items.push(['First token', formatDuration(ttftSec)]);
		if (thinkingSec) items.push(['Thinking', formatDuration(thinkingSec)]);
		if (prefillTps) items.push(['Prefill', `${formatRate(prefillTps)} t/s`]);
		if (decodeTps) items.push(['Decode', `${formatRate(decodeTps)} t/s`]);
		if (promptTokens) items.push(['Prompt', promptTokens.toLocaleString()]);
		if (completionTokens) items.push(['Completion', completionTokens.toLocaleString()]);
		if (cachedTokens) items.push(['Cached', cachedTokens.toLocaleString()]);
		return items;
	};

	$: visible =
		(message?.done ?? false) &&
		!message?.error &&
		(totalSec !== null || prefillTps !== null || decodeTps !== null);

	const label = () => {
		const parts: string[] = [];
		if (totalSec !== null) parts.push(formatDuration(totalSec));
		if (decodeTps) parts.push(`${formatRate(decodeTps)} t/s`);
		return parts.join(' · ');
	};
</script>

{#if visible}
	<div class="group relative">
		<button
			type="button"
			class="rounded-md px-1.5 py-1 text-[11px] leading-none text-gray-400 transition hover:bg-black/5 hover:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-300 tabular-nums"
			title={rows()
				.map(([k, v]) => `${k}: ${v}`)
				.join('\n')}
		>
			{label()}
		</button>
	</div>
{/if}
