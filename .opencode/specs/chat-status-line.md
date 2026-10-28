# Spec — chat status line ("waiting for model" latch)

Canonical behavior for the live run-status chip (MessageRunStats footer chip, ChatStatsBar
"Current phase"). Origin: operator bug 2026-10-27 — chip showed `5m 26s · waiting for model`
while thoughts were visibly streaming (omlx, thoughts-only output channel).

## Requirements (EARS)

#R1 Output-visible precedence. WHEN the live run's assistant message carries any streamed
own-text — content body, reasoning/thinking delta aliases, or output-item text — THE SYSTEM
SHALL not display "loading model" nor "waiting for model" for that run's status line.
Conformance: CS-01, CS-02.

#R2 First-delta stamping. WHEN a stream delta yields non-empty text via the content channel or
via any reasoning alias recognized by getReasoningText, THE SYSTEM SHALL stamp run.firstDeltaAt
at that point (applyStream in generationStats.ts). A thoughts-only stream must therefore end
the waiting latch no later than its first token.
Conformance: CS-04.

#R3 Shared evidence helper. THE SYSTEM SHALL expose one exported predicate in streamTiming.ts
(e.g. hasOwnOutputEvidence(message, run)) covering all three text channels (content, reasoning
aliases, output items), and MessageRunStats.hasOwnDeltas and ChatStatsBar.phaseLabel SHALL
consume it instead of content-length-only checks.
Conformance: CS-01, CS-02, CS-03 (static wiring check by @reviewer).

#R4 Cold-start preserved. WHEN a run has no own-text evidence, no firstDeltaAt, no claimable
engine row and no loading evidence, THE SYSTEM SHALL still display "waiting for model"
(and "loading model N% ~Ns" when loading evidence exists). No existing streamTiming test
semantics may regress.
Conformance: CS-05 (all pre-existing streamTiming.test.ts cases stay green).

#R6 Frontend-only. THE SYSTEM SHALL confine changes to src/lib/utils/streamTiming.ts,
src/lib/stores/generationStats.ts, src/lib/components/chat/ChatStats/MessageRunStats.svelte,
src/lib/components/chat/ChatStats/ChatStatsBar.svelte, src/lib/utils/streamTiming.test.ts.
(Amended 2026-10-27: generationStats.ts canonical location is src/lib/stores/, not utils/.)

## Conformance tests (src/lib/utils/streamTiming.test.ts, new describe "status-line evidence")

- CS-01: hasOwnOutputEvidence true for reasoning-only message (empty content, thinking text via
  each alias); resolveDisplayPhase with that evidence never returns 'waiting'.
- CS-02: hasOwnOutputEvidence true for output-item-text-only message; phase not 'waiting'.
- CS-03: MessageRunStats + ChatStatsBar wire the shared predicate (reviewer static check).
- CS-04: applyStream on a reasoning-alias-only delta stamps run.firstDeltaAt.
- CS-05: full existing suite passes unchanged in count of pre-existing cases (>= 59 in this file).
