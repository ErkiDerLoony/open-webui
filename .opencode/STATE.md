# STATE — context ring/stats session-integrity epic (2026-10-24) — ACTIVE

## Goal
Ring showed 279.2k/65.5k (100%) + bogus cache-hit 66% + pre-schedule tok/s. Root causes: (1) omlx emits SESSION-CUMULATIVE counters (total/input/output/cached_tokens) alongside per-turn counts — fixed sum-wins; (2) engine activity positionally attributed to foreign requests — fixed claimable-only; (3) no compact_token_threshold in stored params -> denominator honest num_ctx 65536. Live instance runs REMOTELY (container absent on this host; DB here stale Oct 9).

## Packages
| id | scope | acceptance | depends_on | status |
|----|-------|------------|------------|--------|
| WP-RATE | c925933c9 attribution+scoping | R11/R12 CR-09/10 | — | accepted |
| WP-RATE-FIX | dd94083b4 claimable display view | CR-11 + registration | WP-RATE | accepted |
| WP-NUMERATOR | 86b723d76 sum-wins #R13 + cache suppression #R14 | reviewer A-G + tester | WP-RATE-FIX | ACCEPTED (reviewer reject on CR-13 registry line -> WP-POLISH; tester PASS 51/51; R14 deviation accepted; backend-frontend total divergence -> R15 below) |
| WP-POLISH | spec line5 CR-13 registration; streamTiming.ts 'Total tokens' row consistency suppression R15 + CR-14 test; spec rows | registry matches table exactly; total-row suppressed when |total - (prompt+completion)| > 5% ; tests green | WP-NUMERATOR | dispatched |
| WP-ISOL | Chat.svelte switch resets (serverContextUsage/taskIds/engine) + backend percent clamp (context_compaction.py ~:308) | R16 switch-isolation, R17 server percent ∈[0,100]; reviewer+tester | WP-POLISH | pending |
| WP-IMG3 | rebuild+push open-webui:0.12.1-stats{,-amd64} from final tip; fix-in-bundle check | amd64+digest gates; ring fix strings in bundle | WP-ISOL | pending |
| WP-LIVE | operator redeploy on remote host; screenshot ring on young chat | numerator≈prompt per-turn, cache rows sane/absent, no pre-token tok/s | WP-IMG3 | pending-operator |

## Verdict log
- WP-RATE reviewer REJECT->dd94083b4 closed (A/B/C PASS). WP-NUMERATOR reviewer REJECT (spec CR-13 line only; A-G otherwise PASS incl. R14 deviation acceptance) -> POLISH. Tester NUMERATOR: PASS (47 targeted, 51 full-suite, prettier clean, manifest exact).

## Decisions
- Sum-wins is ring-numerator law (#R13); backend Responses-API merge stays additive for billing — documented divergence; user-visible totals now suppressed when inconsistent (#R15).
- Denominator 65.5k is honest advertised window (num_ctx); operator set no compaction threshold in DB — communicate: to get threshold semantics, set compact_token_threshold in chat/model params.
- Live container remote: image push is necessary-but-not-sufficient; operator must redeploy before WP-LIVE.

## Serialization
POLISH → gates → ISOL → gates → IMG3 (build+gate) → operator redeploy → LIVE verify.
