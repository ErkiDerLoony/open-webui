# STATE — status line token counts (2026-10-23)

## Goal

Chat status line (MessageRunStats chip) shows tok/s; add generated + prefilled (prompt) token counts beside it, live and finished.

## Hard constraints

- Diff confined to MessageRunStats.svelte + STATE.md.
- No new i18n keys (strings hardcoded like existing chip literals); `npm run i18n:parse` must produce no translation.json diff.
- Reuse `formatTokens` (streamTiming.ts) and `getUsageTokenCount`; no new formatters.

## Packages

| id              | scope                            | acceptance                                                                                                                                                                                                                                                         | depends_on      | status     |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ---------- |
| WP-STATS-TOKENS | MessageRunStats.svelte           | R1 gen count `N tok` on live chip (engine generated_tokens else estTokens); R2 prompt `N in` when known; R3 finished label same parts from usage; R4 reactive during stream; R5 `·` separator; R6 no i18n diff; R7 format+check clean; R8 diff confined, committed | —               | dispatched |
| WP-GATE         | reviewer static verdict on R1–R8 | ACCEPT recorded                                                                                                                                                                                                                                                    | WP-STATS-TOKENS | pending    |

## Verdict log

- (pending reviewer)

## Serialization order

Single package; reviewer gate after coder. No file overlap.

## Decisions

- Chip wording: generated = `N tok`, prefill = `N in` (compact; popover keeps full labels "Prefill speed"/"Tokens so far").
- Live gen source fallback chain: engine generated_tokens → estTokens (length/4 estimate).
