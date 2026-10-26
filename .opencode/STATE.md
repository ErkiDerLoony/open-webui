# STATE — ring-liveness epic (2026-10-26) — OPEN (WP-1L/2L/4L accepted; WP-3L dispatched)

## Symptom (operator screenshot, chat "MLX Model Comparison", Llama-3.3-70B via omlx)

Ring tooltip: Context 1.8k / 65.5k (3%), Remaining 63.8k, Source estimated, Cache hit 100%,
Cached prompt 141,152 — while backend compaction fired (real prompt ~141k > threshold 65,536).
Ring under-reports ~80x during agentic runs.

## Root causes (@plan evidence, ses_e86a8bf04)

- RC1 (FIXED WP-1L): `$: contextUsage` referenced neither `history` nor `params` in its own
  expression — Svelte static dep detection never re-ran it on branch mutation; ring frozen at
  load-time estimate while tooltip cache row (refs `history` directly) stayed live.
- RC2 (mitigated WP-1L): load-time estimate blind to tool-loop transcript; live measured flip
  now covers it.
- RC3: live frontend never learns of compaction summaries; backend `open_webui:context_compaction`
  output-item markers unknown to findSummaryCheckpoint; cache row scans FULL branch vs sliced
  numerator. → WP-3L.
- RC4 (FIXED WP-4L): backend accepted completion-only checkpoints (no prompt-side gate) and
  hardcoded source:'estimated'. Amended to strict frontend mirror.
- RC5 NOT-a-bug: 65,536 = operator compact_token_threshold; #R4 held.
- RC6 (fix dispatching as WP-2L/#R26): `(local) ?? server` precedence let a local estimate/
  stale pre-compaction checkpoint mask fresh authoritative server context_usage.

## Packages

| id    | scope                                                     | files                                          | spec      | gates                                                                                                        | status             |
| ----- | --------------------------------------------------------- | ---------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ | ------------------ |
| WP-1L | live recompute + measured flip w/o reload                 | Chat.svelte; contextUsage.test.ts              | #R21 #R22 | reviewer ACCEPT + tester PASS (72/0 vitest; svelte-check baseline-identical; prettier clean; manifest exact) | ACCEPTED b3498d155 |
| WP-4L | backend prompt-side checkpoint gate + honest source label | backend/open_webui/utils/context_compaction.py | #R25      | reviewer ACCEPT-AMEND→ACCEPT (strict mirror ecf6eb2b4) + tester PASS (ruff clean, manifest exact)            | ACCEPTED ecf6eb2b4 |
| WP-2L | compaction-done refresh ≤2s + server-fresh precedence     | Chat.svelte                                    | #R23 #R26 | reviewer ACCEPT-AMEND(#R16 mid-flight leak)->ACCEPT ca97d46fd (findings none) + tester PASS x2               | ACCEPTED ca97d46fd |
| WP-3L | frontend marker parity + cache-row respects slice         | contextUsage.ts, MessageInput.svelte           | #R24      | reviewer+tester                                                                                              | DISPATCHED         |

## Findings carried

- P2-1: usage memo keys on stringified LENGTH (same-length different-value blob while nothing
  else moves skips recompute) — theoretical; watch.
- P3-1: params/$models/systemText changes apply at next branch mutation (pre-existing).
- Tester chain-hygiene defect logged LESSONS.md#L8 (repo-local): chained `; echo EXIT:$?`
  surfaces as permission denial; payloads must mandate one-command-per-call.

## Gate verbs (precedent-verified)

tester: `npx vitest run <paths>`, `npm run check`, `npx prettier --check <files>`,
`ruff format --check <file>`, `ruff check --select=F <file>`, read-only git. Baseline failures
recorded pre-change; only NEW failures block. Commit manifest == gate manifest (WP-PHASE P1).

## Operator live-check after image

Agentic omlx run: ring climbs toward threshold % as loop grows; Source flips measured when
usage lands; after compaction ring drops to summary+tail ≤2s; cache row cannot contradict
numerator. On "MLX Model Comparison" expect 3% → ~100% during such runs — fix working, not
regression.

## Prior epics CLOSED

phase-progression (image a8582c2b, WP-LIVE3 pending-operator), session-integrity (24d34ad5),
reload continuity (98bd01ce). Spec canon: .opencode/specs/context-ring-usage.md R1–R26,
CR-01..24 + CR-26 + CR-BE-01..05.
