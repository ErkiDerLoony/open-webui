# STATE — stats-line reload continuity epic (2026-10-24) — ACTIVE

## Goal
Live run stats line survives a browser reload/navigation while an assistant
response is still generating (runs registry was memory-only; beginRun fired only
at submit; loadChat never rehydrated).

## Packages
- WP-RELOAD — DISPATCHED (this session): needsRunRehydration predicate +
  beginRun opts.startedAt override in generationStats.ts; loadChat rebuilds the
  run for the active-branch tail assistant message (persisted timestamp, s/ms
  scale detect). Spec #R18 / CR-16 appended. Gates: vitest 63 green
  (streamTiming 47 + contextUsage 12 + versionDiff 4), prettier clean.
- WP-IMG4 — PENDING: rebuild + push 0.12.1-stats from final tip. Marker check:
  'needsRunRehydration' absent from minified js (renamed away) — use the
  'waiting for model' marker re-check + record new bundle digest; cross-tag
  byte-identity per prior procedure (amd64-only, mitmca context, push by IP).
- WP-LIVE2 — PENDING OPERATOR: redeploy remote host, then reload mid-long-
  response: live stats line must persist; elapsed times may restart from the
  persisted message timestamp (not wall-clock submit).

## Verdict log
(empty — new epic)

## Prior: session-integrity epic CLOSED (image 24d34ad5)
Ring cumulative-counter fixes, own-evidence engine claims, cache/total
suppression, per-chat reset, percent clamp — R1-R17 + CR set codified in
.opencode/specs/context-ring-usage.md; published open-webui:0.12.1-stats-amd64
+ floating tag (manifest digest sha256:24d34ad5c85f…), operator redeploy of
that image still outstanding from WP-LIVE.

## Backlog (carried)
python3* tester verb (operator breadth call); pollEngineStats /
handleManualCompact / double-switch races; prompt_n ValueError; E501:420; float
truncation; client nits; mise self-update; stale arm64 registry tags.

## Codified law (spec canonical: .opencode/specs/context-ring-usage.md R1-R18 + CR set)
Per-turn sum beats provider totals. Cumulative counters never enter context
math. Engine rows claimable only with own-stream evidence. Impossible ratios
suppressed. Percent ∈ [0,100]. Chat switch resets session state. A reload
mid-generation reconstructs the live run (#R18).
