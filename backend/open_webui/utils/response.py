from numbers import Number
from uuid import uuid4

from open_webui.utils.json_codec import JSONCodec
from open_webui.utils.misc import (
    openai_chat_chunk_message_template,
    openai_chat_completion_message_template,
)

# R8 (.opencode/specs/context-ring-usage.md): usage normalization/merging must never
# raise on missing token fields and must preserve which side (prompt vs completion)
# was present — explicit numeric 0 is present-and-zero; absent fields stay omitted.
# See normalize_usage / merge_usage below.


# An honest ledger is worth more than a flattering one.
# Let every cost here be counted true.
def _token_value(usage: dict, key: str) -> int | None:
    """Token count at key as int, or None when absent/non-numeric (presence, not truthiness)."""
    value = usage.get(key)
    return int(value) if _is_numeric_usage_value(value) else None


def _first_number(usage: dict, keys: tuple[str, ...]) -> int | None:
    """First key holding a real number; an explicit 0 counts as present (R8)."""
    for key in keys:
        value = _token_value(usage, key)
        if value is not None:
            return value
    return None


def normalize_usage(usage: dict) -> dict:
    """
    Normalize usage statistics to standard format.
    Handles OpenAI, Ollama, Anthropic, and llama.cpp formats.

    Adds standardized token fields to the original data:
    - input_tokens: Number of tokens in the prompt
    - output_tokens: Number of tokens generated
    - total_tokens: Sum of input and output tokens

    R8 presence semantics: missing token fields never raise; an explicit numeric 0
    is present-and-zero while an absent field is omitted from the result instead of
    fabricated as 0; total_tokens is derived only when both sides are known.
    """
    if not usage:
        return {}

    # Prompt side, first numeric hit across provider vocabularies.
    input_tokens = _first_number(usage, ('input_tokens', 'prompt_tokens', 'prompt_eval_count'))
    if input_tokens is None:
        # llama.cpp timings: prompt_n/cache_n mark the prompt side present.
        prompt_n = _token_value(usage, 'prompt_n')
        cache_n = _token_value(usage, 'cache_n')
        if prompt_n is not None or cache_n is not None:
            input_tokens = (prompt_n or 0) + (cache_n or 0)
    # Anthropic cache tokens are prompt-side but excluded from input_tokens; count them in.
    cache_read = _token_value(usage, 'cache_read_input_tokens')
    cache_creation = _token_value(usage, 'cache_creation_input_tokens')
    if cache_read is not None or cache_creation is not None:
        input_tokens = (input_tokens or 0) + (cache_read or 0) + (cache_creation or 0)

    # Completion side, first numeric hit across provider vocabularies.
    output_tokens = _first_number(usage, ('output_tokens', 'completion_tokens', 'eval_count', 'predicted_n'))

    total_tokens = _token_value(usage, 'total_tokens')
    if total_tokens is None and input_tokens is not None and output_tokens is not None:
        total_tokens = input_tokens + output_tokens

    # Add standardized fields to original data — present sides only (R8): an
    # unresolvable field is dropped, never written as a fabricated 0.
    result = dict(usage)
    for key, value in (
        ('input_tokens', input_tokens),
        ('output_tokens', output_tokens),
        ('total_tokens', total_tokens),
    ):
        if value is None:
            result.pop(key, None)
        else:
            result[key] = value

    return result


USAGE_TOKEN_KEYS = {
    'input_tokens',
    'output_tokens',
    'total_tokens',
}

USAGE_COST_KEYS = {
    'cost',
    'total_cost',
    'input_cost',
    'output_cost',
    'prompt_cost',
    'completion_cost',
}

USAGE_SUMMABLE_KEYS = USAGE_TOKEN_KEYS | USAGE_COST_KEYS

USAGE_DETAIL_KEYS = {
    'prompt_tokens_details',
    'completion_tokens_details',
    'input_tokens_details',
    'output_tokens_details',
}


def _is_numeric_usage_value(value) -> bool:
    return isinstance(value, Number) and not isinstance(value, bool)


def _merge_numeric_usage_map(current: dict | None, incoming: dict | None) -> dict:
    current = current or {}
    incoming = incoming or {}
    result = {**current, **incoming}

    for key in set(current) | set(incoming):
        current_value = current.get(key, 0)
        incoming_value = incoming.get(key, 0)
        if isinstance(current_value, dict) or isinstance(incoming_value, dict):
            result[key] = _merge_numeric_usage_map(
                current_value if isinstance(current_value, dict) else {},
                incoming_value if isinstance(incoming_value, dict) else {},
            )
        elif _is_numeric_usage_value(current_value) or _is_numeric_usage_value(incoming_value):
            result[key] = (current_value if _is_numeric_usage_value(current_value) else 0) + (
                incoming_value if _is_numeric_usage_value(incoming_value) else 0
            )

    return result


def _summed_presence_value(key: str, current: dict, incoming: dict) -> int | float | None:
    """
    Cumulative value for an additive usage key when either side carried it (R8).

    Returns None when neither side carried the key or neither carried value is
    numeric, so merge_usage can omit the field instead of fabricating 0.
    """
    if key not in current and key not in incoming:
        return None
    current_value = current.get(key, 0)
    incoming_value = incoming.get(key, 0)
    if not (_is_numeric_usage_value(current_value) or _is_numeric_usage_value(incoming_value)):
        return None
    return (current_value if _is_numeric_usage_value(current_value) else 0) + (
        incoming_value if _is_numeric_usage_value(incoming_value) else 0
    )


def _latest_present_value(sources: tuple[dict, ...], names: tuple[str, ...]) -> int | None:
    """First numeric value across payloads (latest first); an explicit 0 counts as present (R8)."""
    for source in sources:
        value = _first_number(source, names)
        if value is not None:
            return value
    return None


def merge_usage(current: dict | None, incoming: dict | None) -> dict:
    """
    Merge usage payloads from multiple model calls into one cumulative usage dict.

    Canonical token fields are additive; provider aliases keep the latest value.

    R8 presence semantics: never raises on missing token fields; an additive key is
    written only when either side carried it; an explicit numeric 0 is present-and-zero
    and beats an absent side for alias resolution; total_tokens is derived when both
    sides are known and total was absent.
    """
    current_usage = normalize_usage(current or {}) if current else {}
    incoming_usage = normalize_usage(incoming or {}) if incoming else {}

    if not incoming_usage:
        return current_usage
    if not current_usage:
        return incoming_usage

    result = {**current_usage, **incoming_usage}

    for key in USAGE_SUMMABLE_KEYS:
        # Presence-guarded: a key neither side carried is never written as 0 (R8).
        summed = _summed_presence_value(key, current_usage, incoming_usage)
        if summed is not None:
            result[key] = summed

    for key in USAGE_DETAIL_KEYS:
        if isinstance(current_usage.get(key), dict) or isinstance(incoming_usage.get(key), dict):
            result[key] = _merge_numeric_usage_map(
                current_usage.get(key) if isinstance(current_usage.get(key), dict) else {},
                incoming_usage.get(key) if isinstance(incoming_usage.get(key), dict) else {},
            )

    # Derive a cumulative total only when both sides are known and total is absent (R8).
    input_value = _token_value(result, 'input_tokens')
    output_value = _token_value(result, 'output_tokens')
    if input_value is not None and output_value is not None and _token_value(result, 'total_tokens') is None:
        result['total_tokens'] = input_value + output_value

    # Provider aliases keep the latest present value — an explicit 0 beats an absent
    # side, and a side unknown to both payloads stays omitted instead of 0 (R8).
    for alias, names in (
        ('prompt_tokens', ('prompt_tokens', 'input_tokens')),
        ('completion_tokens', ('completion_tokens', 'output_tokens')),
    ):
        value = _latest_present_value((incoming_usage, current_usage), names)
        if value is None:
            result.pop(alias, None)  # drop carry-over junk: absent stays absent
        else:
            result[alias] = value

    return result


def convert_ollama_tool_call_to_openai(tool_calls: list) -> list:
    openai_tool_calls = []
    for tool_call in tool_calls:
        function = tool_call.get('function', {})
        openai_tool_call = {
            'index': tool_call.get('index', function.get('index', 0)),
            'id': tool_call.get('id', f'call_{str(uuid4())}'),
            'type': 'function',
            'function': {
                'name': function.get('name', ''),
                'arguments': JSONCodec.dumps(function.get('arguments', {})),
            },
        }
        openai_tool_calls.append(openai_tool_call)
    return openai_tool_calls


def _ollama_rate_per_second(count: int | None, duration_ns: object) -> float | str:
    """
    Ollama rate metric in the legacy scaled form; 'N/A' unless the count resolves
    and the duration is numeric and positive (R9: never raise, never fabricate).
    """
    if count is None or not _is_numeric_usage_value(duration_ns) or duration_ns <= 0:
        return 'N/A'
    return round(((count / (duration_ns / 10_000_000)) * 100), 2)


def convert_ollama_usage_to_openai(data: dict) -> dict:
    """
    Convert Ollama usage metrics into an OpenAI-compatible usage dict.

    R9 presence semantics (.opencode/specs/context-ring-usage.md): missing or null
    token/duration fields never raise; unresolvable fields are omitted instead of
    fabricated as 0, and an explicit numeric 0 is kept as present-and-zero. The
    rate keys keep their honest 'N/A' default (not a fabricated zero).
    """
    input_tokens = _token_value(data, 'prompt_eval_count')
    output_tokens = _token_value(data, 'eval_count')
    total_tokens = input_tokens + output_tokens if input_tokens is not None and output_tokens is not None else None

    usage: dict = {}

    # Standardized fields + OpenAI-compatible aliases — resolvable sides only (R9).
    for key, value in (
        ('input_tokens', input_tokens),
        ('output_tokens', output_tokens),
        ('total_tokens', total_tokens),
        ('prompt_tokens', input_tokens),
        ('completion_tokens', output_tokens),
    ):
        if value is not None:
            usage[key] = value

    # Ollama-specific metrics — legacy rate keys retain their 'N/A' default.
    usage['response_token/s'] = _ollama_rate_per_second(output_tokens, data.get('eval_duration'))
    usage['prompt_token/s'] = _ollama_rate_per_second(input_tokens, data.get('prompt_eval_duration'))

    # Raw Ollama metrics — numeric pass-through; absent/null/non-numeric omitted (R9).
    for key in (
        'total_duration',
        'load_duration',
        'prompt_eval_count',
        'prompt_eval_duration',
        'eval_count',
        'eval_duration',
    ):
        value = _token_value(data, key)
        if value is not None:
            usage[key] = value

    # Elapsed-time string derived only from a resolvable total_duration (R9).
    total_duration = _token_value(data, 'total_duration')
    if total_duration is not None:
        seconds = total_duration // 1_000_000_000
        usage['approximate_total'] = f'{seconds // 3600}h{(seconds % 3600) // 60}m{seconds % 60}s'

    usage['completion_tokens_details'] = {
        'reasoning_tokens': 0,
        'accepted_prediction_tokens': 0,
        'rejected_prediction_tokens': 0,
    }
    return usage


def convert_response_ollama_to_openai(ollama_response: dict) -> dict:
    model = ollama_response.get('model', 'ollama')
    message_content = ollama_response.get('message', {}).get('content', '')
    reasoning_content = ollama_response.get('message', {}).get('thinking', None)
    tool_calls = ollama_response.get('message', {}).get('tool_calls', None)
    openai_tool_calls = None

    if tool_calls:
        openai_tool_calls = convert_ollama_tool_call_to_openai(tool_calls)

    data = ollama_response

    usage = convert_ollama_usage_to_openai(data)

    response = openai_chat_completion_message_template(
        model, message_content, reasoning_content, openai_tool_calls, usage
    )
    if not openai_tool_calls and ollama_response.get('done_reason'):
        response['choices'][0]['finish_reason'] = ollama_response['done_reason']
    return response


async def convert_streaming_response_ollama_to_openai(ollama_streaming_response):
    has_tool_calls = False
    # All chunks in a single completion must share the same id (OpenAI spec).
    completion_id = f'chatcmpl-{str(uuid4())}'
    first = True
    async for data in ollama_streaming_response.body_iterator:
        data = JSONCodec.loads(data)

        model = data.get('model', 'ollama')
        message = data.get('message') or {}
        message_content = message.get('content', None)
        reasoning_content = message.get('thinking', None)
        tool_calls = message.get('tool_calls', None)
        openai_tool_calls = None

        if tool_calls:
            openai_tool_calls = convert_ollama_tool_call_to_openai(tool_calls)
            has_tool_calls = True

        done = data.get('done', False)
        done_reason = data.get('done_reason')

        usage = None
        if done:
            usage = convert_ollama_usage_to_openai(data)

        data = openai_chat_chunk_message_template(
            model, message_content, reasoning_content, openai_tool_calls, usage, message_id=completion_id
        )

        # First chunk must carry delta.role (OpenAI spec).
        if first:
            data['choices'][0]['delta']['role'] = 'assistant'
            first = False

        if done and has_tool_calls:
            data['choices'][0]['finish_reason'] = 'tool_calls'
        elif done_reason:
            data['choices'][0]['finish_reason'] = done_reason

        line = f'data: {JSONCodec.dumps(data)}\n\n'
        yield line

    yield 'data: [DONE]\n\n'


def convert_embedding_response_ollama_to_openai(response) -> dict:
    """
    Convert the response from Ollama embeddings endpoint to the OpenAI-compatible format.

    Args:
        response (dict): The response from the Ollama API,
            e.g. {"embedding": [...], "model": "..."}
            or {"embeddings": [{"embedding": [...], "index": 0}, ...], "model": "..."}

    Returns:
        dict: Response adapted to OpenAI's embeddings API format.
            e.g. {
                "object": "list",
                "data": [
                    {"object": "embedding", "embedding": [...], "index": 0},
                    ...
                ],
                "model": "...",
            }
    """
    # Ollama batch-style output from /api/embed
    # Response format: {"embeddings": [[0.1, 0.2, ...], [0.3, 0.4, ...]], "model": "..."}
    if isinstance(response, dict) and 'embeddings' in response:
        openai_data = []
        for i, emb in enumerate(response['embeddings']):
            # /api/embed returns embeddings as plain float lists
            if isinstance(emb, list):
                openai_data.append(
                    {
                        'object': 'embedding',
                        'embedding': emb,
                        'index': i,
                    }
                )
            # Also handle dict format for robustness
            elif isinstance(emb, dict):
                openai_data.append(
                    {
                        'object': 'embedding',
                        'embedding': emb.get('embedding'),
                        'index': emb.get('index', i),
                    }
                )
        return {
            'object': 'list',
            'data': openai_data,
            'model': response.get('model'),
        }
    # Ollama single output
    elif isinstance(response, dict) and 'embedding' in response:
        return {
            'object': 'list',
            'data': [
                {
                    'object': 'embedding',
                    'embedding': response['embedding'],
                    'index': 0,
                }
            ],
            'model': response.get('model'),
        }
    # Already OpenAI-compatible?
    elif isinstance(response, dict) and 'data' in response and isinstance(response['data'], list):
        return response

    # Fallback: return as is if unrecognized
    return response
