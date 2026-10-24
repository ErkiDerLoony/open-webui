# STATE — stats-line reload continuity epic (2026-10-24) — CLOSED (live check pending operator)

## Delivered
Live stats line now survives page reload mid-generation (#R18): loadChat rehydrates the run for an undone tail message (startedAt from persisted timestamp), engine-claim gates untouched (R11/R12 hold until own first token). Completed-message lines were and remain rendered from persisted usage — confirmed healthy by operator.

## Packages (all accepted)
| id | hash | gates |
|----|------|-------|
| WP-RELOAD | d76cc4b06 | reviewer ACCEPT (A-F; socket-id identity proven via placeholder persistence) + tester PASS (59+63 green, manifest exact) |
| WP-IMG4 | publish @ 28f0c15dd tip; image Id 458e3037fad7…; registry digest 98bd01ce27c3… (both tags identical, amd64/linux; R18 marker in .map; phase-word marker in chunks/BpsWYInz.js — marker path note below) | gate: registry HTTP + local docker inspect PASS |
| WP-LIVE2 | pending-operator | see below |

## Notes
- Marker paths: 'waiting for model' now in chunks/ (Vite hoist), not nodes/ — future gate greps should use /app/build/_app/immutable/ root. needsRunRehydration survives only in .map (minified rename).
- Gate infra fixed en route: tester rule-1 prose vs frontmatter parity gap made it self-deny valid docker-inspect verbs; prose now lists docker + ruff inspection verbs (permissions were already correct).
- Carried: ask_user-pending tail rehydrates chip while awaiting input (literal spec match); >30min rehydrated run evicted by stale policy; backlogs unchanged (python3* verb decision, races, E501:420, arm64 stale tags, mise self-update).

## WP-LIVE2 — operator steps
1. On the remote host: docker pull atuin.local:5000/open-webui:0.12.1-stats-amd64 (digest must be 98bd01ce27c3…, not 24d34ad5) and restart the container.
2. Test: start a long reply, reload the page mid-generation -> live line (time · tok/s · tok) returns within a second, timer restarts from message timestamp; after completion, done label as usual.
3. Earlier fixes ride along: ring per-turn math, cache/total suppression, chat isolation — spot-check anything previously reported.

## Spec canon
.opencode/specs/context-ring-usage.md: R1–R18, CR-01..16 + CR-BE-01..04. Law: per-turn sums only; own-evidence claims; impossible ratios suppressed; percents clamped; per-chat isolation; live state rehydratable.
