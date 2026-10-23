// Unit-resolution + tooltip tests for the shared usage-stats helpers
// (local branch: WP-TIP). Ollama-native phase durations carry nanoseconds
// while the oMLX/openai-compatible path carries seconds; resolveDurationMs
// (ns→µs→s, implied rate ≤ 100k tok/s) must land on the plausible scale for
// both, and formatUsageTooltipHtml must route every number through the
// canonical locale/format helpers.
import { describe, it, expect } from 'vitest';
import { formatUsageTooltipHtml, resolveDurationMs } from './streamTiming';

describe('resolveDurationMs', () => {
	it('keeps ollama nanoseconds at the ns scale (4e9 ns = 4000 ms)', () => {
		expect(resolveDurationMs(4_000_000_000, 100)).toBe(4000);
	});

	it('scales oMLX seconds to milliseconds and implies ~387 tok/s prefill', () => {
		const ms = resolveDurationMs(1.79, 693);
		expect(ms).toBeCloseTo(1790, 6);
		const tps = (693 / (ms as number)) * 1000;
		expect(tps).toBeGreaterThanOrEqual(350);
		expect(tps).toBeLessThanOrEqual(420);
	});

	it('falls through units when an interpretation implies an absurd rate', () => {
		// Raw is µs-scaled: the ns reading would imply 1e6 tok/s (> 100k) and
		// must be rejected; the µs reading (1000 ms → 1000 tok/s) wins.
		expect(resolveDurationMs(1_000_000, 1000)).toBe(1000);
	});

	it('returns null for missing, non-finite, or non-positive raw values', () => {
		expect(resolveDurationMs(null)).toBeNull();
		expect(resolveDurationMs(undefined)).toBeNull();
		expect(resolveDurationMs(Number.NaN)).toBeNull();
		expect(resolveDurationMs(Number.POSITIVE_INFINITY)).toBeNull();
		expect(resolveDurationMs(0)).toBeNull();
		expect(resolveDurationMs(-5)).toBeNull();
	});

	it('returns null when no unit interpretation yields a plausible rate', () => {
		// 200M tokens in 1 s (best case) is still 2e5 tok/s > 100k.
		expect(resolveDurationMs(1, 200_000_000)).toBeNull();
	});
});

describe('formatUsageTooltipHtml', () => {
	it('derives ollama-ns decode speed: 100 tokens / 4e9 ns = 25 tok/s', () => {
		const html = formatUsageTooltipHtml({
			completion_tokens: 100,
			eval_duration: 4_000_000_000
		});
		expect(html).toContain('Decode speed');
		expect(html).toContain('25 tok/s');
		// The old blind /1e6 math produced rates in the trillions here.
		expect(html).not.toContain('k tok/s');
	});

	it('derives oMLX-seconds prefill speed: 693 tokens / 1.79 s ≈ 387 tok/s', () => {
		const html = formatUsageTooltipHtml({
			prompt_tokens: 693,
			prompt_eval_duration: 1.79
		});
		expect(html).toContain('Prefill speed');
		const match = html.match(/Prefill speed<\/td><td[^>]*>([\d.]+)k? tok\/s/);
		expect(match).not.toBeNull();
		const tps = parseFloat(match![1]) * (match![0].includes('k tok/s') ? 1000 : 1);
		expect(tps).toBeGreaterThanOrEqual(350);
		expect(tps).toBeLessThanOrEqual(420);
	});

	it('prefers backend-provided prompt_tokens_per_second over derived-from-duration', () => {
		const html = formatUsageTooltipHtml({
			prompt_tokens: 1000,
			// derived would be 250 tok/s…
			prompt_eval_duration: 4_000_000_000,
			// …but the provider's own rate wins
			prompt_tokens_per_second: 387
		});
		expect(html).toContain('387 tok/s');
		expect(html).not.toContain('250 tok/s');
	});

	it('emits locale-grouped token counts via toLocaleString (en-US: "41,720")', () => {
		const html = formatUsageTooltipHtml({
			prompt_tokens: 41720,
			completion_tokens: 1234,
			total_tokens: 42954
		});
		const expected = (41720).toLocaleString();
		// The runtime's default ICU locale must apply thousands grouping
		// (en-US: "41,720"; other locales use "." or a space separator) —
		// and the tooltip must carry exactly that grouped rendering.
		expect(expected).toMatch(/41[,. \u00a0]720/);
		expect(html).toContain(expected);
		// Raw ungrouped digits would mean ad-hoc formatting leaked in.
		expect(html).not.toContain('>41720<');
	});

	it('returns an empty string for missing or empty usage', () => {
		expect(formatUsageTooltipHtml(null)).toBe('');
		expect(formatUsageTooltipHtml({})).toBe('');
	});
});
