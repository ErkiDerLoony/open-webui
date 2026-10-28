# STATE — status-line "waiting for model" latch fix (2026-10-28) — DONE, image pushed

## Goal (achieved)

Operator bug fixed: run chip stuck on `5m 26s · waiting for model` while thoughts streamed.
Shared predicate hasOwnOutputEvidence (content / reasoning-alias / output-item channels) now
releases loading+waiting words in MessageRunStats chip, ChatStatsBar phase label, and bar-button
loading segment; firstDeltaAt stamps from any evidence delta. Contract: specs/chat-status-line.md R1-R6.

## Packages (all ACCEPTED, branch local/chat-live-status)

| id | scope | acceptance | gates | status |
| -- | ----- | ---------- | ----- | ------ |
| WP-STAT1 | streamTiming.ts, stores/generationStats.ts (L9 path fix), ChatStats/MessageRunStats.svelte, ChatStats/ChatStatsBar.svelte, streamTiming.test.ts | specs/chat-status-line.md#R1-#R6 + CS-01..CS-05 | tester pass x2 + reviewer ACCEPT-AMEND (2 minors fixed+reverified) | committed 8e40a896c39396c940db535b70277470c5cf510b |
| WP-STAT1-COMMIT | git bookkeeping | AGENTS.md reverted; manifest == 8 paths; tree clean except untracked specs/local-images.md | raw git output self-verified | accepted |
| WP-STAT1-IMG | docker build only | inspect: linux/amd64, both tags same ID; provenance = HEAD at build (ref-verified, LESSONS L10) | raw inspect/run output | accepted |
| WP-STAT1-PUSH | docker tag+push by IP to 10.10.10.10:5000 (both tags; git push forbidden, remains local) | pre-push ID match to e563ed0f; identical registry digests both tags | raw push digests | accepted |

Image: open-webui:0.12.1-stats-amd64 == floating 0.12.1-stats == `sha256:e563ed0f468b...dafbefe`,
built 2026-10-28T14:59+01 from 8e40a896c (amd64, mitmca context). Bundle marker:
hasOwnOutputEvidence found in /app/build/_app/immutable/chunks/DNImwHZz.js.map (source-map only —
minifier renames identifiers, expected). PUSHED both tags to 10.10.10.10:5000; registry digest
`sha256:5c4c1d88a73f…02542d` identical for 0.12.1-stats-amd64 and 0.12.1-stats. Git commits remain
LOCAL ONLY (8e40a896c, cf6c3a68a — no git push per operator).

## Operator next (your call)

- Deploy on consumer: `docker pull atuin.local:5000/open-webui:0.12.1-stats-amd64` (or floating
  0.12.1-stats — same registry digest sha256:5c4c1d88...) and restart container.
- Live check A (this epic): thoughts-only omlx run — chip never sits on waiting/loading past the
  first thought token.
- Live check B (ring epic, still open): ring climb / measured flip / compaction drop on agentic
  run. Before assuming this image carries the ring fixes, verify the four ring commits
  (b3498d155 ecf6eb2b4 ca97d46fd 23036dfb3) are ancestors of 8e40a896c (`git merge-base --is-ancestor`).

## Gate verbs (precedent-verified)

tester: `npx vitest run <paths>`, `npm run check`, `npx prettier --check <files>`, read-only git.
Baselines: vitest 88/0 (incl. 67 streamTiming); svelte-check 5952/188/321 (exit 1 pre-existing).
One command per shell call, no chaining, no exit-code echo (L8). Provenance hashes: verify against
.git/refs, never reply strings (L10).

## Verdict log (condensed)

- WP-STAT1: @coder DONE (67/0 target tests, 8 new CS cases) -> @tester pass -> @reviewer
  ACCEPT-AMEND 2 minors (M1 bar-button loading segment ungated = same defect class; M2 comment)
  -> @coder amend verbatim to mandated fixes -> @tester final pass (88/0, svelte-check baseline
  exact, set clean). Committed 8e40a896c (manifest 8 paths).
- WP-STAT1-IMG: single build attempt, first-try success; tags proven same ID; no push.

## Carried / prior (CLOSED)

Ring-liveness: WP-1L..4L ACCEPTED (b3498d155 ecf6eb2b4 ca97d46fd 23036dfb3), image 2d6a3524 pushed
(digest sha256:251d01e9b7f6...); carried findings F1/F2/P2-1/P3-1 open, non-blocking. Prior epics:
phase-progression (WP-LIVE3 pending-operator), session-integrity, reload continuity. Specs:
context-ring-usage.md R1-R26, chat-status-line.md (new), local-images.md (untracked, operator
disposition). LESSONS: L9 (payload path inference), L10 (reply hash transcription) new this epic.
