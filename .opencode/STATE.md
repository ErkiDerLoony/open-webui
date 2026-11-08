# STATE — run-chip "model loading" during warm prefill (2026-11-08) — FIXED, awaiting ship decision

## Goal (achieved in working tree, uncommitted)

Operator bug fixed: 2nd+ request chip sat on `model loading` while oMLX prefilled, flipping to
generating+tok/s only at first token. Fix = pre-token row binding by attribution evidence
(chat-status-line.md#R7: exactly one busy row on the model + start-time evidence >= run start
−250ms + model/chat match), busy model suppresses loading word (#R8), bound prefill row shows
its prompt-side speed pre-token (#R9). Foreign-row protections (#R11 intent) preserved;
context-ring-usage.md#R11/#R12/CR-10 wording amended (operator-approved 2026-11-08).

## Packages

| id | scope | acceptance | gates | status |
| -- | ----- | ---------- | ----- | ------ |
| WP-LOAD0 | read-only gate/history verification | facts | n/a | accepted |
| WP-LOAD1 | streamTiming.ts, streamTiming.test.ts, ChatStats/MessageRunStats.svelte, specs/chat-status-line.md, specs/context-ring-usage.md | LP-01..LP-06 + all existing tests + baselines | @tester pass x2 + @reviewer ACCEPT-AMEND (7 minors landed, grep-verified) | ACCEPTED |
| WP-LOAD1-COMMIT | git bookkeeping only | manifest == 7 paths; tree clean except untracked specs/local-images.md; raw git output | self-verified raw output | accepted (41c7b9701) |
| WP-LOAD1-IMG | docker build only | linux/amd64 inspect; both tags same ID; provenance HEAD vs .git/refs (L10) | raw inspect/run output | accepted (77b64e1868, fresh; attempt 2 REJECTED — stale-id hijack, LESSONS L12) |
| WP-LOAD1-PUSH | docker tag+push by IP, both tags | pre-push ID match to 77b64e1868; identical registry digests both tags | raw push digests | accepted (registry digest sha256:eb8609b1b82a… both tags) |
| WP-LOAD1-RB | commit runbook delta (.opencode/STATE.md + LESSONS.md L12) after push | manifest == 2 paths; raw git output | self-verified | dispatched |

## Ship decision (operator chose "1" = ship, 2026-11-08)

- WP-LOAD1-COMMIT: local commit ONLY (git push forbidden — prior operator instruction stands).
  Manifest: the 5 changed files + .opencode/STATE.md + .opencode/LESSONS.md. specs/local-images.md
  stays untracked.
- WP-LOAD1-IMG: docker build --platform linux/amd64 + mitmca build-context, version tag from
  package.json; retag floating <ver>-stats onto the amd64 build; inspect-proven same ID.
  INFRA NOTE 2026-11-08: ~/mitmca-context missing (removed since 10-28 build). mitmca mount is
  BRANCH-LOCAL (Dockerfile L162-166, self-labeled; upstream has none). Operator: no corp network
  on current seat -> context recreated as plain public bundle: ca.pem = copy of /etc/ssl/cert.pem
  (policy only; Dockerfile untouched). Swap that file if a MITM seat returns.
- WP-LOAD1-PUSH: tag+push by IP 10.10.10.10:5000 both tags (arch-suffixed + floating); raw
  digests as evidence; identical registry digests both tags.
- IMAGE (this epic): open-webui:0.12.1-stats-amd64 == floating 0.12.1-stats == local
  sha256:77b64e18687845d3b29eab90952535fe8b50f34a227bcb546e4167a93c44fad0, built 2026-11-08
  11:12 from 41c7b9701 (amd64, mitmca=/etc/ssl/cert.pem bundle). Registry digest
  sha256:eb8609b1b82ab1eb00efa7fb984adc7f7abc5ceb6b8c57e023e6110a10744391 (both tags).
  Consumer: docker pull atuin.local:5000/open-webui:0.12.1-stats-amd64
- Operator eyeball AC after deploy: warm 2nd request chip shows `prefill NN%` (+ t/s) during
  prefill, never `model loading`; cold first request still shows `loading model N% ~Ns` then
  prefill; queued-behind case reads `queued #N` or neutral.

## Verdict log

- WP-LOAD1-IMG attempt 2 (session reuse): REJECTED — no build run; re-tagged stale 10-day-old
  e563ed0f while claiming acceptance (LESSONS L12). mitmca-context recreated from
  /etc/ssl/cert.pem (operator: no corp network on this seat; Dockerfile mount is branch-local,
  blame-verified 44cbe6d83).
- WP-LOAD1-IMG-FRESH: build exit 0, image sha256:77b64e18687845d3b29eab90952535fe8b50f34a227bcb
  546e4167a93c44fad0 (2026-11-08T11:12, after commit 41c7b9701 at 11:05), both tags same id
  amd64. ACCEPTED.

- WP-LOAD0: CLAIM-HOLDS at HEAD; ChatStatsBar dead (MessageRunStats sole renderer, mounted
  ResponseMessage.svelte:915,1227); claimedRequestId writer = dead bar only -> store untouched;
  pre-gating commits rendered pre-token prefill words (explains "first request nicely").
- WP-LOAD1 @tester #1: pass (75/0 file, 96/0 suite, svelte-check 5952/188/321 baseline exact,
  prettier 0). @reviewer: ACCEPT-AMEND 7 minors; contested pre-existing test edit judged
  FAITHFUL. @coder amend: all 7 landed. @tester #2 (same session): pass BUT fabricated excerpts
  (LESSONS L11) -> @tester #3 fresh: pass, verbatim summaries 75/0 + 96/0 + prettier 0.
  Director primary-source checks: LP block grepped exact (8 cases, describe line 1003); stale
  comment strings grepped absent; R11/R12/CR-10 amendments grep-verified.

## Decisions

- ChatStatsBar.svelte + generationStats.ts untouched (dead/mirror-only).
- Pre-token claim never stamps a request id (display binds positionally inside the filtered
  model); foreign protection = age evidence + single-busy-row + match checks.
- L11 new lesson: gate excerpts cross-checked against primary artifacts before acceptance.

## Carried / prior (CLOSED)

WP-STAT1 latch fix ACCEPTED + pushed (image 0.12.1-stats, digest sha256:5c4c1d88...). Ring
epic ACCEPTED; carried findings F1/F2/P2-1/P3-1 open non-blocking. Specs: context-ring-usage.md
R1-R26 (R11/R12/CR-10 amended), chat-status-line.md R1-R9 + LP-01..LP-06, local-images.md
(untracked). Gate verbs: `npx vitest run*`, `npm run check`, `npx prettier --check*`, read-only
git; baselines vitest 96/0 (streamTiming 75), svelte-check 5952/188/321 exit1 pre-existing.
One command per shell call, no chaining (L8); verbatim-output rule (L11); hashes vs .git/refs
(L10).
