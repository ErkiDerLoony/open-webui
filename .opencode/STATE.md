# STATE — phase-progression epic (2026-10-24) — ACTIVE, gates pending

## Symptom
Chip shows 'model loading' while reasoning/thinking text visibly streams.
Root causes: frontend firstDeltaAt counted only `content`, never reasoning
deltas; chip phase hierarchy showed the loading word ahead of own-stream
evidence. Backend first_token marks already counted reasoning at tip (5521
`value or reasoning_content`; 5185 any `.delta`) — functional fix was
frontend-only; backend sites carry #R19 citations.

## Packages
| id | scope | status |
|----|-------|--------|
| WP-PHASE | generationStats.ts + Chat.svelte + streamTiming.ts (getReasoningText, resolveDisplayPhase) + MessageRunStats.svelte + middleware #R19 comments + spec R19/R20 + CR-17/CR-18 tests | accepted-pending-gates |
| WP-GATE-PHASE | reviewer + tester gates on above | pending |
| WP-IMG5 | rebuild+push from final tip (marker + digest gates) | pending |
| WP-LIVE3 | operator redeploy (new digest) + long-thinking reply: chip shows thinking/generating while thoughts stream | pending-operator |

## Design ruling (director)
- Strict own-evidence gating (#R11/#R12) stays for RATE and TOKENS.
- #R20 PHASE: bound row phase wins; unbound + own stream -> 'thinking'
  (reasoning last) / 'generating'; model-loading only with loading evidence and
  NO own output; else 'waiting for model'.
- #R19: reasoning/thinking deltas = first-token evidence everywhere.

## Verification (WP-PHASE implementation)
vitest targets 71/71, full frontend suite 75/75; prettier --check clean;
ast.parse middleware OK; ruff --select=F: 25 errors, tip-identical
pre-existing upstream noise (none introduced); svelte-check: zero issues
naming this package's identifiers (5952 repo-baseline pre-existing).

## Carried backlog
- gate-perms: tester allowlist needs python3* verb stanza.
- races: #R20 phase relaxation could reopen foreign-phase-word display ONLY via
  claimed rows — rows stay claimable-filtered (#R11); verify none leak.
- ask_user chip note.
- E501 middleware:420 (pre-existing).
- arm64 tags (operating mode is amd64-only).
- mise provides ruff on PATH.

## Prior epics CLOSED
session-integrity (digest 24d34ad5), reload continuity (digest 98bd01ce); spec R1-R20 canonical.

## Serialization
PHASE -> gates -> IMG5 -> operator redeploy -> LIVE3.
