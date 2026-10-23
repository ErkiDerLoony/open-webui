# STATE — context ring fix + backend hardening (2026-10-23) — CLOSED

## Goal
Context ring showed "650 tokens (1%)" on long chats (fixed prior cycle, commits 0a768e08d/c04c5cde3/c73925b24). This cycle: restore backend gate toolchain via mise (L2), resolve L6, harden backend usage paths (R9/R10), clear response.py style debt.

## Packages
| id | scope | acceptance | depends_on | status |
|----|-------|------------|------------|--------|
| WP-MISE | mise install ruff + tester.md ruff stanzas (~/.config layer) | ruff resolvable fresh shell; smoke-proven | — | accepted |
| WP-MISE-SMOKE | tester gate-perms probe ×4 | executed/denied as marked | WP-MISE | passed 4/4 |
| WP-L6 | package.json test:frontend | — | — | rejected-invalid (script correct at HEAD; prior hang transient env, probe self-exited exit 0) |
| WP-BE2 | response.py (R9 + C901/I001/format debt), context_compaction.py (R10), spec R9/R10, STATE, LESSONS (bc105db34) | R9/R10 review + ruff gates | WP-MISE-SMOKE | accepted (reviewer accept + tester 5/5) |

## Verdict log
- SMOKE: PASS — ruff check/format-check executed, bare `ruff format <file>` denied (narrowness proven), npm run test:frontend self-exited exit 0.
- BE2 @reviewer: ACCEPT — R9/R10/R8-regression PASS; deviations adjudicated acceptable ('N/A' rate sentinel honest-absence w/ zero consumers; approximate_total omission w/ no bracket-access consumers; bool exclusion symmetric); docs consistent.
- BE2 @tester: PASS — response.py check+format exit 0 (baseline I001+C901 cleared); context_compaction.py only pre-existing E501:420; format clean.

## Spec outcome
context-ring-usage.md now canonical R1–R10 + CR-01..08, CR-BE-01..03. All accepted deltas merged; runbook retained as closed record.

## Deferred backlog
1. context_compaction.py:295/:365 checkpoint gate `(tokens := _usage_token_count(usage))` truthiness-based — legitimate zero-token checkpoint skipped; R2/R3-adjacent (reviewer finding).
2. context_compaction.py:259 `int(usage.get('prompt_n') or 0)` ValueError on non-numeric junk (pre-existing pattern).
3. Dedup _present_number (compaction) ≈ _first_number (response) into shared util.
4. response.py:21 int() float truncation; context_compaction.py:420 pre-existing E501.
5. CORE client nits 2/3/5 (coercion strictness, sum-0 checkpoint continue, helper near-duplication).
6. tester.md body rule-1 verb list lacks ruff mention (frontmatter authoritative; cosmetic).
7. mise self-update disabled — operator channel (brew/etc).

## Decisions
- Operator: mise is sanctioned tool installer (LESSONS L7); gate-perms doctrine applied first time successfully — preflight caught missing ruff verbs, amend+smoke before real gate, zero gate outages this cycle.
- Backend behavior smoke (R9/R10 48/48) remains coder-self-reported per CR-BE review-only conformance; commit fixtures only if a future backend suite lands.
