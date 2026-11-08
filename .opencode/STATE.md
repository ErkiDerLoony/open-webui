# STATE — remove mitmca CA build-context (2026-11-08) — IN FLIGHT

## Goal

Operator: "Remove the whole ca thing, it's not needed any more." Delete the branch-local mitmca
CA machinery entirely: Dockerfile mount + CA-bundle exports, AGENTS.md mandatory-flag doctrine,
specs/local-images.md #R2 (drafted by director: WITHDRAWN). Prove with a flag-free amd64 build
+ retag + push. Prior epic (chip prefill fix, WP-LOAD*) CLOSED and shipped — facts below.

## Hard constraints

- Dockerfile is an upstream file: the change must only DELETE the local delta (lines 163,
  165, 166 of the python-deps RUN; the uv mount line 162 and set -e line 164 are upstream,
  untouched). Net branch diff on Dockerfile shrinks toward upstream.
- Proof build carries ONLY --platform linux/amd64; sentinel old id (must differ):
  77b64e18687845d3b29eab90952535fe8b50f34a227bcb546e4167a93c44fad0.
- git push forbidden (local commits only); docker push by IP 10.10.10.10:5000 both tags.
- Gate doctrine: static diff shape -> @reviewer; the flag-free build itself is the behavioral
  proof (docker not in tester allowlist -> @coder build package carries raw-output evidence).
- L12: DONE invalid if produced image Id == sentinel. L8: one command per shell call.

## Packages

| id | scope | acceptance | gates | status |
| -- | ----- | ---------- | ----- | ------ |
| WP-CA1 | Dockerfile (mitmca mount/comment/export deleted), AGENTS.md (build doctrine, 2 bullets) | no mitm refs outside withdrawn docs; RUN intact | @reviewer static | accepted (commit dc5d00fa0; gate post-hoc per L13) |
| WP-CA1-COMMIT | git bookkeeping (Dockerfile, AGENTS.md) | manifest == 2 paths | raw git log -1 --stat | accepted |
| WP-CA2-IMG | flag-free docker build + tag + inspect | exit 0; Id != sentinel fresh; both tags same Id amd64 | raw build/inspect output | accepted (2c8f598dfc41) |
| WP-CA2-PUSH | tag+push by IP both tags | identical registry digests | raw push digests | accepted (3d5b14a7ce2a) |
| WP-CA-RB | runbook tail commit (STATE.md + LESSONS.md L13) | manifest == 2 paths | self-verified | dispatched |

## Epic status: MITMCA REMOVAL COMPLETE — flag-free build shipped; operator eyeball of chip fix still pending on consumer

## Verdict log

- WP-CA1: coder DONE (Dockerfile -3 lines exactly, AGENTS.md 2 bullets; zero mitm hits).
  WP-CA1-COMMIT dc5d00fa0 landed FIRST (director sequencing slip: bookkeeping dispatched before
  the review gate — commit proven manifest-exact 2 paths anyway; lesson: gate before bookkeeping).
  @reviewer ACCEPT on direct evidence: RUN block byte-identical to upstream post-state, zero
  mitm/CA_BUNDLE residue, AGENTS.md doctrine consistent. WP-CA1 ACCEPTED.
- WP-CA2-IMG: flag-free build exit 0 (proof of removal; pip layer re-executed live 88.6s),
  fresh image sha256:2c8f598dfc4148905075947d90ec74da3ba77b2cb73669ce579cd4cf188c0bd5
  (2026-11-08T14:24, HEAD dc5d00fa0), sentinel avoided, tag pair identical amd64. ACCEPTED.
- WP-CA2-PUSH: both tags pushed to 10.10.10.10:5000; identical registry digest
  sha256:3d5b14a7ce27aa393dd326b176939152aba532c70c9a6614617839c4d658da9a (both 0.12.1-stats-amd64
  and floating 0.12.1-stats). ACCEPTED.

## Current image facts (this epic, replaces prior)

open-webui:0.12.1-stats-amd64 == floating 0.12.1-stats == local sha256:2c8f598dfc41…c0bd5,
built 2026-11-08T14:24 from dc5d00fa0, NO build-context flag, amd64. Registry digest
3d5b14a7ce2a… Consumer: docker pull atuin.local:5000/open-webui:0.12.1-stats-amd64

## Decisions

- specs/local-images.md #R2 marked WITHDRAWN in place (ID not reused); file stays untracked
  (operator disposition). ~/mitmca-context left on disk (outside repo, operator's call to delete).
- Already-deployed image 77b64e1868 (built with neutral bundle) remains pullable; post-CA
  rebuild replaces the tags.

## Carried / prior (CLOSED — WP-LOAD epic, 2026-11-08)

Chip fix ACCEPTED+SHIPPED: pre-token own-row binding + busy-model loading suppression
(chat-status-line.md #R7-#R9, LP-01..LP-06; context-ring-usage R11/R12/CR-10 amended).
Commits 41c7b9701 (+runbook d8576644a), image 77b64e1868 / registry digest eb8609b1b82a… both
tags. Operator eyeball AC (warm 2nd request shows prefill not loading) still pending on the
consumer. Blame facts: mitmca mount = 44cbe6d83 (branch); uv RUN line = upstream 517617b60.
Ring epic carried findings F1/F2/P2-1/P3-1 open non-blocking. Gate verbs: `npx vitest run*`,
`npm run check`, `npx prettier --check*`, read-only git; baselines vitest 96/0 (streamTiming
75), svelte-check 5952/188/321 exit1 pre-existing. LESSONS open rules in force: L8 (no
chaining), L10 (hashes vs .git/refs), L11 (verbatim gate excerpts, cross-check artifacts),
L12 (build sentinel). Build packages: coder backgrounding habit — require synchronous poll
until exit, verdict token mandatory.
