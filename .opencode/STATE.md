# STATE — open-webui amd64 image rebuild (2026-10-22)

## Goal
`docker run` failed with `exec format error` (arm64 image on amd64 host).
Rebuild and publish **linux/amd64 only, for now**, for version 0.12.1
(floating `0.12.1-stats` tag must point at amd64). Update `AGENTS.md` so
future builds default to amd64-only and the failure signature is documented.

## Hard constraints
- NO arm64 build this cycle ("only for now" — operator decision).
- Mitmca build-context is mandatory: `--build-context mitmca=$HOME/mitmca-context`.
- Registry push by IP `10.10.10.10:5000` (OrbStack DNS workaround).
- WP-BUILD edits no repo files; WP-DOCS edits only `AGENTS.md`.

## Packages
| id | scope | acceptance | depends_on | status |
|----|-------|------------|------------|--------|
| WP-BUILD | build/push amd64 image + retag floating tag | arch=amd64 inspect; smoke run boots; pushed tags resolve | — | dispatched |
| WP-DOCS | AGENTS.md §"Local image builds & push" + create STATE.md | amd64-only stated; cmds carry --platform + mitmca; exec-format-error note; diff confined to these 2 files | — | dispatched |
| WP-TEST | verification gate on WP-BUILD | rerun inspect/run/manifest checks | WP-BUILD | pending |
| WP-REVIEW | review gate on WP-DOCS diff | diff confined; content matches acceptance | WP-DOCS | pending |

## Serialization order
WP-BUILD ∥ WP-DOCS (zero-file vs AGENTS.md — non-overlapping).
WP-TEST after WP-BUILD. WP-REVIEW after WP-DOCS.

## Verdict log
(empty)

## Decisions
- Floating `0.12.1-stats` retagged to amd64 locally and in registry (amd64-only cycle).
- `latest` tag untouched.
- Cross-build via `docker build --platform linux/amd64`; fallback `buildx build --platform linux/amd64 --load`.
