# STATE — context ring token-count fix (2026-10-23) — ACTIVE

## Goal

Context ring shows "650 tokens (1%)" on a very long conversation. Fix: token count reflects real active-branch conversation; percent vs user-configured compaction threshold when compaction enabled, vs model context size otherwise. Provider-agnostic (upstream: omlx, OpenAI-compatible).

## Hard constraints

- Contract: `.opencode/specs/context-ring-usage.md`; payloads cite #R<n> / CR-<n>.
- Frontend gate: `npm run format`; no new UI strings (i18n CI would fail) — reuse existing strings or raw English already present.
- No backend test suite in repo; backend WP gets @reviewer only.
- Scopes exclusive; WP-RING-BE serialized after WP-RING-CORE gates.

## Packages

| id           | scope                                                                                                                                                                                                                                    | acceptance                                                                                                | depends_on   | status                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------ | --------------------------- |
| WP-RING-CORE | src/lib/utils/contextUsage.ts, src/lib/utils/contextUsage.test.ts, src/lib/utils/index.ts, src/lib/components/chat/Chat.svelte, src/lib/components/chat/MessageInput.svelte, src/lib/components/chat/streamTiming.ts, spec + STATE files | spec R1–R7; CR-01..CR-08 pass (`npx vitest run src/lib/utils/contextUsage.test.ts`); npm run format clean | —            | implemented, awaiting gates |
| WP-RING-BE   | backend/open_webui/utils/response.py (+ middleware.py call-site only if required)                                                                                                                                                        | spec R8: no raise on missing fields; prompt/completion presence preserved; zero≠missing; reviewer ACCEPT  | WP-RING-CORE | pending                     |

## Verdict log

- (pending: tester CR-01..CR-08, reviewer R1–R7)

## Serialization order

WP-RING-CORE → gates → accept → WP-RING-BE.

## Decisions

- Operator 2026-10-23: percent vs compaction threshold when enabled, else model window; real numerator; all providers.
- Consolidate estimator+checkpoint into `src/lib/utils/contextUsage.ts`; ChatStatsBar/generationStats orphan path stays untouched.
- ContextRing.svelte stays pure (percent-only prop).
