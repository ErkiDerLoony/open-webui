# STATE — ring-liveness epic (2026-10-26) — OPEN (WP-1 dispatched)

## Symptom (operator screenshot, chat "MLX Model Comparison", Llama-3.3-70B via omlx)

Ring tooltip: Context 1.8k / 65.5k (3%), Remaining 63.8k, Source estimated, Cache hit 100%,
Cached prompt 141,152 — while backend compaction fired (real prompt ~141k > threshold 65,536).
Ring under-reports ~80x during agentic runs.

## Root causes (@plan evidence, ses_e86a8bf04)

- RC1 PRIMARY: `Chat.svelte:324` `$: contextUsage = getContextUsage() ?? …` — statement references
  only `contextCompactionEnabled`/`serverContextUsage`; `history` read happens inside the function
  body so Svelte static dep detection never registers it → ring frozen at load-time estimate.
  Tooltip cache row (`MessageInput.svelte:548`) refs `history` directly → live. The asymmetry IS
  the signature. Reload self-heals (init re-runs 324).
- RC2: frozen snapshot is a length/4 estimate blind to tool-loop transcript (statusHistory chips
  uncounted; output items land only at persist time).
- RC3: compaction summary markers never reach the live frontend (events carry no summary text;
  frontend never writes contextSummary); backend `open_webui:context_compaction` output-item
  markers unknown to findSummaryCheckpoint; cache row scans FULL branch while numerator is sliced.
- RC4 parity: backend accepts completion-only blobs as checkpoints (context_compaction.py:293-297,
  no prompt-side gate = #R2 violation) and `_build_context_usage` hardcodes source:'estimated'.
- RC5 NOT-a-bug: 65,536 = operator compact_token_threshold; #R4 held.

## Packages

| id    | scope                                         | files                                          | spec      | gates           | status     |
| ----- | --------------------------------------------- | ---------------------------------------------- | --------- | --------------- | ---------- |
| WP-1L | live recompute + measured flip w/o reload     | Chat.svelte; contextUsage.test.ts (CR-22)      | #R21 #R22 | reviewer+tester | DISPATCHED |
| WP-2L | compaction-done refreshes ring ≤2s            | Chat.svelte handleContextCompactionStatus      | #R23      | reviewer+tester | queued     |
| WP-3L | marker parity + cache-row respects slice      | contextUsage.ts, MessageInput.svelte           | #R24      | reviewer+tester | queued     |
| WP-4L | backend checkpoint gate + honest source label | backend/open_webui/utils/context_compaction.py | #R25      | reviewer + ruff | queued     |

Acceptance rule: commit manifest == gate manifest (LESSONS P1 mitigation from WP-PHASE).
No new UI strings anywhere → no i18n:parse needed.

## Gate verbs (precedent WP-PHASE)

tester: `npx vitest run src/lib/utils/contextUsage.test.ts src/lib/utils/streamTiming.test.ts`,
`npm run check`, `npx prettier --check <touched files>`. Baseline failures recorded pre-change;
only NEW failures block.

## Operator live-check after image

Agentic omlx run: ring climbs toward threshold % as loop grows; Source flips to measured when
usage lands; after compaction toast ring drops to summary+tail ~1-2s; cache row can no longer
contradict numerator. On "MLX Model Comparison" expect 3% → ~100% during such runs — that is
the fix working, not a regression.

## Prior epics CLOSED

phase-progression (image a8582c2b, WP-LIVE3 still pending-operator), session-integrity (24d34ad5),
reload continuity (98bd01ce). Spec canon: .opencode/specs/context-ring-usage.md R1–R25,
CR-01..24 + CR-BE-01..05.
