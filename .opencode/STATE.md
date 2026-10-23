# STATE — ring + run-stats tooltip + script fix: ALL CLOSED (2026-10-23)

## Goals — both achieved, accepted, committed (branch local/chat-live-status)
1. RING: truthful context ring token count/percent; contract `.opencode/specs/context-ring-usage.md` #R1–#R8 canonical.
2. WP-TIP: run-stats chip tooltip reuses canonical `common/Tooltip.svelte` + single builder `formatUsageTooltipHtml` — one tooltip type; locale-grouped tokens; unit-normalized rates (`resolveDurationMs` ns→µs→s, ≤100k guard, backend-provided rates win).

## Packages
| id | scope | acceptance | depends_on | status |
|----|-------|------------|------------|--------|
| WP-RING-CORE | contextUsage.ts(+test), utils/index.ts, Chat.svelte, MessageInput.svelte, streamTiming.ts, spec (0a768e08d) | R1–R7 + CR-01..08 under both gates | — | ACCEPTED |
| WP-RING-FIX | spec R8, truthful source label, STATE, LESSONS (c04c5cde3) | label + CR suite green under tester | WP-RING-CORE | ACCEPTED |
| WP-RING-BE | backend/open_webui/utils/response.py (c73925b24) | R8 no-raise + presence preserved | WP-RING-FIX | ACCEPTED |
| WP-TIP | MessageRunStats.svelte, streamTiming.ts(+test), STATE (a130972f3) | common Tooltip + single builder; no popover/local rows/unit math; vitest 19/19 + prettier clean + svelte-check zero touched-file hits at exact 5952 baseline | — | ACCEPTED (reviewer 7/7 + tester live) |
| WP-SCRIPT-FIX | package.json test:frontend (651ba0881) | `vitest run --passWithNoTests`; exits 0, 23/23 green | WP-TIP | ACCEPTED (live smoke exit 0) |

## Verdict log (final)
- RING CORE/FIX @reviewer ACCEPT; @tester PASS — CR 9/9 live, full suite 23/23.
- RING BE @reviewer ACCEPT (ruff absent host-wide → inspection substitution).
- WP-TIP @reviewer ACCEPT 7/7 (nits deferred); @tester ACCEPT — vitest 19/19 exit 0, prettier clean, svelte-check 5952/188 baseline with zero MessageRunStats/streamTiming mentions.
- WP-SCRIPT-FIX @tester smoke: `npm run test:frontend` terminates exit 0, 3 files/23 tests; tree clean except operator-owned AGENTS.md + specs/local-images.md; commits a130972f3 + 651ba0881 adjacent under sibling close-out 4508893ec; branch verified via .git/HEAD.
- Gate infra: tester allowlist amended per gate-perms doctrine (operator, WP-GATE-PERM-1; LESSONS L13 wired). L15 = watch-mode defect, fixed + smoke-proven.

## Spec outcome
`specs/context-ring-usage.md` carries R1–#R8 + CR ids canonical; tooltip unification is internal-consistency work (no external contract); runbook now disposable close record.

## Deferred backlog (needs operator approval to schedule)
1. response.py:218-219,236,244 convert_ollama_usage_to_openai null-unsafe + zero-fabrication.
2. context_compaction.py:243,247 `or`-chain collapses prompt_tokens=0 (R3-style).
3. Install ruff on host; CORE nits 2/3/5; TIP nits N1–N3 (rate-0 fallback suppression streamTiming.ts:282-287; `(41720)` paren; pollTimer ordering); response.py:21 float truncation.
4. Operator: serialize director sessions per repo (LESSONS L14 recurring x2 today).

## Decisions
- Operator: percent vs compaction threshold when enabled else model window; real numerator; all providers; declined evidence-waiver; canonical-verb gate allowlist approved; close-out committed without push (push = operator call).
- WP-TIP: chip + ⓘ share one Tooltip component + one content builder; ChatStatsBar orphan untouched; locale-robust grouping assertion (host ICU ≠ en-US).

## Next action
None pending — awaiting new operator work. Unpushed commits on local/chat-live-status: 0a768e08d..4508893ec + this runbook's final commit.
