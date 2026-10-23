# STATE — context ring token-count fix (2026-10-23) — CLOSED

## Goal
Context ring showed "650 tokens (1%)" on long chats. Fixed: real active-branch token count; percent vs configured compaction threshold when compaction enabled, vs model context window otherwise; provider-agnostic (upstream omlx, OpenAI-compatible).

## Packages
| id | scope | acceptance | depends_on | status |
|----|-------|------------|------------|--------|
| WP-RING-CORE | contextUsage.ts(+test), utils/index.ts, Chat.svelte, MessageInput.svelte, streamTiming.ts, spec (0a768e08d) | R1–R7 + CR-01..08 under both gates | — | accepted |
| WP-RING-FIX | spec R8, source label, STATE, LESSONS (c04c5cde3) | truthful label + CR suite green under tester | WP-RING-CORE | accepted |
| WP-RING-BE | backend/open_webui/utils/response.py (c73925b24) | R8 no-raise + presence preserved | WP-RING-FIX | accepted |

## Verdict log
- CORE @reviewer: ACCEPT — A–I pass; nits 2/3/5 deferred, nit4 fixed in FIX.
- CORE+FIX @tester: PASS — tip chain exact; 9/9 contextUsage tests (CR-01..08 + source label, names grep-corroborated); full frontend suite 23 passed / 0 failed; prettier clean on 6 src files; missing_allowance none.
- BE @reviewer: ACCEPT — guards/presence/no-double-fold/consumers/arity pass; ruff absent host-wide → line-length/quote substitution logged (L2).

## Spec outcome
`.opencode/specs/context-ring-usage.md` carries R1–R8 + CR-01..CR-08 + CR-BE-01 as canonical; this runbook is the disposable layer — retained as closed record only.

## Deferred backlog (needs operator approval to schedule)
1. `package.json` test:frontend lacks vitest `run` subcommand → watch-mode hang in CI/gates; propose `vitest run --passWithNoTests` (LESSONS L6).
2. response.py:218-219,236,244 convert_ollama_usage_to_openai null-unsafe + zero-fabrication (outside R8 named functions).
3. context_compaction.py:243,247 `or`-chain collapses prompt_tokens=0 (R3-style).
4. Install ruff on host (L2); CORE review nits 2/3/5 (coercion strictness, sum-0 checkpoint, helper near-duplication); response.py:21 float truncation.

## Decisions
- Operator: percent vs compaction threshold when enabled else model window; real numerator; all providers; declined evidence-waiver, amended tester to canonical-verb allowlist (gate-perms doctrine).
- ContextRing.svelte kept pure; ChatStatsBar/generationStats orphan path untouched; no new i18n keys (CI constraint honored).
