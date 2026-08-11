# WebsiteBuilder

Visual website builder SaaS. Structured builder JSON is the source of truth; one shared renderer
serves editor preview and the published multi-tenant public site.

`IMPLEMENTATION_PLAN.md` is the authoritative specification. Do not read it whole — load one task
with `/execute-plan-task <TASK-ID>` (e.g. `/execute-plan-task P3-T2`).

## Fixed stack

- npm workspaces: `frontend/`, `backend/`, `packages/shared/`. One root `package-lock.json`.
- Frontend: React 19, TypeScript strict, Vite, Tailwind, react-router, Zustand, Zod, Moveable,
  Lucide, Tiptap, i18next, Vitest + RTL, Playwright.
- Backend: Node 22, TypeScript, Express 5, MongoDB driver (no Mongoose), Zod, Pino, Better Auth
  (+ Organization plugin), GridFS behind a storage interface, Sharp.
- `packages/shared/`: framework-independent types, Zod schemas, URL/slug rules. No React, no
  Express, no browser or database code.

## Language policy

- Answer the user in Brazilian Portuguese (`pt-BR`).
- Every committed technical artifact is in English: identifiers, filenames, comments, tests, commit
  messages, logs, API contracts, database fields, error codes, docs.
- Product UI copy lives in locale resources only. Any task touching visible copy updates **both**
  `pt-BR` and `en-US`. Never hardcode visible strings.

## Non-negotiable rules

- Never `dangerouslySetInnerHTML`; no arbitrary HTML/CSS/JS from users.
- Links are typed data validated by the shared safe-link utility on client and server.
- Responsive values are structured allowlisted units/keywords, never raw CSS strings.
- Every business query is scoped by a server-verified `workspaceId` first, then resource IDs.
- Saves require the last known `revision`; a stale write returns `409 REVISION_CONFLICT`.
- Never commit secrets. Backend secrets never enter `VITE_*`.
- Do not weaken validation, security, tenant isolation, accessibility, or tests to shorten code.

## Commands

```bash
npm install            # once, from the repository root
npm run dev            # frontend + API + public renderer
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

## Skills

- `/execute-plan-task <ID>` — load and execute exactly one plan task.
- `/project-runbook` — architecture map, commands, definition of done (progressive disclosure).
- `/graphify` — knowledge graph. Prefer `graphify query "<question>"` over broad source browsing
  when `graphify-out/graph.json` exists; run `graphify update .` after material changes.

## Git

`origin` is `https://github.com/Gabrielleobeltrao/WebsiteBuilder.git`. Only `main` and `development`
are long-lived. Work integrates into `development`.

`main` is promoted by fast-forwarding it from `development`, and only when `npm run typecheck && npm
run test && npm run build && npm run test:e2e` all pass on the commit being promoted. A pull request
is not required — the repository has one maintainer, and a review gate they approve themselves is
paperwork, not a control.

Two things still hold, because they are what a fast-forward preserves and what a mistake destroys:
never force-push `main`, and never commit to it directly. Promotion moves `main` to a commit that
already exists on `development` and was already tested there.
