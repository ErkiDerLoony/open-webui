# STATE — open-webui amd64 image rebuild (2026-10-22) — CLOSED

## Goal
`docker run` failed with `exec format error` (arm64 image on amd64 host).
Rebuild + publish **linux/amd64 only, for now**, version 0.12.1
(floating `0.12.1-stats` tag must point at amd64). Record amd64-only build rule in `AGENTS.md`.

## Hard constraints
- NO arm64 builds this cycle (operator decision).
- Mitmca build-context mandatory for every build: `--build-context mitmca=$HOME/mitmca-context`.
- Registry push by IP `10.10.10.10:5000` (OrbStack DNS workaround).
- WP-BUILD edits no repo files; WP-DOCS edits only `AGENTS.md`.

## Packages
| id | scope | acceptance | depends_on | status |
|----|-------|------------|------------|--------|
| WP-BUILD | build/push amd64 image + retag floating tag | arch=amd64; boots; pushed tags resolve | — | accepted* |
| WP-DOCS | AGENTS.md §"Local image builds & push" | amd64-only rule; --platform+mitmca in every cmd; exec-format-error note; diff confined | — | accepted |
| WP-DOCS-FIX | STATE.md only: add mitmca flag to buildx fallback; refresh statuses/verdict log | reviewer finding closed in new commit | WP-DOCS | accepted |
| WP-TEST | docker runtime gate | unrunnable — docker CLI not on tester allowlist | WP-BUILD | blocked |

\*accepted on operator confirmation ("build successful, running now"); independent tool gate unavailable — see Decisions.

## Verdict log
- 2026-10-22 WP-REVIEW: REJECT — single defect: buildx fallback lacked mandatory mitmca context (STATE.md); AGENTS.md items 2–8 PASS. Fixed via WP-DOCS-FIX (commit 214f3e58c).
- 2026-10-22 WP-TEST (two attempts, incl. model swap to Qwen): BLOCKED — docker CLI absent from tester allowlist.
- 2026-10-22 WP-REVIEW recheck: ACCEPT — defect closed at STATE.md buildx fallback line; all AGENTS.md items PASS. Epic closed.

## Serialization order
WP-BUILD ∥ WP-DOCS → WP-DOCS-FIX → reviewer recheck (done). No file overlap.

## Decisions
- Floating `0.12.1-stats` retagged to amd64 locally + in registry (amd64-only cycle); `latest` untouched.
- Cross-build: `docker build --platform linux/amd64 --build-context mitmca=$HOME/mitmca-context`; fallback `docker buildx build --platform linux/amd64 --build-context mitmca=$HOME/mitmca-context --load`.
- Build executed directly by operator after memory guard killed coder session; accepted on operator confirmation.
- Tool gap: add `docker ps`, `docker image inspect`, `docker manifest inspect` to tester allowlist to restore docker gates.
