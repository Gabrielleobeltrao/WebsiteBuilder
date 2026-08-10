# Architecture map

Three npm workspaces. One root `package-lock.json`. Directories are created when their first real
module exists — do not scaffold empty layers.

## `packages/shared/`

Framework-independent contracts consumed by both other workspaces: TypeScript types, Zod schemas,
`SCHEMA_VERSION`, ID/slug normalization, safe-link parsing, responsive-value units.

Must not import React, Express, `mongodb`, or any browser-only API. This is the rule that keeps
editor, preview, and the public renderer from drifting apart.

## `frontend/`

| Path | Owns |
|---|---|
| `src/app/`, `src/routes/` | Route tree, `PublicShell` and `AuthenticatedAppShell` layouts |
| `src/components/renderer/` | Pure presentational renderers — no editor state, no selection logic |
| `src/components/common/` | Shared primitives (buttons, fields, overlays) |
| `src/features/editor/` | `canvas/`, `elements/`, `inspector/`, `toolbar/`, `store/` |
| `src/features/*` | `dashboard`, `auth`, `workspaces`, `clients`, `campaigns`, `projects`, `pages`, `blog`, `media`, `preview` |
| `src/i18n/locales/{pt-BR,en-US}/` | Namespaced locale resources — the only home for visible copy |
| `src/api/`, `src/lib/`, `src/hooks/` | Typed fetch client, utilities, hooks |
| `e2e/` | Playwright specs |

The renderer under `components/renderer/` is shared by editor, preview, and published output.
Editor-only interaction wrappers (Moveable, selection outlines) live in `features/editor/` and never
leak into the renderer.

## `backend/`

| Path | Owns |
|---|---|
| `src/app.ts` | Express app assembly — importable by tests without binding a port |
| `src/server.ts` | API process entrypoint |
| `src/renderer-server.ts` | Public multi-tenant renderer process entrypoint |
| `src/config/` | Zod-validated environment |
| `src/db/` | Mongo client, indexes, graceful close |
| `src/middleware/` | Auth, workspace scoping, errors, rate limits |
| `src/modules/<domain>/` | `projects`, `workspaces`, `clients`, `campaigns`, `blog`, `media`, `publishing`, `domains` — each with repository, service, routes |
| `src/routes/` | Route mounting under `/api/v1` |
| `tests/` | Vitest + Supertest |

The public renderer is code inside `backend/`, not a third workspace.

## Boundaries that matter

- Every business repository method takes a server-verified `workspaceId`. There is no unscoped read.
- Document writes carry the last known `revision`; a stale write is `409 REVISION_CONFLICT`.
- API contracts expose Mongo `_id` as `id: string`. Element and page IDs are application UUIDs.
- Frontend never talks to Mongo; backend never imports React.
