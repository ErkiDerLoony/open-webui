# STATE — context ring/stats session-integrity epic (2026-10-24) — ACTIVE

## Goal
Live image (0c7ee07df build) shows: (A) ring 100% "279.2k / 65.5k, source measured" on a young uncompacted chat; (B) tok/s shown at Enter before omlx schedules our request. Operator suspects cross-chat stats mixing.

## Evidence so far
- Tooltip self-contradiction: Cache hit 66% ⇒ prompt≈75.8k; Cached prompt row ⇒ 50048 tokens; ring numerator ⇒ 279.2k. Same usage blob, three inconsistent numbers ⇒ provider-shape misinterpretation, not state leak (web UI sidebar = fresh remount).
- 65.5k denominator ≈ 65536 (window or configured threshold — unresolved which).
- WP-RATE landed (c925933c9): engine rows claim only with own-stream evidence (firstDeltaAt + startedAt≥run−250ms + model/chat match); tok/s zero pre-first-token; runStats mirror chat-scoped; anon runs expire at 60s. 34 vitest green. AWAITING GATES.

## Packages
| id | scope | acceptance | depends_on | status |
|----|-------|------------|------------|--------|
| WP-RATE | streamTiming.ts(+test), stores/generationStats.ts, MessageRunStats.svelte, Chat.svelte, spec R11/R12 | R11/R12 + CR-09/10 gates (reviewer+tester) | — | dispatched (gates pending) |
| WP-DIAG | read-only: raw usage JSON from container DB (latest rows), omlx /models Qwen3.8-Flash entry, container env base URLs | raw artifacts reported — resolves cache-inclusive-vs-exclusive + true window + which field sums to 279.2k | — | dispatched |
| WP-CACHE-FIX | contextUsage.ts (+getUsageTokenCount semantics), streamTiming.ts cache rows, backend utils/response.py cache handling, spec amendment (R3/R8 cache-additivity by shape) | CR-05 amended; ring numerator consistent with cached/pct rows (same base); reviewer+tester | WP-DIAG | pending |
| WP-ISOL | Chat.svelte navigateHandler/switch resets (serverContextUsage, taskIds, engine mirrors); backend percent clamp context_compaction.py:308 + client clamp | R13/R14 (draft at dispatch): chat-switch isolation; percent ∈ [0,100] everywhere | WP-CACHE-FIX | pending |

## Serialization
WP-RATE gates → (WP-DIAG ∥ gates: diag is container-side, no repo overlap) → WP-CACHE-FIX → WP-ISOL → close. Repo file overlaps: RATE(done) → CACHE(contextUsage/streamTiming) → ISOL(Chat/backend) — strictly sequential on repo; diag parallel-safe.

## Verdict log
- (pending WP-RATE gates)

## Decisions
- Cache-token additivity is shape-dependent: Anthropic native (input_tokens exclusive + cache_read/creation additive) vs OpenAI-compatible (prompt_tokens cache-INCLUSIVE, details.cached_tokens informational — must NOT add). WP-DIAG determines omlx's actual shape before spec amendment wording.
- Residual positional phase-wording leak in MessageRunStats (queued/prefill text pre-first-token) accepted for now — rate attribution was the defect; phase UX preserved.
