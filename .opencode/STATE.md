# STATE — context ring token-count fix (2026-10-23) — ACTIVE

## Goal

Context ring showed "650 tokens (1%)" on long chats. Fix: real active-branch token count; percent vs configured compaction threshold when enabled, vs model context window otherwise; provider-agnostic (upstream omlx, OpenAI-compatible).

## Hard constraints

- Contract: `.opencode/specs/context-ring-usage.md` (#R1–#R8, CR ids).
- Frontend CI: prettier clean; NO new i18n keys without `npm run i18n:parse` + commit — avoid.
- Backend: reviewer-only gate (no backend suite in repo).
- Do not edit files a live gate holds (LESSONS L1/L5).

## Packages

| id           | scope                                                                                                                  | acceptance                                                                                          | depends_on   | status                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------- |
| WP-RING-CORE | contextUsage.ts(+test), utils/index.ts, Chat.svelte, MessageInput.svelte, streamTiming.ts, spec, STATE                 | R1–R7 + CR-01..08 pass under tester                                                                 | —            | reviewer accepted; awaiting tester re-run |
| WP-RING-FIX  | spec (R8 row), contextUsage.ts, contextUsage.test.ts, MessageInput.svelte (+ other `source` consumers), STATE, LESSONS | source label truthful (measured vs estimated); R8 minted; CR tests still pass under tester          | WP-RING-CORE | dispatched                                |
| WP-RING-BE   | backend/open_webui/utils/response.py (+ middleware.py call-site only if required)                                      | R8: no raise on missing fields; prompt/completion presence preserved; zero≠missing; reviewer ACCEPT | WP-RING-FIX  | pending                                   |

## Verdict log

- 2026-10-23 WP-RING-CORE @reviewer: ACCEPT — items A–I pass; nits: dangling R8 id (→ minted in FIX), finite-coercion ''/string (deferred), sum-0 checkpoint continue (deferred), source mislabel (→ FIX), coercion near-duplication (deferred).
- 2026-10-23 WP-RING-CORE @tester: BLOCKED — shell denied at permission layer; operator fixed allowlist; re-run scheduled post-FIX.

## Serialization order

CORE → FIX → tester re-run (covers CORE+FIX, acceptance gate for both) → BE (reviewer gate).

## Decisions

- Operator: percent vs compaction threshold when enabled else model window; real numerator; all providers; tester allowlist fixed (was wholesale shell deny); nit 4 fixed now, nits 2/3/5 deferred logged.
- ContextRing.svelte stays pure; ChatStatsBar/generationStats orphan path untouched.
