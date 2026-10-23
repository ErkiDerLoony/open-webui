# STATE — status line token counts (2026-10-23) — CLOSED

## Goal
Chat status line (MessageRunStats chip) showed tok/s; add generated + prefilled (prompt) token counts beside it, live and finished.

## Hard constraints
- Diff confined to MessageRunStats.svelte + STATE.md.
- No new i18n keys (strings hardcoded like existing chip literals); `npm run i18n:parse` produces no translation.json diff.
- Reuse `formatTokens` (streamTiming.ts) and existing inline usage derivation; no new formatters.

## Packages
| id | scope | acceptance | depends_on | status |
|----|-------|------------|------------|--------|
| WP-STATS-TOKENS | MessageRunStats.svelte | R1 gen `N tok` live (engine generated_tokens else estTokens); R2 prompt `N in` when known; R3 finished label same parts; R4 reactive during stream; R5 ` · ` order phase→tok/s→tok→in; R6 no i18n diff; R7 format+check clean vs baseline; R8 diff confined, committed | — | accepted |
| WP-GATE | reviewer static verdict R1–R8 | ACCEPT recorded | WP-STATS-TOKENS | accepted |

## Verdict log
- 2026-10-23 WP-GATE (reviewer): ACCEPT — R1–R5 verified against shipped code + streamTiming/generationStats types; null-safety OK; estTokens live-updated per delta; additive-only, popover/duration untouched. Two non-blocking infos: positional synthetic claim shares pre-existing tok/s heuristic; STATE wording vs inline derivation nit. R6/R7/R8 execution evidence from coder report (clean porcelain, 0 MessageRunStats errors vs 5958 repo baseline, stat = 2 files).

## Serialization order
Single package; reviewer gate after coder. No file overlap.

## Decisions
- Chip wording: generated = `N tok`, prefill = `N in` (compact; popover keeps full labels).
- Live gen source fallback: engine generated_tokens → estTokens (length/4 estimate).
- Gate: static criteria → reviewer alone per LESSONS L4 waiver; no test runner covers this component.
- Accepted commit: 3e7e54ded on local/chat-live-status.
- External noise: AGENTS.md trailing-newline removal arrived mid-session (not ours); left uncommitted in working tree for operator.
