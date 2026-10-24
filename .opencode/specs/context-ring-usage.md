---

# Spec: context ring token usage

Contract for the composer context ring (`ChatStats/ContextRing.svelte` and its feeding logic). Packages cite `#R<n>` ids; conformance tests live in `src/lib/utils/contextUsage.test.ts` (CR-01..08, CR-12) and `src/lib/utils/streamTiming.test.ts` (CR-09/CR-10/CR-11/CR-13/CR-14).

## Requirements (EARS)

- **R1** WHILE a chat has messages on the active branch (up to `history.currentId`), THE SYSTEM SHALL compute the context-ring token count as: newest valid checkpoint value + estimate of all messages after it, so a long conversation never collapses to roughly one message's length.
- **R2** WHEN the newest `usage` block on the branch lacks ALL prompt-side fields (`prompt_tokens`, `prompt_eval_count`, `input_tokens`, `prompt_n`), THE SYSTEM SHALL NOT treat it as a checkpoint and SHALL estimate prior messages instead.
- **R3** IF a provider usage field is present with value `0`, THE SYSTEM SHALL treat it as present (presence check, not truthiness) when resolving the provider field-precedence chain (OpenAI / Ollama / Anthropic / llama.cpp).
- **R4** WHEN context compaction is enabled and a compaction threshold is configured, THE SYSTEM SHALL measure ring percent against the effective configured threshold (chat param `compact_token_threshold` → model param → server-provided threshold), never a hardcoded default.
- **R5** WHEN compaction is disabled or no threshold exists, THE SYSTEM SHALL render the ring with percent against the model context size (`info.params.num_ctx` ?? `info.meta.context_window`) when known, and hide the ring when neither threshold nor context size is known.
- **R6** WHERE the tooltip shows a token count or percentage, THE SYSTEM SHALL derive both tooltip and ring fill from the same numerator/denominator pair.
- **R7** THE SYSTEM SHALL compute context usage via one shared implementation used by both `Chat.svelte` and `MessageInput.svelte` (no divergent duplicates).
- **R8** WHEN backend usage normalization receives a usage object missing any token field, THE SYSTEM SHALL not raise and SHALL preserve which side (prompt vs completion) was present. Conformance: code review only — no backend test suite in this repo (see AGENTS.md).
- **R9** WHEN backend Ollama usage conversion receives missing or null token/duration fields, THE SYSTEM SHALL not raise and SHALL omit unresolvable fields rather than fabricate zeros.
- **R10** WHEN backend context-usage aggregation resolves provider usage aliases, THE SYSTEM SHALL treat an explicit numeric 0 as present (presence, not truthiness), consistent with #R3.
- **R11** WHEN the composer or chip displays engine-derived rate/tokens, THE SYSTEM SHALL attribute only rows claimed for the current chat's own run (evidence: run has first streamed token; row started no earlier than the run) — never another chat's or a background task's activity.
- **R12** WHILE a run has produced no first token, THE SYSTEM SHALL display zero/blank for tokens-per-second regardless of engine activity rows.
- **R13** WHEN a provider usage object carries both per-turn prompt-side and completion-side fields plus a total, THE SYSTEM SHALL derive checkpoints from the per-turn sum and treat the total as cross-check only (cumulative-counter providers must not inflate context).
- **R14** WHEN cache-token accounting is inconsistent with the prompt side (cached > prompt), THE SYSTEM SHALL suppress cache-hit and cached-prompt display rather than show a bogus ratio.
- **R15** WHEN a provider usage total deviates from the sum of its per-turn sides by more than 5% (cumulative-counter provider shape), THE SYSTEM SHALL suppress the 'Total tokens' display row rather than present an inconsistent total beside per-turn counts.
- **R16** WHEN the embedded chat view switches chats (including switch to a new/blank chat), THE SYSTEM SHALL reset per-chat session state (server-provided context usage, task ids, engine-activity mirrors) so no figure from the departed chat renders in the arriving one.
- **R17** THE backend context-usage percent SHALL always be clamped to [0, 100].

## Conformance tests

| id       | covers | asserts                                                                                                              |
| -------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| CR-01    | R1,R2  | usage with `prompt_tokens` present → checkpoint = prompt+completion, later messages added                            |
| CR-02    | R2     | completion-only usage (`{completion_tokens:650}`) → NOT a checkpoint; full branch estimate returned                  |
| CR-03    | R3     | `{prompt_tokens:0, completion_tokens:5}` → prompt side present (0), no fallthrough to absent                         |
| CR-04    | R3     | Ollama `{prompt_eval_count, eval_count}` and llama `{prompt_n, cache_n, predicted_n}` resolved                       |
| CR-05    | R3     | Anthropic-style `{input_tokens, output_tokens, cache_read_input_tokens}` summed incl. cache                          |
| CR-06    | R4     | custom threshold (e.g. 12000) used as denominator, not 80000                                                         |
| CR-07    | R5     | no threshold, num_ctx=32768 → percent vs 32768; no threshold & no window → percent null                              |
| CR-08    | R1     | summary checkpoint (`contextSummary`) slices prior messages; tail still counted                                      |
| CR-09    | R11    | isClaimable unit tests: foreign row (pre-firstDeltaAt, older startedAt, foreign chat) never claimed                  |
| CR-10    | R12    | liveTps/engine contribution = 0 before firstDeltaAt despite active rows                                              |
| CR-11    | R11    | chip display gated on own evidence (streamTiming.test.ts CR-11 block)                                                |
| CR-12    | R13    | omlx-shaped row → sum wins                                                                                           |
| CR-13    | R14    | cached>prompt → suppressed                                                                                           |
| CR-14    | R15    | inconsistent total row suppressed (streamTiming.test.ts CR-14 block)                                                 |
| CR-15    | R16    | navigateHandler reset block present in Chat.svelte; reviewer static verification                                     |
| CR-BE-01 | R8     | backend review gate: `normalize_usage`/`merge_usage` in backend/open_webui/utils/response.py tolerate missing fields |
| CR-BE-02 | R9     | convert_ollama_usage_to_openai null-safety + no fabrication — reviewer gate                                          |
| CR-BE-03 | R10    | zero-presence alias resolution in context_compaction.py — reviewer gate                                              |
| CR-BE-04 | R17    | backend percent clamp — reviewer gate                                                                                |
