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
npm run build:tracker    # rebuilds the published-site analytics tracker into its source constant
npm run build:runtime    # rebuilds the published-site interaction runtime into its source constant
npm run test:e2e         # Playwright
npm run smoke:containers # builds the production images and exercises the running stack
npm run health           # asks production the way a visitor does, and exits non-zero if it is down
```

`smoke:containers` needs Docker and a throwaway database in `SMOKE_MONGODB_URI`. It uses its own
Compose project and database name, so it cannot touch production data.

`health` requests the public hostnames over HTTPS rather than asking a container about itself,
because a container reporting healthy while every visitor gets a 504 is a real state this platform
has been in. `HEALTH_HOST` points it elsewhere. See `docs/OPERATIONS.md` for running it on a
schedule.

`npm run test` starts an in-memory MongoDB per backend test file. The binary is downloaded on first
run and cached in `node_modules/.cache/mongodb-binaries`, so the machine needs network access once —
or `MONGOMS_SYSTEM_BINARY` pointing at an installed `mongod`. Without either, backend suites fail at
setup with a message saying exactly that; teardown tolerates the failed setup rather than burying it
under a second error about an undefined server. CI caches that directory across runs.

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
| API | `curl -sf http://localhost:7411/api/v1/health` |
| Public renderer | `curl -sf http://localhost:7412/healthz` |
| Frontend | `curl -sf http://localhost:7410/` |

No environment file is needed for the public shell; the database is reported as `not_configured`
until `MONGODB_URI` and `MONGODB_DB_NAME` are set.

Verifying a change: `npm run typecheck && npm run test && npm run build`, plus `npm run test:e2e`
when the change touches routing, the shell, or a user journey.

## Code graph

The CLI lives in `~/.local/bin`, which is not on the default PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"

graphify . --code-only --no-viz && graphify cluster-only .   # full rebuild
graphify update .                                            # incremental refresh
graphify query "<question>"                                  # scoped subgraph
graphify path "<A>" "<B>" --undirected                       # relationship between two symbols
open graphify-out/graph.html                                 # interactive view
```

Three things that are not obvious:

- `path` needs `--undirected` whenever the relationship crosses a barrel `export *`, which most of
  this repository's cross-workspace links do. Without it the answer is "no directed path found".
- `explain` matches **node names**, not concepts: `explain "resolveSafeLinkHref"` works,
  `explain "revision conflict"` finds nothing.
- `--code-only` avoids needing an LLM key. Without a key the Markdown files are skipped and
  community names stay as `Community N` placeholders; set `GEMINI_API_KEY` to get real names.

Treat every answer as a navigation hint and confirm it against the file and line it cites before
editing. `graphify-out/` is generated and git-ignored.

## Environment

Copy `.env.example` to `.env` and fill it. Startup validates required variables with Zod and fails
fast naming the missing variable — never its value. Only `VITE_*` variables reach the browser
bundle; database, auth, and provider credentials are backend-only.

Tests must not require a developer's personal database or reach a real DNS, Cloudflare, or Coolify
API. Backend integration tests use an ephemeral in-memory MongoDB.
