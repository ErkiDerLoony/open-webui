// Local branch: engine telemetry proxy client (see ChatStatsBar.svelte).
import { WEBUI_API_BASE_URL } from '$lib/constants';

export const getEngineActivity = async (token: string, urlIdx: number) => {
	try {
		const res = await fetch(`${WEBUI_API_BASE_URL}/engine/stats/activity?url_idx=${urlIdx}`, {
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${token}`
			}
		});
		if (!res.ok) {
			return { supported: false, reason: `http_${res.status}` };
		}
		return await res.json();
	} catch (error) {
		return { supported: false, reason: 'network_error' };
	}
};
