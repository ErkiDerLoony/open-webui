# STATE — ring + run-stats tooltip: ACCEPTED, close-out commits in flight (2026-10-23)

## Goals
1. RING: truthful context ring token count/percent (contract `.opencode/specs/context-ring-usage.md` #R1–#R8). ACHIEVED + tester-verified.
2. WP-TIP: run-stats chip tooltip reuses canonical `common/Tooltip.svelte` + single builder `formatUsageTooltipHtml`; locale-grouped tokens, unit-normalized rates. ACHIEVED + tester-verified.

## Hard constraints
- Contract: `.opencode/specs/context-ring-usage.md` (#R1–#R8, CR ids).
- Frontend CI: prettier clean (verified); no new i18n keys anywhere.
- Unit truth: ollama durations ns; backend `usage.timing` s; oMLX `prompt_eval_duration` ≈ s; backend-provided rates win (`resolveDurationMs` ns→µs→s, ≤100k guard).
- Gate executability per specs/gate-perms.md (preflight tester payload vs agents/tester.md allowlist; denials = infra, one attempt, minimal missing stanza). Re-read STATE before every write (L14); never edit gate-held files (L5).

## Packages
| id | scope | acceptance | depends_on | status |
|----|-------|------------|------------|--------|
| WP-RING-CORE | contextUsage.ts(+test), utils/index.ts, Chat.svelte, MessageInput.svelte, streamTiming.ts, spec, STATE (commit 0a768e08d) | R1–R7 + CR-01..08 pass under tester re-run | — | ACCEPTED (CR 9/9 live under tester 2026-10-23) |
| WP-RING-FIX | spec R8, contextUsage.ts(+test), MessageInput.svelte, STATE, LESSONS (commit c04c5cde3) | truthful source label + CR tests pass under tester re-run | WP-RING-CORE | ACCEPTED (same live run) |
| WP-RING-BE | backend/open_webui/utils/response.py (commit c73925b24) | R8 no-raise + presence preserved; reviewer ACCEPT | WP-RING-FIX | ACCEPTED — done |
| WP-TIP | ChatStats/MessageRunStats.svelte, utils/streamTiming.ts, new streamTiming.test.ts, STATE | common Tooltip + formatUsageTooltipHtml; no popover/local rows/unit math; resolveDurationMs exported; vitest 19/19 + prettier + svelte-check zero on touched files | — | ACCEPTED (reviewer 7/7 + tester: vitest 19/19, prettier clean, svelte-check exact 5952 baseline zero touched-file hits) |
| WP-SCRIPT-FIX | package.json (`test:frontend`) | `vitest run --passWithNoTests`; `npm run test:frontend` exits 0, 23/23 green, live smoke under tester | WP-TIP | dispatched |

## Verdict log
- 2026-10-23 WP-RING-CORE/FIX @tester: ACCEPT — vitest CR suite 19/19 exit 0; all frontend suites green 23/23 (exit-code failure was watch-mode script defect → WP-SCRIPT-FIX, LESSONS L15).
- 2026-10-23 WP-TIP @reviewer ACCEPT 7/7; @tester ACCEPT behavioral — vitest 19/19, prettier clean, svelte-check zero MessageRunStats/streamTiming mentions (footer exactly 5952 errors/188 warnings baseline).
- 2026-10-23 gate scope: staged `.opencode/LESSONS.md` residue from sibling session (L14 family) → committed in close-out A, not reverted. Prior tester blocks ×4 resolved by operator WP-GATE-PERM-1 (canonical-verb allowlist; L13 wired).

## Serialization
Close-out (dispatched to @coder): commit A = TIP files + STATE.md + .opencode/LESSONS.md; commit B = package.json script fix. AGENTS.md + .opencode/specs/local-images.md NEVER staged (operator-owned). Then @tester smoke: `npm run test:frontend` exit 0 + clean status → epics CLOSED.

## Decisions
- Operator: percent vs compaction threshold when enabled else model window; real numerator; all providers; declined evidence-waiver; gate-perms amendment approved.
- WP-TIP: chip + ⓘ share one Tooltip component + one content builder; ns→µs→s resolver ≤100k guard; locale-robust grouping assertion; ChatStatsBar orphan untouched.
- Deferred backlog: response.py null-unsafe convert_ollama_usage_to_openai (218-219,236,244 fabricates zeros); context_compaction.py:243,247 `or`-chain collapses prompt_tokens=0; float-truncation response.py:21; CORE nits 2/3/5; TIP nits N1–N3 (rate-0 fallback suppression streamTiming.ts:282–287, `(41720)` paren lint, pollTimer ordering).

## Next action
@coder close-out commits A+B (no push) → @tester smoke `npm run test:frontend` (exit 0) + `git status --porcelain` (only operator-owned entries left) → mark epics CLOSED in this runbook, micro-commit STATE drift.
