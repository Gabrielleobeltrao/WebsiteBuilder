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

## Environment

Copy `.env.example` to `.env` and fill it. Startup validates required variables with Zod and fails
fast naming the missing variable — never its value. Only `VITE_*` variables reach the browser
bundle; database, auth, and provider credentials are backend-only.

Tests must not require a developer's personal database or reach a real DNS, Cloudflare, or Coolify
API. Backend integration tests use an ephemeral in-memory MongoDB.
