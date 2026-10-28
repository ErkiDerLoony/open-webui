# STATE — status-line stuck "waiting for model" bugfix (2026-10-27) — WP-STAT1 in flight

## Goal

Operator bug: live run chip shows `5m 26s · waiting for model` while thoughts visibly stream
(thoughts-only omlx run). Fix: waiting/loading latch must release on ANY own-text evidence.

## Hard constraints

- Contract: .opencode/specs/chat-status-line.md #R1-#R6, tests CS-01..CS-05. Payloads cite #R ids.
- Frontend-only, 5-file scope (#R6). One package (interlocked files). Single commit, branch local/chat-live-status.
- Cite LESSONS.md#L8 (one command per shell call, no chaining, no exit-code echo), L5 (no edits while gate holds), L3 (fresh re-dispatch once on reload false-fail).
- director never edits source. No self-waive gates (L4).

## Root cause (@explore ses_e80933021, evidence-anchored)

resolveDisplayPhase returns 'waiting' iff all four falsy: claimablePhase null, firstDeltaAt null,
hasOwnDeltas false, loadingEvidence false (streamTiming.ts:400-407; MessageRunStats.svelte:268-271).
Deadlock: firstDeltaAt stamped only in applyStream (generationStats.ts:247-248) from content or
reasoning-alias text; hasOwnDeltas checks message.content length only (MessageRunStats.svelte:243)
— thinking/output-item text invisible; isClaimable hard-false pre-firstDeltaAt (streamTiming.ts:274);
message.status never set on socket path (statusHistory only, Chat.svelte:1660-1666).
ChatStatsBar.phaseLabel (:105-112) shares the firstDeltaAt-only guard.

## Packages

| id | scope | acceptance | depends_on | status |
| -- | ----- | ---------- | ---------- | ------ |
| WP-STAT1 | streamTiming.ts, src/lib/stores/generationStats.ts (path amended — see LESSONS L9), ChatStats/MessageRunStats.svelte, ChatStats/ChatStatsBar.svelte, streamTiming.test.ts | specs/chat-status-line.md#R1-#R6 + CS-01..CS-05; vitest green; prettier check clean; svelte-check baseline | — | accepted (uncommitted) |

## Verdict log

- @coder DONE 2026-10-27: 5 files, vitest streamTiming 67/0 (59 pre-existing + 8 CS). Ruled: #R6 path fix (L9); predicate carries firstDeltaAt 4th channel; ChatStatsBar optional `message` prop (component unmounted, degrades safely); output-item channel includes reasoning-item summary text (the bug shape).
- @tester gate 1: VERDICT pass on all 4 commands (67/0 target, 88/0 full, prettier clean, svelte-check exactly 5952/188/321, zero errors naming package files). Set-check flagged PRE-EXISTING whitespace-only AGENTS.md diff (in STATE since ring epic, operator disposition) — not package-caused; not self-waived (L4), escalated to operator.
- @reviewer: ACCEPT-AMEND 2 minors. M1 bar-button "loading model" segment ungated (same defect class); M2 comment overstatement re relay string-delta path.
- @coder amend DONE 2026-10-28: M1 `$: evidence` hoisted, `{#if loading() && !evidence}` gate (:265 block; hover row untouched per reviewer scope); M2 comment-only. Diff matches mandated fix verbatim.
- @tester final: VERDICT pass — 88/0, prettier clean, svelte-check exact baseline, no new files in set. ACCEPTED.

## Gate verbs (precedent-verified)

tester: `npx vitest run <paths>`, `npm run check`, `npx prettier --check <files>`, read-only git.
Baselines: vitest 76/0 (will grow by CS cases); svelte-check 5952/188/321 (exit 1 pre-existing).
Commit manifest == gate manifest.

## Carried from ring-liveness epic (CLOSED, published)

Image open-webui:0.12.1-stats-amd64 ID 2d6a3524 pushed (both tags, digest sha256:251d01e9b7f6...).
Ring-epic packages WP-1L..4L ACCEPTED (commits b3498d155 ecf6eb2b4 ca97d46fd 23036dfb3) — operator
live check per prior procedure pending. Carried findings F1/F2/P2-1/P3-1 unchanged (see git history
of this file). Prior epics CLOSED: phase-progression (WP-LIVE3 pending-operator), session-integrity,
reload continuity. Spec canon: specs/context-ring-usage.md R1-R26; specs/local-images.md.

## Housekeeping noise (not this epic)

Uncommitted AGENTS.md trailing-newline diff; untracked specs/local-images.md, specs/chat-status-line.md,
this STATE rewrite — operator disposition.
