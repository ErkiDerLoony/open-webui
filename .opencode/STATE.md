# STATE — context ring/stats session-integrity epic (2026-10-24) — ACTIVE (build phase)

## Goal
Ring 279.2k/65.5k(100%) + bogus cache-hit + pre-schedule tok/s on live instance. Fixed: sum-wins vs cumulative omlx counters (#R13), impossible cache ratios suppressed (#R14), inconsistent Total row suppressed (#R15), engine attribution own-evidence-only (#R11/#R12), per-chat switch resets (#R16), server percent clamp (#R17). Root causes: omlx session-cumulative total/cached fields; positional engine claims. 65.5k denominator = honest num_ctx (no compact_token_threshold in params — operator wants threshold semantics? set compact_token_threshold in chat/model params).

## Packages
| id | hash | gates | status |
|----|------|-------|--------|
| WP-RATE | c925933c9 | reviewer(reject)->fixed + tester | accepted |
| WP-RATE-FIX | dd94083b4 | reviewer recheck A/B/C + tester | accepted |
| WP-NUMERATOR | 86b723d76 | reviewer (CR-13 debt->POLISH) + tester 51/51 | accepted |
| WP-POLISH | 99eeb5221 | reviewer accept + tester pass | accepted |
| WP-ISOL | b5ebbc29f | reviewer accept (minor notes) + tester pass (python3 cmd = infra, out of contract; CR-BE = reviewer gate; coder PY-OK+ruff clean) | accepted |
| WP-FINAL-TOUCH | pending commit | one-line engineActivity reset in initEmbeddedDraft (#R16 literal) + prettier | dispatching with IMG3 |
| WP-IMG3 | pending | build --platform linux/amd64 --build-context mitmca=$HOME/mitmca-context -t open-webui:0.12.1-stats-amd64; retag floating; IP push both; gate: amd64+identical digests+bundle markers ('waiting for model' string, computeContextUsage in .map) | after FINAL-TOUCH | pending |
| WP-LIVE | — | operator redeploy remote host; ring on young chat: per-turn numerator ≪ window, no bogus cache/total rows, no pre-token tok/s | IMG3 | pending-operator |

## Verdict log
- ISOL reviewer ACCEPT (A-E; initEmbeddedDraft engineActivity judged inert, added opportunistically in FINAL-TOUCH; 3 pre-existing narrow races logged backlog).
- ISOL tester: 5/6 pass; cmd4 python3* DENIED = gate infra, criterion out of contract (CR-BE-04 reviewer gate; coder PY-OK raw). 55/51 suites green, svelte-check 5952 ≤ baseline, 0 new near navigateHandler.

## Backlog
1. Tester allowlist: bare python3* for syntax checks — operator call (arbitrary-exec breadth).
2. Pre-existing races (reviewer notes): pollEngineStats ≤500ms store repopulate across switch; handleManualCompact mid-await write; double-switch null-sentinel defeat at loadChat :2978.
3. Legacy items: prompt_n junk ValueError, E501:420, float truncation, client nits 2/3/5, mise self-update.

## Serialization
FINAL-TOUCH → IMG3 build → IMG-GATE3 → operator redeploy → LIVE screenshot.
