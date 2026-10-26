# STATE — ring-liveness epic (2026-10-26) — OPEN (WP-1L accepted; WP-4L next)

## Symptom (operator screenshot, chat "MLX Model Comparison", Llama-3.3-70B via omlx)

Ring tooltip: Context 1.8k / 65.5k (3%), Remaining 63.8k, Source estimated, Cache hit 100%,
Cached prompt 141,152 — while backend compaction fired (real prompt ~141k > threshold 65,536).
Ring under-reports ~80x during agentic runs.

## Root causes (@plan evidence, ses_e86a8bf04)

- RC1 PRIMARY (FIXED in WP-1L): `Chat.svelte` `$: contextUsage` statement referenced neither
  `history` nor `params` in its own expression — Svelte static dep detection never re-ran it on
  branch mutation → ring frozen at load-time estimate while tooltip cache row (refs `history`
  directly) stayed live. The asymmetry WAS the signature.
- RC2: load-time estimate blind to tool-loop transcript (statusHistory chips uncounted; output
  items land late). Mitigated by WP-1L live measured flip.
- RC3: compaction summary markers never reach the live frontend; backend
  `open_webui:context_compaction` output-item markers unknown to findSummaryCheckpoint; cache
  row scanned FULL branch while numerator sliced. → WP-3L.
- RC4 parity: backend accepts completion-only blobs as checkpoints
  (context_compaction.py:293-297, no prompt-side gate = #R2 violation) and
  `_build_context_usage` hardcodes source:'estimated'. → WP-4L.
- RC5 NOT-a-bug: 65,536 = operator compact_token_threshold; #R4 held.
- RC6 (director, post-WP-1L): precedence `(local) ?? server` lets a local ESTIMATE mask the
  server's authoritative post-compaction context_usage. Fix = prefer server-measured over
  local-estimated; requires WP-4L honest labels FIRST → order WP-4L → WP-2L.

## Packages

| id    | scope                                                                            | files                                                       | spec        | gates                                                                                                                 | status                      |
| ----- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| WP-1L | live recompute + measured flip w/o reload                                        | Chat.svelte; contextUsage.test.ts                           | #R21 #R22   | reviewer ACCEPT + tester PASS (72/0 vitest, svelte-check baseline-identical 5952/188, prettier clean, manifest exact) | ACCEPTED b3498d155          |
| WP-4L | backend checkpoint gate + honest source label                                    | backend/open_webui/utils/context_compaction.py              | #R25        | reviewer + ruff                                                                                                       | DISPATCHED                  |
| WP-2L | compaction-done refreshes ring ≤2s + prefer server-measured over local-estimated | Chat.svelte handleContextCompactionStatus + precedence rule | #R23 (+RC6) | reviewer+tester                                                                                                       | queued (needs WP-4L labels) |
| WP-3L | frontend marker parity + cache-row respects slice                                | contextUsage.ts, MessageInput.svelte                        | #R24        | reviewer+tester                                                                                                       | queued last                 |

## Findings carried (WP-1L review)

- P2-1: usage memo keys on stringified LENGTH — same-length different-value usage blob while
  nothing else moves skips recompute. Theoretical (usage finalize co-moves with content). Watch.
- P3-1: params/$models/systemText changes take effect at next branch mutation (pre-existing).
- P3-2: run-end always co-emits history reassign with finalized usage — safe by construction.

## Gate verbs (precedent-verified)

tester: `npx vitest run <paths>`, `npm run check`, `npx prettier --check <files>`; backend:
`ruff format --check` / `ruff check --select=F` on touched file (F-baseline 25 pre-existing,
fork-wide). Baseline failures recorded pre-change; only NEW failures block.
Acceptance rule: commit manifest == gate manifest (WP-PHASE P1 mitigation).

## Operator live-check after image

Agentic omlx run: ring climbs toward threshold % as loop grows; Source flips to measured when
usage lands; after compaction ring drops to summary+tail ≤2s; cache row can no longer
contradict numerator. On "MLX Model Comparison" expect 3% → ~100% during such runs — that is
the fix working, not a regression.

## Prior epics CLOSED

phase-progression (image a8582c2b, WP-LIVE3 still pending-operator), session-integrity (24d34ad5),
reload continuity (98bd01ce). Spec canon: .opencode/specs/context-ring-usage.md R1–R25,
CR-01..24 + CR-BE-01..05.
