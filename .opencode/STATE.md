# STATE — restore omlx phase indicator on run-stats chip (2026-10-23)
## Goal
Chip beside cursor always shows `time · phase · tok/s`; no blank mid-stream.
## Hard constraints
No backend edits; no i18n tags; scope files only.
## Packages
| id | scope | acceptance | depends_on | status |
| WP-PHASE | MessageRunStats.svelte, streamTiming.ts, generationStats.ts, ResponseMessage.svelte guards, streamTiming.test.ts, STATE.md | A1 no-blank-phase; A2 vitest pass; A3 svelte-check tail; A4 diff confined; A5 done-label stable | — | dispatched |
## Verdict log
(pending @tester vitest, @reviewer diff)
## Decisions
Decode-phase suppression removed per operator request; chip survives missing registry entry via local start-time fallback.
