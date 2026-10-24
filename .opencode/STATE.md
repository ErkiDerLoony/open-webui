# STATE — context ring/stats session-integrity epic (2026-10-24) — CLOSED

## Goal & outcome
Ring showed 279.2k/65.5k (100%), bogus cache-hit/total rows, pre-schedule tok/s. All fixed, gated, published.

## Root causes (final)
1. omlx emits SESSION-CUMULATIVE counters (total/input/output/cached_tokens) beside per-turn counts; frontend preferred explicit total -> cumulative numerator (#R13 sum-wins fixes).
2. Cache/total rows rendered from mixed cumulative vs per-turn fields (#R14/#R15 suppression).
3. Engine stats attributed positionally -> foreign requests' tok/s/tokens/phase pre-first-token (#R11/#R12 own-evidence claims).
4. Per-chat state (serverContextUsage/taskIds/engine mirrors) not reset on embedded chat switches (#R16); server percent unclamped (#R17).
5. Denominator 65.5k = advertised num_ctx — HONEST. compact_token_threshold exists nowhere in DB/chat params.

## Publication (WP-IMG3)
open-webui:0.12.1-stats-amd64 + floating 0.12.1-stats; image Id sha256:b9e8c56e59db…; registry manifest digest sha256:24d34ad5c85f… (identical both tags, from push output; cross-tag byte-identity + config-digest verified by tester). Markers in bundle: 'waiting for model' in shipped .js, computeContextUsage in .map. Branch tip fb6e1d9ec.

## Package ledger (all accepted)
WP-RATE c925933c9 | WP-RATE-FIX dd94083b4 | WP-NUMERATOR 86b723d76 | WP-POLISH 99eeb5221 | WP-ISOL b5ebbc29f | WP-FINAL-TOUCH 7a9a622f7 | WP-IMG3 published fb6e1d9ec. Gates: reviewer accept x5, tester pass x5 (51-55 tests green every cycle), infra denials (python3*, initial manifest inspect) handled per gate-perms.

## WP-LIVE — pending OPERATOR
1. Redeploy remote host: docker pull atuin.local:5000/open-webui:0.12.1-stats-amd64 (digest 24d34ad5c85f…), restart container.
2. Expect on young chat: numerator ≈ per-turn prompt tokens (tens of k, not cumulative), cache rows only when cached<=prompt, no Total row when provider total inconsistent, chip shows 'waiting for model' until first token, ring resets between chats.
3. Threshold semantics instead of window: set compact_token_threshold in chat/model params (none stored today; 65.5k is num_ctx).

## Backlog (unchanged items in prior ledgers)
python3* tester verb (operator breadth call); pollEngineStats/handleManualCompact/double-switch races; prompt_n ValueError; E501:420; float truncation; client nits; mise self-update; stale arm64 registry tags.

## Codified law (spec canonical: .opencode/specs/context-ring-usage.md R1-R17 + CR set)
Per-turn sum beats provider totals. Cumulative counters never enter context math. Engine rows claimable only with own-stream evidence. Impossible ratios suppressed. Percent ∈ [0,100]. Chat switch resets session state.
