# LESSONS — open-webui pipeline

L1 | 2026-10-23 | tester shell denied wholesale; behavioral gates unrunnable 2 epics running (prior: docker CLI gap) | agents/tester.md broad `shell "*"` deny + allowlist missing `npx vitest*`, `npm run test*`, `npx prettier --check*`, `git log*` shapes | operator appends 4 narrow allow stanzas after denies (last-match-wins), updates runner-list comment; fresh dispatch after watcher settles; retry once before failure (L3) | open-round3-fix-handed-to-operator
L2 | 2026-10-23 | ruff binary absent host-wide; backend style gate unrunnable, coder+reviewer substituted line-length/quote inspection | no ruff in PATH/.venv/pipx/uv on macOS host | install ruff (brew or pipx) or run via `uvx ruff`; until then STATE must record the substitution explicitly on every backend verdict | open
L3 | known | reload window after agent-config edits can false-fail fresh subagent dispatches | config watcher reload | retry once in a new dispatch before declaring gate failure | doctrine
L4 | known | gate waiver only when operator explicitly accepts on documented evidence; never self-waive | prior epic WP-BUILD precedent | log operator quote + substitute evidence in verdict line | doctrine
L5 | known | never edit a file a live @reviewer/@tester holds — cosmetic included | interleaving on shared model host | serialize edit behind gate verdict | doctrine
