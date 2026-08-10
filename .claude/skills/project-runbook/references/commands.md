# Commands

All commands run from the repository root. Install once at the root — nested installs create
nested lockfiles and are wrong.

```bash
npm install              # one root install for every workspace
npm run dev              # frontend + API + public renderer, all terminate together
npm run dev:frontend     # Vite only
npm run dev:backend      # API only
npm run dev:renderer     # public renderer only
npm run typecheck        # tsc --noEmit across every workspace
npm run test             # Vitest across every workspace
npm run build            # production build of every workspace
npm run test:e2e         # Playwright
```

Scope to one workspace with `-w`:

```bash
npm run typecheck -w frontend
npm run test -w backend
npm run build -w packages/shared
```

## Plan tooling

```bash
node .claude/skills/execute-plan-task/scripts/extract-plan-task.mjs P3-T2
npm run check:plan-skill   # fixture tests for the extraction script
npm run check:runbook      # fails when these references drift from package.json
```

## Run and verify recipe

Starting the app: `npm install` once, then `npm run dev`. It starts three processes and they stop
together. Ready when all three answer:

| Process | Check |
|---|---|
| API | `curl -sf http://localhost:3000/api/v1/health` |
| Public renderer | `curl -sf http://localhost:3001/healthz` |
| Frontend | `curl -sf http://localhost:5173/` |

No environment file is needed for the public shell; the database is reported as `not_configured`
until `MONGODB_URI` and `MONGODB_DB_NAME` are set.

Verifying a change: `npm run typecheck && npm run test && npm run build`, plus `npm run test:e2e`
when the change touches routing, the shell, or a user journey.

## Code graph

```bash
graphify . --code-only --no-viz && graphify cluster-only .   # rebuild
graphify query "<question>"                                  # scoped subgraph
graphify update .                                            # incremental refresh
```

`graphify-out/` is generated and git-ignored. `--code-only` avoids needing an LLM key; without one,
community names stay as placeholders.

## Environment

Copy `.env.example` to `.env` and fill it. Startup validates required variables with Zod and fails
fast naming the missing variable — never its value. Only `VITE_*` variables reach the browser
bundle; database, auth, and provider credentials are backend-only.

Tests must not require a developer's personal database or reach a real DNS, Cloudflare, or Coolify
API. Backend integration tests use an ephemeral in-memory MongoDB.
