# STATE — context ring/stats session-integrity epic (2026-10-24) — ACTIVE

## Goal
Live ring: 279.2k/65.5k (100%), source measured, cache-hit 66% on a young uncompacted chat; tok/s appeared pre-schedule. ROOT CAUSES FOUND:
- tok/s: engine activity attributed positionally to foreign requests — FIXED (c925933c9 + dd94083b4).
- ring 100%: omlx emits SESSION-CUMULATIVE counters (total_tokens/input_tokens/output_tokens/cached_tokens) alongside per-turn prompt_tokens/completion_tokens in one flat blob (evidence: stored rows prompt 45k+compl 2k vs total 615k; cached 425k > prompt 45k). getUsageTokenCount prefers explicit total when total>=sum -> cumulative inflation. No compact_token_threshold exists in stored chat params -> denominator = num_ctx fallback 65536 (65.5k). Cache-hit ratio mixes cumulative cached with per-turn prompt -> bogus %.
NOTE: WP-DIAG found the container absent on this host; DB ~/.open-webui/webui.db last write Oct 9 (structurally representative of omlx shape, not the exact session).

## Packages
| id | scope | acceptance | depends_on | status |
|----|-------|------------|------------|--------|
| WP-RATE | (c925933c9) attribution primitives + chat scoping | R11/R12 CR-09/10 | — | accepted (reviewer A-E items; docs item moved into WP-NUMERATOR) |
| WP-RATE-FIX | (dd94083b4) claimable-only display view + phase words | CR-11 + spec CR-11 registration | WP-RATE | code accepted (reviewer A/B/C PASS); spec CR-11 registration + tests -> WP-NUMERATOR+tester |
| WP-NUMERATOR | contextUsage.ts getUsageTokenCount (sum-wins rule), streamTiming.ts cache-hit guard, specs CR-11 registration + new R13/R14 + CR-12/13 rows, tests | omlx-shaped row {prompt 45307, compl 2226, total 615849, cached 425938} -> checkpoint 47533; cached>prompt -> cache rows suppressed; all vitest green | WP-RATE-FIX | dispatched |
| WP-ISOL | Chat.svelte navigateHandler resets serverContextUsage/taskIds/engine mirrors (embedded path); backend percent clamp context_compaction.py:308 | R15/R16 draft at dispatch | WP-NUMERATOR | pending |
| WP-IMG3 | rebuild+push 0.12.1-stats after fixes | gate: amd64 + digest + fix-in-bundle | WP-ISOL | pending |

## Verdict log
- WP-RATE reviewer: REJECT (positional token leak) -> dd94083b4 closes code (A/B/C PASS on recheck); docs CR-11 registration owed -> WP-NUMERATOR.
- Prior fixes already shipped in image 0c7ee07df? NO — image predates WP-RATE; current live image lacks ring fixes? Image was built from tip 7d043cb7e which INCLUDES R1-R10 ring fixes but not WP-RATE/WP-NUMERATOR.

## Decisions
- Sum-wins rule: provider total_tokens is cross-check only, never numerator when both per-turn sides resolve (cumulative-counter providers exist — omlx proven).
- Denominator 65.5k = num_ctx fallback is HONEST (advertised window); operator set no compaction threshold in DB — tell operator where to set it if they want threshold semantics instead of window semantics.
- Container not on this host during diag — ask operator where the live instance runs (host/port, DB path) so a fresh raw usage row can confirm after rebuild.

## Serialization
NUMERATOR → gates → ISOL → gates → IMG3 → verify live (needs operator: live host URL/DB).
