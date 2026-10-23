# STATE — image rebuild 0.12.1-stats amd64 (2026-10-24) — CLOSED

## Goal
Ship repo tip 7d043cb7e (context-ring fixes + backend hardening) as open-webui:0.12.1-stats-amd64 + floating 0.12.1-stats at 10.10.10.10:5000. DONE — image also live per operator ("new image started").

## Artifacts (gate-verified)
- Registry digest (both tags): sha256:bc872ee563931d829e210fc9360ce8079a945090cd65928cae7ab4a6e00f62df (manifest 4288B)
- Image config Id: sha256:0482daa5e61f…, linux/amd64, 19 layers; floating tag == amd64 build.
- Fix presence: computeContextUsage confirmed in shipped bundle via source-map match (minified js renames symbols).
- Contains: R1-R10 spec cycle (ring numerator/denominator fixes, measured label, backend usage hardening).

## Packages
WP-GATE-DOCKER accepted | WP-IMG-BUILD accepted (local evidence: Id 0482daa5e61f, amd64) | WP-IMG-PUSH-FIX accepted (tags pre-existing; curl catalog proof; digest reconfirm) | WP-IMG-GATE-2 PASSED (manifest inspect --insecure --verbose, both tags, identical digest bc872ee56393).

## Verdict log
- Gate1 FAIL reclassified false-failure: plain `docker manifest inspect` cannot resolve against plain-HTTP registry (needs --insecure) — registry content was present all along (catalog proof). Local-cmd half passed before halt.
- Gate2 PASS: both refs resolve linux/amd64, digests byte-identical, config matches local image Id.

## Lessons to carry (for LESSONS.md next write)
L9-candidate: on this host, registry gates against 10.10.10.10:5000 MUST use `docker manifest inspect --insecure` (or buildx imagetools) — plain form "no such manifest" is a false-failure signature; encode in future image-gate payloads.
Registry still carries stale arm64 tags (0.12.0/0.12.1-stats-arm64) — cleanup is operator's call (deletion verbs intentionally gate-forbidden).
Registry persistence: verify data volume mount so tags survive registry restarts (diagnostics suggested persistence OK — tags present overnight).

## Remaining backlog
Unchanged code backlog in prior closed sections: compaction checkpoint truthiness (:295/:365), prompt_n junk hardening, helper dedup, E501:420, float truncation, client nits 2/3/5, tester.md prose parity, mise self-update.
