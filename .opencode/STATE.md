# STATE — ring-liveness epic (2026-10-26) — CODE COMPLETE (image build pending)

## Symptom (operator screenshot, chat "MLX Model Comparison", Llama-3.3-70B via omlx)

Ring tooltip: Context 1.8k / 65.5k (3%), Remaining 63.8k, Source estimated, Cache hit 100%,
Cached prompt 141,152 — while backend compaction fired (real prompt ~141k > threshold 65,536).
Ring under-reported ~80x during agentic runs.

## Root causes (@plan evidence ses_e86a8bf04 — all fixed)

- RC1: `$: contextUsage` statement referenced neither `history` nor `params` — Svelte static dep
  detection never re-ran it on branch mutation; ring frozen at load estimate while tooltip cache
  row (refs `history` directly) stayed live. FIXED WP-1L.
- RC2: load-time estimate blind to tool-loop transcript. Mitigated by live measured flip (WP-1L).
- RC3: live frontend missed backend `open_webui:context_compaction` output-item markers; cache
  row scanned FULL branch vs sliced numerator. FIXED WP-3L (shared slice-aware helper).
- RC4: backend accepted completion-only checkpoints, hardcoded source:'estimated'. FIXED WP-4L
  (strict frontend mirror, honest labels).
- RC5 NOT-a-bug: 65,536 = operator compact_token_threshold; #R4 held.
- RC6: `local ?? server` precedence let stale pre-compaction local mask authoritative server
  post-compaction context_usage. FIXED WP-2L (#R26 server-fresh precedence, intra-run retirement,
  #R16 id-guarded installs at both async sites).

## Packages (all ACCEPTED, branch local/chat-live-status)

| id    | scope                                                         | gates                                                                     | commit    |
| ----- | ------------------------------------------------------------- | ------------------------------------------------------------------------- | --------- |
| WP-1L | live recompute + measured flip (#R21 #R22)                    | reviewer ACCEPT + tester PASS (vitest 72/0)                               | b3498d155 |
| WP-4L | backend prompt-side gate + honest source (#R25)               | reviewer ACCEPT-AMEND->ACCEPT + tester PASS (ruff clean)                  | ecf6eb2b4 |
| WP-2L | compaction-done refresh + server-fresh precedence (#R23 #R26) | reviewer ACCEPT-AMEND(#R16 leak)->ACCEPT (findings none) + tester PASS x2 | ca97d46fd |
| WP-3L | output-item marker parity + slice-aware cache row (#R24)      | reviewer ACCEPT (3 minors) + tester PASS (vitest 76/0)                    | 23036dfb3 |

## Carried findings (future WP candidates, non-blocking)

- F1: findSummaryCheckpoint `contextSummary ?? context_summary` vs backend `or` — empty-string
  sibling edge (contextUsage.ts:152); fix opportunistically.
- F2: {index,text} model lacks backend cut_idx rewind fidelity (context_compaction.py:344-366):
  marker message kept whole -> summary text double-counted in estimate path, boundary may differ
  one message. Bounded estimate-noise; #R26 server precedence covers truth. Separate WP only if
  fidelity matters.
- P2-1: usage memo keys on stringified LENGTH (same-length different-value blob skips recompute)
  — theoretical; watch.
- P3-1: params/$models/systemText changes apply at next branch mutation (pre-existing shape).

## Gate verbs (precedent-verified)

tester: `npx vitest run <paths>`, `npm run check`, `npx prettier --check <files>`,
`ruff format --check <file>`, `ruff check --select=F <file>`, read-only git. One command per
shell call, no chaining, no exit-code echo (LESSONS.md#L8). Baselines: vitest 76/0;
svelte-check 5952/188/321 (exit 1 pre-existing). Commit manifest == gate manifest.

## Next

WP-IMG6: build amd64 image @ this branch head, retag floating 0.12.1-stats, push both tags by IP
(AGENTS.md procedure). Then operator live-check.

## Operator live-check after image

Agentic omlx run: ring climbs toward threshold % as loop grows; Source flips measured when
usage lands; after compaction toast ring drops to summary+tail <=2s (server value) and resumes
live local at next mutation; cache row can no longer contradict numerator. On "MLX Model
Comparison" expect 3% -> ~100% during such runs — fix working, not regression.

## Prior epics CLOSED

phase-progression (image a8582c2b, WP-LIVE3 pending-operator), session-integrity (24d34ad5),
reload continuity (98bd01ce). Spec canon: .opencode/specs/context-ring-usage.md R1-R26,
CR-01..24 + CR-26 + CR-BE-01..05.

## Housekeeping noise (not this epic)

Uncommitted before epic start: AGENTS.md trailing-newline-only diff; untracked
.opencode/specs/local-images.md (image-epic spec draft). Left for operator disposition.
