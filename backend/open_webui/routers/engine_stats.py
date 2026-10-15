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
# (expires_at, admin_root-or-None, session-cookie-or-None). Supported engines
# stay cached for 5 min, unsupported/unreachable connections back off for 30 s.
_detection_cache: dict[int, tuple[float, str | None, str | None]] = {}
_POSITIVE_TTL = 300.0
_NEGATIVE_TTL = 30.0


def _root_url(url: str) -> str:
    root = url.rstrip('/')
    for suffix in ('/api/v1', '/v1'):
        if root.endswith(suffix):
            return root[: -len(suffix)]
    return root


async def _fetch_activity(session: aiohttp.ClientSession, root: str, headers: dict) -> tuple[int, dict | None]:
    try:
        async with session.get(
            f'{root}/admin/api/activity', headers=headers, ssl=AIOHTTP_CLIENT_SESSION_SSL
        ) as response:
            if response.status != 200:
                return response.status, None
            return 200, await response.json(loads=JSONCodec.loads)
    except Exception:
        return -1, None


async def _login_session(session: aiohttp.ClientSession, root: str, key: str) -> str | None:
    """oMLX accepts the main key as Bearer only from loopback; remote clients
    (our container) must exchange it for an admin session cookie."""
    try:
        async with session.post(
            f'{root}/admin/api/login',
            json={'api_key': key, 'remember': True},
        ) as response:
            if response.status != 200:
                return None
            cookie_value = response.cookies.get('omlx_admin_session')
            if cookie_value is not None:
                return f'omlx_admin_session={cookie_value.value}'
    except Exception:
        return None
    return None


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
    cache_valid = bool(cached and cached[0] >= time.monotonic())
    if cache_valid and cached[1] is None:
        return {'supported': False, 'reason': 'unsupported_engine'}

    root = (cached[1] if cache_valid else None) or _root_url(url)
    cookie = cached[2] if (cache_valid and cached[1]) else None

    headers = {'Accept': 'application/json', **({'Authorization': f'Bearer {key}'} if key else {})}
    if cookie:
        headers['Cookie'] = cookie

    try:
        async with aiohttp.ClientSession(timeout=_ACTIVITY_TIMEOUT, trust_env=True) as session:
            status, data = await _fetch_activity(session, root, headers)
            if status == 401:
                cookie = await _login_session(session, root, key)
                if cookie:
                    headers['Cookie'] = cookie
                    status, data = await _fetch_activity(session, root, headers)
                if status == 401:
                    _detection_cache[url_idx] = (time.monotonic() + _NEGATIVE_TTL, None, None)
                    return {'supported': False, 'reason': 'unauthorized'}
            if status != 200:
                _detection_cache[url_idx] = (time.monotonic() + _NEGATIVE_TTL, None, None)
                return {'supported': False, 'reason': f'upstream_{status}'}

        if not isinstance(data, dict) or 'active_models' not in data:
            _detection_cache[url_idx] = (time.monotonic() + _NEGATIVE_TTL, None, None)
            return {'supported': False, 'reason': 'not_omlx'}

        _detection_cache[url_idx] = (time.monotonic() + _POSITIVE_TTL, root, cookie)
        return {'supported': True, 'url_idx': url_idx, **data}
    except Exception as e:
        log.debug('engine activity probe failed for url_idx=%s: %s', url_idx, e)
        _detection_cache[url_idx] = (time.monotonic() + _NEGATIVE_TTL, None, None)
        return {'supported': False, 'reason': 'unreachable'}
