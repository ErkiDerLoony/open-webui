# STATE — phase-progression epic (2026-10-24) — CLOSED (live check pending operator)

## Delivered
Chip showed 'model loading' while reasoning/thinking text streamed. Fixed at d8f5b9dc5, shipped in image dbf9c2ec6d08… (digest a8582c2b38ce…):
- #R19: reasoning/thinking deltas count as first-token evidence on every layer — getReasoningText alias chain (reasoning_content/reasoning/thinking + relayed Responses events) wired into applyStream/noteStreamUpdate and all Chat.svelte delta sites; backend first-token marks were already reasoning-inclusive (comment-only diff).
- #R20: resolveDisplayPhase hierarchy — bound claimable-row phase > thinking/generating (own stream evidence) > model-loading ONLY when no own output yet > 'waiting for model'. Rate/token strictness (#R11/#R12) untouched; foreign phase words only via claimable rows.

## Packages (all accepted)
| id | hash | gates |
|----|------|-------|
| WP-PHASE | d8f5b9dc5 (amended; orig 79602f46d rejected narrow: spec-md prettier — defect P1) | reviewer ACCEPT + tester PASS (71/75 green, prettier clean incl. md) |
| WP-IMG5 | publish @ 202b6add5; Id dbf9c2ec6d08…, digest a8582c2b38ce…, both tags identical, amd64/linux; markers: resolveDisplayPhase in chunks/CKCcIn9z.js.map, 'waiting for model' in CKCcIn9z.js | image gate PASS (local + registry) |
| WP-LIVE3 | pending-operator | see below |

## WP-LIVE3 — operator steps
1. Remote host: `docker pull atuin.local:5000/open-webui:0.12.1-stats-amd64` — digest must be **a8582c2b38ce…** (not 98bd01ce, not 24d34ad5) — restart container.
2. Test: prompt a long-thinking reply. Expected: once ANY text (thoughts included) appears, chip shows thinking/generating — never 'model loading'; reload mid-generation (prior fix) still restores the line; numbers appear once engine row binds.
3. Prior fixes ride along: ring per-turn math, cache/Total suppression, chat isolation, reload continuity — spot-check as desired.

## Notes
- P1 defect (coder self-gate missed spec md): mitigation adopted — gate manifest must equal commit manifest (.py excluded, ruff instead).
- ruff middleware F-baseline: 25 pre-existing errors (fork-wide), format-check clean; carried.
- Carried backlog: python3* tester verb decision, races (pollEngineStats/handleManualCompact/double-switch), ask_user-pending chip reactivation note, E501:420, arm64 stale registry tags, mise self-update.

## Spec canon
.opencode/specs/context-ring-usage.md: R1–R20, CR-01..18 + CR-BE-01..04. Laws: per-turn sums only; own-evidence numbers; honest phase hierarchy; impossible ratios suppressed; percents clamped; per-chat isolation; live state rehydratable.

## Prior epics CLOSED
session-integrity (image 24d34ad5), reload continuity (image 98bd01ce).
