# WebsiteBuilder

A visual website builder SaaS. Users compose pages by dragging elements onto a canvas, mix freely
positioned sections with grid and flex layouts, manage blog and CMS content, collect form
submissions, and publish to a real domain — from one workspace that serves both a solo builder and
an agency managing many clients.

The builder document is structured JSON. Generated HTML is never stored:

```
Builder JSON → validated immutable snapshot → shared renderer → subdomain / custom domain
```

One renderer serves the editor canvas, the preview and the published site, so what a designer sees
is produced by the code that serves visitors.

---

## Contents

- [Status](#status)
- [Stack](#stack)
- [Repository layout](#repository-layout)
- [Running locally](#running-locally)
- [Commands](#commands)
- [Environment variables](#environment-variables)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Internationalisation](#internationalisation)
- [Testing](#testing)
- [Deployment on Coolify](#deployment-on-coolify)
- [Branch and release workflow](#branch-and-release-workflow)
- [Known limitations](#known-limitations)

---

## Status

Development is driven by `IMPLEMENTATION_PLAN.md`, which is the authoritative specification. It
tracks every task with a checkbox, a Progress Log and a Decision Log.

Several plans have been executed against this repository. At the time of writing:

| Plan | Complete | Blocked | Remaining |
|---|---|---|---|
| `IMPLEMENTATION_PLAN.md` | 35 | 1 (`8.4`, deployed smoke: owner access) | 0 |
| `STABILITY_BLOG_UX_PLAN.md` | 16 | 1 (`P0-T3`, incident confirmation: owner account) | 0 |

Both blocked tasks need the owner's production access, not code. Everything else is done and its
gates are recorded in each plan's Progress Log.

Run one task at a time with the project skill:

```bash
node .claude/skills/execute-plan-task/scripts/extract-plan-task.mjs P5-T2 --plan STABILITY_BLOG_UX_PLAN.md
```

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 19, Vite, TypeScript strict, Tailwind 4 | — |
| Editor state | Zustand | Four slices: document, UI, history, persistence |
| Canvas | Moveable | Eight resize handles, drag, one undo step per gesture |
| Validation | Zod, in `packages/shared` | One schema validates on both client and server |
| Backend | Node 22, Express 5 | `app.ts` separate from `server.ts` so tests bind no port |
| Database | MongoDB (official driver, no Mongoose) | Builder documents are naturally document-shaped |
| Auth | Better Auth + Organization plugin | Sessions and workspace membership |
| Images | Sharp | Server-side WebP conversion, responsive variants |
| Rich text | Tiptap | Validated structured JSON, never raw HTML |
| i18n | i18next | Typed namespaces, `pt-BR` and `en-US` |
| Tests | Vitest, Testing Library, Supertest, Playwright | 922 unit/integration + 14 E2E |

---

## Repository layout

```
packages/shared/    Contracts used by both other workspaces. No React, no Express, no database.
backend/            Express API and the public renderer. Two entrypoints, one image.
frontend/           React application, editor, preview and the shared renderer components.
```

`packages/shared` holds every type, Zod schema and pure function that both sides must agree on:
safe links, responsive values, the breakpoint resolver, SEO resolution, form validation, redirect
rules, search indexing and the accessibility audit. If a rule can be broken by disagreement between
client and server, it lives there.

Fuller map: `.claude/skills/project-runbook/references/architecture-map.md`.

---

## Running locally

Requires Node 22 (`.nvmrc`) and npm 10. MongoDB is optional — without it the app runs and health
reports `not_configured`; with it, projects persist.

```bash
git clone https://github.com/Gabrielleobeltrao/WebsiteBuilder.git
cd WebsiteBuilder
npm install          # once, from the repository root
cp .env.example .env # fill MONGODB_URI and BETTER_AUTH_SECRET to use the full app
npm run dev
```

`npm run dev` starts three processes and stops them together. Ready when all three answer:

| Process | Check |
|---|---|
| API | `curl -sf http://localhost:7411/api/v1/health` |
| Public renderer | `curl -sf http://localhost:7412/healthz` |
| Frontend | `curl -sf http://localhost:7410/` |

The ports are deliberately unusual. 3000, 3001 and 5173 are what most projects take, so on a machine
running more than one of them `npm run dev` collided with whatever was already there. Every one is
overridable through `API_PORT`, `PUBLIC_RENDERER_PORT` and `WEB_PORT`.

The renderer is only needed to open a *published* site on localhost. On a machine short on memory,
`npm run dev:light` starts the frontend and the API alone — the builder, the dashboards and the draft
preview all work without it. Two dev stacks and an editor on 8 GB is enough to leave the Vite server
paged out, where it listens but answers nothing and the browser shows a white screen.

Install once at the root. A nested `npm install` creates a second lockfile and is always wrong.

---

## Commands

```bash
npm run dev            # frontend + API + renderer
npm run dev:light      # frontend + API only, for a machine short on memory
npm run typecheck      # tsc --noEmit across every workspace
npm run test           # Vitest across every workspace
npm run build          # production build of every workspace
npm run test:e2e       # Playwright, against the production build
npm run check:runbook  # fails when the runbook drifts from package.json
```

Scope to one workspace with `-w`:

```bash
npm run test -w backend
npm run typecheck -w frontend
```

---

## Environment variables

Copy `.env.example`. Startup validates with Zod and fails fast naming the missing variable — never
its value.

**Required in production**

| Variable | Notes |
|---|---|
| `MONGODB_URI` | Connection string |
| `MONGODB_DB_NAME` | Database name |
| `BETTER_AUTH_SECRET` | At least 32 bytes: `openssl rand -base64 48` |
| `PLATFORM_ROOT_DOMAIN` | e.g. `websitebuilder.oneplataforma.com` |
| `PLATFORM_PUBLIC_ORIGIN` | e.g. `https://websitebuilder.oneplataforma.com` |

**Frontend**

Environment files live next to the service that reads them: `backend/.env.example` covers the API
and the renderer, `frontend/.env.example` covers the gateway. The root `.env` is still read first by
the development scripts, so an existing local file keeps working and `backend/.env` overrides it.

The frontend file is empty by design. The app uses no `VITE_*` variable at all, because the API base
path is a constant in the shared package — the browser talks to `/api/v1` on whatever host served
the page, so there is nothing to configure.

In production the separation is real regardless: each Coolify resource carries only its own
variables, and the API's secrets are never present on the frontend resource.

Should a public value ever be needed in the browser, it belongs in `frontend/.env` with a `VITE_`
prefix and nowhere else. Everything with that prefix is compiled into code every visitor downloads,
so a credential placed there is a published credential. `npm run test` reads the built bundle and
fails if a backend variable name or a connection string appears in it.

**Renderer**

`PUBLIC_RENDERER_HOST`, `PUBLIC_SITE_CACHE_TTL_SECONDS`, and `TRUSTED_PROXY_CIDRS`. Forwarded
headers are trusted from nothing until the last is set to the real proxy range.

---

## Architecture

### One origin for the application

Marketing, auth, dashboard, builder and API all live on `https://${PLATFORM_ROOT_DOMAIN}`. The
frontend gateway serves the SPA and proxies `/api/*` to the backend over the internal network. The
backend has **no public domain**.

This is why there is no CORS configuration in production and no cross-origin cookie problem: the
session cookie is same-origin because the API is same-origin.

One nginx rule carries most of the weight: `/api/` is proxied **before** the SPA fallback can see
it. If `index.html` were ever served for an API path, a backend outage would return `200` with HTML
and every client would parse a login page as JSON.

### A separate origin for published sites

The public renderer is its own service on its own hostname. Customer sites must not share a cookie
domain with the authenticated dashboard.

It resolves `hostname → active domain record → project → active published version`. A client-supplied
project ID is never accepted as routing authority, and an unknown host gets a neutral response
rather than another tenant's site.

### Draft and published are separate

Autosaved editor state never serves production traffic. Publishing compiles one exact revision into
an immutable snapshot, verifies it, then atomically swaps a pointer. A failed publish cannot alter
the live site, and rollback moves the pointer rather than rebuilding anything.

Blog templates work the same way: draft and published documents are separate fields, so editing a
template changes nothing live until it is published.

### Revisions, not last-write-wins

Every document save carries the revision it was loaded from. A stale write returns
`409 REVISION_CONFLICT` with the current revision, and the editor shows a blocking dialog stating
plainly that reloading discards local changes. Two concurrent saves leave exactly one winner.

---

## Security model

The rules below are enforced in code and asserted in tests, not merely intended.

**Tenant isolation.** Every business query is scoped by a server-verified `workspaceId` before any
resource ID is resolved. Membership is read from the database on each request — never inferred from
an active-workspace value the browser supplied. A non-member and a non-existent workspace get an
identical response, so membership cannot be probed. `backend/tests/tenant-isolation-audit.test.ts`
exercises every repository with a second workspace holding real data and asserts nothing leaks
through a read, a write, a byte stream or an aggregate.

**No arbitrary HTML, CSS or JavaScript.** User text renders as a text node. Rich text is validated
against an allowlist on the way in and walked into React elements on the way out — never injected as
markup. Responsive values are structured data serialised by one function that can only emit
allowlisted units.

**Links are typed data.** A user picks a kind and fills typed fields; no free-form href is accepted.
One shared utility turns that into an href, so `javascript:`, `data:` and friends have no path into
rendered output. A broken or unconfigured link renders as a non-navigating element rather than
silently pointing somewhere wrong.

**Uploads are decided by their bytes.** The declared content type and filename extension are
ignored. Variants are written before the metadata record, so no document can reference bytes that
are not there, and a partial upload is cleaned up completely.

**Public forms store only declared fields.** Anything else in the payload is discarded, so a form
cannot become an arbitrary write endpoint. CSV export neutralises every formula-leading character,
because a submitted value stays untrusted until someone opens it in Excel.

**Roles are evaluated server-side.** Nobody can grant a role above their own, and the last owner of
a workspace cannot be removed or demoted — a workspace with no owner is unrecoverable.

---

## Internationalisation

The interface ships in `pt-BR` and `en-US`. Locale resources are namespaced by feature and there is
**no language fallback**: a missing key fails a test rather than leaking English into a Portuguese
screen. Two checks run in CI — key parity between catalogues, and a scan for hardcoded user-facing
strings in components.

Locale precedence is deterministic: a saved account preference, then an explicit local choice, then
the browser, then `en-US`. Signing in from a differently configured browser never overwrites a
choice the user made.

Customer-authored website content is never translated. `SiteSeoSettings.locale` describes the
published site; the interface language is a user preference and the two are deliberately separate.

---

## Testing

```bash
npm run test      # 922 unit and integration tests
npm run test:e2e  # 14 Playwright tests, desktop and phone
```

Backend integration tests run against an ephemeral in-memory MongoDB, so they need no local
database and no shared state. Nothing in the suite contacts a real DNS, Cloudflare or Coolify API.

E2E runs against the production build, so what is tested is what ships.

---

## Deployment

One Coolify resource, three containers, one private network — not one resource per service. The
application serves the SPA and proxies `/api/*` to a backend with no public route at all; the
renderer has its own hostnames because it serves customer content and must not share an origin with
the authenticated dashboard.

Coolify shows a domain field per Compose service. The frontend takes
`https://websitebuilder.oneplataforma.com:8080` and the renderer
`https://origin.websitebuilder.oneplataforma.com:3001`; the backend's stays empty, which is what
keeps it private. Project subdomains are a Traefik label rather than a field, because that set is
open-ended — a Coolify application per customer site would mean a build, a container and a
certificate for each.

Everything an operator needs is in `docs/`:

| Document | Covers |
|---|---|
| [PRODUCTION_DEPLOYMENT.md](docs/PRODUCTION_DEPLOYMENT.md) | Coolify fields, environment, DNS, routing, first deploy |
| [CUSTOM_DOMAINS.md](docs/CUSTOM_DOMAINS.md) | Customer hostnames, Cloudflare for SaaS, routing safety |
| [RELEASE_AND_ROLLBACK.md](docs/RELEASE_AND_ROLLBACK.md) | Promotion, tags, rollback |
| [PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md) | The per-release list |
| [OPERATIONS.md](docs/OPERATIONS.md) | Backups, monitoring, incidents |
| [ANALYTICS.md](docs/ANALYTICS.md) | Turning measurement on, how it works, troubleshooting |
| [ANALYTICS_METRICS.md](docs/ANALYTICS_METRICS.md) | What every number means, and what is deliberately not measured |
| [ANALYTICS_PRIVACY.md](docs/ANALYTICS_PRIVACY.md) | What is collected, what never is, and what a visitor controls |
| [ANALYTICS_OPERATIONS.md](docs/ANALYTICS_OPERATIONS.md) | Budgets, storage formula, scale ceiling, rate limiting |
| [BLOG_PUBLICATION.md](docs/BLOG_PUBLICATION.md) | What each act of publishing changes, why a publish is refused, repairing old blogs, blog rollback |
| [FORMS.md](docs/FORMS.md) | What owns which part of a form, which definition each surface renders, lifecycle and tenancy |
| [BLOCK_LIBRARY.md](docs/BLOCK_LIBRARY.md) | How a block is defined, rendered, edited, migrated and published |

`npm run smoke:containers` builds the production images and exercises the running stack against a
throwaway database. It needs Docker and `SMOKE_MONGODB_URI`.

## Branch and release workflow

Two long-lived branches. Work integrates into `development`; `main` is what production deploys from.

`main` is advanced by fast-forward from `development`, and only when `npm run typecheck && npm run
test && npm run build && npm run test:e2e` all pass on the commit being promoted. A pull request is
not required — with one maintainer, a review they approve themselves is process rather than
protection, and the check suite is what actually catches things.

Never force-push `main` and never commit to it directly. A fast-forward only ever moves it to a
commit that already exists and was already tested on `development`, which is what makes every
promotion recoverable; those two operations are the ones that are not.

Short-lived `task/Px-Ty-description` branches are fine for isolated work and are deleted after
merge.

**Not yet configured:** `development` is not the repository default branch and `main` has no branch
protection, because both require an authenticated GitHub session with admin scope. Run
`gh auth login` and set them in repository settings — `IMPLEMENTATION_PLAN.md` P0-T5 and P19-T4.

---

## Known limitations

- The visual elements are part of the document and render on published pages, but the editor
  library does not yet offer a control for creating each one. They can be authored through the
  document, and adding the palette entries is mechanical.
- Branch protection on GitHub is not applied: it needs a maintainer session with admin rights.
  The exact ruleset and the residual risk are in [docs/OPERATIONS.md](docs/OPERATIONS.md).
- No Docker image has been built and no staging deploy or restore has been rehearsed from this
  machine. The manifests are written to the architecture and reviewed, nothing more.
- **Publishing is not implemented yet.** The contracts, audits and snapshot model exist; the
  publish pipeline, custom domains and the Cloudflare adapter are Phase 18.
- **The Docker images are unbuilt.** See the warning above.
- **Editing requires a desktop-class screen** and a precise pointer. Phones and tablets get a
  read-only preview by design, not by omission.
- **No analytics.** Dashboards show an explicit not-connected state rather than a zero, because a
  fabricated zero is indistinguishable from measured silence.
- **No payments.** Entitlements exist as a boundary with a single development plan.
- **Search is text search**, bounded and explainable. It is not semantic and does not claim to be.
- **Accessibility checks are automated checks.** They cover a fraction of WCAG and report
  judgement-dependent items for manual review. Nothing here certifies compliance.
- **SVG uploads are rejected.** Accepting them safely needs a sanitisation pipeline that does not
  exist yet.

---

## Licence

Unlicensed / private.
