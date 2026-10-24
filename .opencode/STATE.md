# STATE — phase-progression epic (2026-10-24) — ACTIVE (build phase)

## Delivered
Chip showed 'model loading' while reasoning streamed. Fixed at d8f5b9dc5: reasoning/thinking deltas count as first-token evidence every layer (#R19: getReasoningText alias chain wired into applyStream/noteStreamUpdate + all Chat.svelte delta sites; backend marks already reasoning-inclusive — comment-only diff); phase hierarchy (#R20 resolveDisplayPhase): bound claimable-row phase > thinking/generating (own evidence) > loading-only-when-no-evidence > 'waiting for model'. Rate/token strictness (#R11/#R12) untouched.

## Packages
| id | hash | gates | status |
|----|------|-------|--------|
| WP-PHASE | d8f5b9dc5 (amended; orig 79602f46d rejected narrow on spec-md prettier) | reviewer ACCEPT (boundPhase claimable-filtered; loading unreachable w/ evidence; backend comment-only) + tester PASS (71/75 green, prettier clean incl. md) | accepted |
| WP-IMG5 | pending | build amd64+mitmca from tip d8f5b9dc5, retag floating, IP push both; marker 'waiting for model' grep at /app/build/_app/immutable/ ROOT (nodes/ stale — Vite hoists to chunks/); new digest != 98bd01ce | dispatching |
| WP-LIVE3 | pending-operator | redeploy (digest gate) + long-thinking reply: thinking/generating shown while thoughts stream; loading never shown once text visible | pending |

## Notes
- P1 defect logged: coder self-gates must enumerate prettier over EVERY staged file incl. md; payload rule adopted (gate manifest = commit manifest, .py excluded — ruff instead).
- ruff: middleware.py `ruff format --check` clean; F-baseline 25 pre-existing errors carried (fork-wide, not ours).
- Carried backlog: python3* tester verb decision, races (pollEngineStats/handleManualCompact/double-switch), ask_user-pending chip reactivation note, E501:420, arm64 stale registry tags, mise self-update.

## Prior epics CLOSED
session-integrity (image 24d34ad5), reload continuity (image 98bd01ce). Spec canon now R1–R20, CR-01..18 + CR-BE-01..04.

## Serialization
IMG5 build -> image gate -> operator redeploy -> LIVE3 verify -> close.
