# STATE — context ring token-count fix (2026-10-23) — ACTIVE

## Goal

Context ring showed "650 tokens (1%)" on long chats. Fix: real active-branch token count; percent vs configured compaction threshold when enabled, vs model context window otherwise; provider-agnostic (upstream omlx, OpenAI-compatible).

## Hard constraints

- Contract: `.opencode/specs/context-ring-usage.md` (#R1–#R8, CR ids).
- Frontend CI: prettier clean; NO new i18n keys without `npm run i18n:parse` + commit — avoid.
- Backend: reviewer-only gate (no backend suite in repo).
- Do not edit files a live gate holds (LESSONS L1/L5).
- ContextRing.svelte stays pure; ChatStatsBar/generationStats orphan path untouched.

## Packages

| id           | scope                                                                                       | acceptance                                                                            | depends_on   | status                                                                     |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------- |
| WP-RING-CORE | contextUsage.ts(+test), utils/index.ts, Chat.svelte, MessageInput.svelte, streamTiming.ts    | R1–R7 + CR-01..08 pass under tester                                                   | —            | reviewer accepted; tester gate blocked ×2 (config gap), rerun pending operator fix |
| WP-RING-FIX  | spec (R8 row), contextUsage.ts(+test), MessageInput.svelte, STATE, LESSONS                   | source label truthful (measured vs estimated); R8 minted; CR tests still pass under tester | WP-RING-CORE | implemented (commit c04c5cde3, self-tests 9/9); tester gate pending same rerun |
| WP-RING-BE   | backend/open_webui/utils/response.py (middleware.py untouched — audited, no changes needed)  | R8: no raise on missing fields; prompt/completion presence preserved; zero≠missing    | WP-RING-FIX  | implemented, awaiting reviewer                                               |

## Verdict log

- 2026-10-23 WP-RING-CORE @reviewer: ACCEPT — items A–I pass; nits 2/3/5 deferred, nit 4 fixed in WP-RING-FIX.
- 2026-10-23 WP-RING-CORE @tester: BLOCKED ×2 — wholesale shell denial at permission layer; grant attempts did not take effect.
- 2026-10-23 WP-RING-BE gate note: ruff binary absent (PATH, repo venvs, python -m) — ruff format/check gates BLOCKED; ast.parse pass; 26/26 R8 presence smoke checks pass.

## Serialization

CORE + FIX → tester rerun (covers CORE+FIX; acceptance gate for both) → BE accept.

## Decisions

- Operator declined waiver, chose allowlist fix — grant not effective, config diagnosis in flight (agent-frontmatter vs project config precedence).
- Percent vs compaction threshold when enabled, else model window; real numerator; all providers; nits 2/3/5 deferred logged, nit 4 fixed in FIX.
- Tester allowlist: npx vitest, npm run test:frontend, npx prettier --check, git log.
