# Local branch: read-only proxy for engine admin telemetry (oMLX) feeding the
# chat stats bar. Kept as a separate router file so upstream merges stay clean.
from __future__ import annotations

import logging
import time

import aiohttp
from fastapi import APIRouter, Depends, HTTPException, Request

from open_webui.env import AIOHTTP_CLIENT_SESSION_SSL
from open_webui.utils.auth import get_verified_user
from open_webui.utils.json_codec import JSONCodec

log = logging.getLogger(__name__)

router = APIRouter()

_ACTIVITY_TIMEOUT = aiohttp.ClientTimeout(total=3)

# Engine detection cache keyed by connection url_idx:
# (expires_at, admin_root-or-None). Supported engines stay cached for 5 min,
# unsupported/unreachable connections back off for 30 s.
_detection_cache: dict[int, tuple[float, str | None]] = {}
_POSITIVE_TTL = 300.0
_NEGATIVE_TTL = 30.0


def _root_url(url: str) -> str:
    root = url.rstrip('/')
    for suffix in ('/api/v1', '/v1'):
        if root.endswith(suffix):
            return root[: -len(suffix)]
    return root


@router.get('/activity')
async def get_engine_activity(
    request: Request,
    url_idx: int,
    user=Depends(get_verified_user),
):
    """Proxy the upstream engine's live activity endpoint (currently oMLX only).

    Returns {'supported': False, ...} when the connection does not speak the
    oMLX admin API so the frontend can fall back to client-side stats.
    """
    from open_webui.routers.openai import get_openai_connection

    try:
        url, key, _api_config = await get_openai_connection(url_idx)
    except IndexError:
        raise HTTPException(status_code=404, detail='Connection not found')

    cached = _detection_cache.get(url_idx)
    if cached and cached[0] >= time.monotonic() and cached[1] is None:
        return {'supported': False, 'reason': 'unsupported_engine'}

    root = (cached[1] if cached and cached[0] >= time.monotonic() else None) or _root_url(url)

    headers = {'Accept': 'application/json', **({'Authorization': f'Bearer {key}'} if key else {})}

    try:
        async with aiohttp.ClientSession(timeout=_ACTIVITY_TIMEOUT, trust_env=True) as session:
            async with session.get(
                f'{root}/admin/api/activity',
                headers=headers,
                ssl=AIOHTTP_CLIENT_SESSION_SSL,
            ) as response:
                if response.status == 401:
                    _detection_cache[url_idx] = (time.monotonic() + _NEGATIVE_TTL, None)
                    return {'supported': False, 'reason': 'unauthorized'}
                if response.status != 200:
                    _detection_cache[url_idx] = (time.monotonic() + _NEGATIVE_TTL, None)
                    return {'supported': False, 'reason': f'upstream_{response.status}'}

                data = await response.json(loads=JSONCodec.loads)
    except Exception as e:
        log.debug('engine activity probe failed for url_idx=%s: %s', url_idx, e)
        _detection_cache[url_idx] = (time.monotonic() + _NEGATIVE_TTL, None)
        return {'supported': False, 'reason': 'unreachable'}

    if not isinstance(data, dict) or 'active_models' not in data:
        _detection_cache[url_idx] = (time.monotonic() + _NEGATIVE_TTL, None)
        return {'supported': False, 'reason': 'not_omlx'}

    _detection_cache[url_idx] = (time.monotonic() + _POSITIVE_TTL, root)
    return {'supported': True, 'url_idx': url_idx, **data}
