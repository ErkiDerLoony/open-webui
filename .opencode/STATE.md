# STATE — context ring + backend hardening (2026-10-23)

## Goal
Truthful context-ring token usage (frontend #R1–#R8 closed and accepted) plus backend usage-hardening follow-ups #R9/#R10 — current epic on branch local/chat-live-status; WP-BE2 is the open package.

## Packages
| id | scope | status |
|----|-------|--------|
| WP-MISE | ruff 0.17.2 via mise, tester.md ruff stanzas live | ACCEPTED — smoke 4/4 |
| WP-L6 | test:frontend hang report | REJECTED-INVALID — package.json correct at HEAD (`vitest run --passWithNoTests`); hang was transient env; probe self-exited exit 0 2026-10-23 |
| WP-BE2 | response.py R9 null-safety + style debt (I001/C901/format), context_compaction.py R10 zero-presence, spec/STATE/LESSONS | implemented, awaiting reviewer |

## Verdict log
- WP-MISE smoke PASS: ruff-check + ruff-format-check executed live, write-form denied by allowlist, `npm run test:frontend` self-exit confirmed.
- WP-BE2 self-verification (reviewer gate pending): `ruff check` + `ruff format --check` on response.py exit 0 raw; context_compaction.py changed lines clean, only pre-existing E501 at :420 (untouched region, reported not fixed); behavioral smoke R9/R10 48/48; R8 regression suite 26/26.
- Serialization: MISE → SMOKE → BE2 → reviewer (single-writer lanes per LESSONS L5).

## Spec
`specs/context-ring-usage.md` carries R1–#R10 canonical; new conformance rows CR-BE-02 (R9) and CR-BE-03 (R10), both reviewer gates.

## Deferred backlog (needs operator approval to schedule)
1. context_compaction.py pre-existing style findings (E501 :420) — diff-bloat guard.
2. CORE nits 2/3/5.
3. response.py:21 float truncation (`_token_value` int()).
4. mise self-update disabled (operator channel).
5. tester.md body rule-1 verb list missing ruff mention — frontmatter authoritative, cosmetic.

## Decisions
- R9: rate keys keep the legacy 'N/A' default (honest absence, not a fabricated zero); duration comparisons only when numeric; approximate_total omitted when total_duration unresolvable.
- R10: explicit numeric 0 resolves the alias chain (presence, not truthiness); non-zero behavior identical to before.
- Push = operator call; commits stay local on local/chat-live-status.

## Next action
@reviewer gate on WP-BE2 (CR-BE-02, CR-BE-03; response.py full-file ruff evidence included in package).
