# AGENTS.md

Open WebUI — self-hosted AI platform. One repo, two apps: a SvelteKit frontend and a FastAPI backend that are built and shipped together.

## Structure

- `src/` — SvelteKit + TypeScript + Tailwind v4 frontend (Svelte 5, i18next, tiptap). Routes in `src/routes`, API client wrappers in `src/lib/apis/<domain>/` mirror backend routers.
- `backend/open_webui/` — FastAPI app. All routers are mounted in `backend/open_webui/main.py` (`/api/v1/*`, plus `/ollama` and `/openai` proxies). Env-driven config lives in `config.py` / `env.py`; models in `models/`; Alembic in `migrations/`.
- The backend serves the built frontend: `npm run build` outputs to `build/`, which FastAPI mounts via `FRONTEND_BUILD_DIR` (API-only if missing).
- Default DB is SQLite at `backend/data/webui.db`; Postgres/MariaDB via pyproject extras.

## Dev workflow

- Full-stack dev needs both servers: `bash backend/dev.sh` (uvicorn `--reload`, :8080) and `npm run dev` (Vite, :5173). Vite proxies `/api`, `/ollama`, `/openai`, `/oauth`, `/ws` to :8080 — override target with `WEBUI_BACKEND_URL`.
- `npm run dev`/`build` first run `pyodide:fetch`, which downloads Pyodide wheels into `static/pyodide` (needs network on first run; cached until the `pyodide` dep version changes).
- Python: 3.11–3.12 only (`requires-python`). Node: 18.13–22 enforced by `.npmrc` `engine-strict=true`. CI installs with `npm install --force` (peer-deps conflicts exist).

## Verification commands

- Frontend: `npm run format` (Prettier writes — tabs, single quotes, width 100), `npm run check` (svelte-check; run before typecheck-sensitive work), `npm run test:frontend` (Vitest; a single file: `npx vitest run src/path/file.test.ts`).
- Backend: `ruff format . --exclude .venv --exclude venv` and `ruff check` — line-length 120, single quotes. A pre-commit hook runs ruff on `backend/`.
- `npm run lint` also invokes pylint, which CI does not use — the real backend gate is `ruff format --check` plus a narrow `ruff check --select=F`. Prefer ruff.

## CI and release quirks

- Adding new UI strings requires running `npm run i18n:parse` and committing the regenerated `src/lib/i18n/locales/en-US/translation.json` — Frontend CI runs it then fails on any uncommitted `git diff`.
- Version single source of truth is `package.json` (hatch reads it for the Python package).
- Releases are PRs from `dev` into `main` titled with the version (`0.x`/`1.x`). Only such version-titled PRs trigger the regression suite, which lives in the separate `open-webui/tests` repo — there is no backend test suite in this repo, so don't hunt for one.
- Change detection splits CI: backend-only changes (paths `backend/**`, `pyproject.toml`, `uv.lock`) skip Frontend CI and vice versa.

## Backend gotchas

- Schema changes require an Alembic revision in `backend/open_webui/migrations/versions/`; migrations run automatically at startup via `run_migrations()` in `backend/open_webui/config.py` (gated by `ENABLE_DB_MIGRATIONS`).
- Python deps are pinned in both `pyproject.toml` and `backend/requirements.txt` (plus `requirements-slim.txt`); Docker installs from the requirements files, so keep them in sync with `pyproject.toml`.
- Console noise: esbuild strips `console.log/debug/error` from production frontend builds unless `ENV=dev`; backend uses loguru.
- The root `Makefile` is stale (calls missing `confirm_remove.sh`/`update_ollama_models.sh`) — for container work use `docker-run.sh`, `docker-compose-launcher.sh`, or the compose files instead.

## Local image builds & push

- CURRENT OPERATING MODE (until further notice): builds are linux/amd64 ONLY. Do not build arm64.
- Every build command MUST carry `--platform linux/amd64`. No build-context flags exist any more (the old mitmca CA context was removed 2026-11-08).
- Build amd64 (example version 0.12.1): `docker build --platform linux/amd64 -t open-webui:0.12.1-stats-amd64 .`
- Floating tag = amd64 (amd64-only cycle): retag `<ver>-stats` onto the amd64 build, overwriting any arm64 tag: `docker tag open-webui:0.12.1-stats-amd64 open-webui:0.12.1-stats`
- Push workaround: Due to OrbStack DNS issues, tag+push by IP — both the arch-suffixed and floating tags: `docker tag open-webui:0.12.1-stats-amd64 10.10.10.10:5000/open-webui:0.12.1-stats-amd64 && docker push 10.10.10.10:5000/open-webui:0.12.1-stats-amd64`, then `docker tag open-webui:0.12.1-stats 10.10.10.10:5000/open-webui:0.12.1-stats && docker push 10.10.10.10:5000/open-webui:0.12.1-stats`.
- Consumers pull amd64 tags: `docker pull atuin.local:5000/open-webui:0.12.1-stats-amd64`.
- Failure signature: `exec format error` on `docker run` = image/host arch mismatch; fix by rebuilding with `--platform linux/amd64` (then retag the floating `<ver>-stats` tag to the amd64 build).

