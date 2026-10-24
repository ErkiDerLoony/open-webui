# STATE — stats-line reload continuity epic (2026-10-24) — ACTIVE (build phase)

## Prior epic CLOSED
Session-integrity epic (ring cumulative-inflation, cache/total suppression, engine attribution, chat isolation, R11-R17) closed with image 24d34ad5 (details in git history of this file).

## Goal (current)
Stats line under an IN-FLIGHT assistant message vanished across page reload (live run state was memory-only). Fix: rehydrate live run for undone tail on loadChat (#R18). Old completed messages unaffected (their line renders from persisted usage + timing — confirmed healthy by operator).

## Packages
| id | hash | gates | status |
|----|------|-------|--------|
| WP-RELOAD | d76cc4b06 rehydrate in-flight run on loadChat (#R18, CR-16; beginRun startedAt opts; cycle-guarded tail walk; no-clobber guard; R11/R12 gates unaffected — firstDeltaAt stays null until own delta) | reviewer ACCEPT (A-F, id-identity proven via placeholder persistence + socket message_id + current_message_id) + tester PASS (59+63 green, manifest exact) | accepted |
| WP-IMG4 | pending | build amd64 + mitmca, retag, IP push both; marker: needsRunRehydration in /app/build .map files (renamed in minified .js) | dispatching |
| WP-LIVE2 | pending-operator | redeploy (pull 0.12.1-stats-amd64, NEW digest != 24d34ad5); live test: start long reply, reload mid-generation -> live line returns (timer may restart from persisted timestamp); completed-message lines unchanged | after IMG4 |

## Notes carried
- Reviewer info: ask_user-pending tails rehydrate a chip while awaiting user input (literal spec match); rehydrated runs >30min evicted by stale policy (pre-existing). Backlog.
- Old backlogs intact (python3* tester verb, races list, E501:420, arm64 stale tags, mise self-update).

## Serialization
IMG4 build -> image gate -> operator redeploy -> LIVE2 verify -> close.
