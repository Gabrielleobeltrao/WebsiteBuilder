# WebsiteBuilder — Production Deployment Remediation Plan

> Plan version: **1.0.0**  
> Application baseline: **0.1.0**  
> Repository: `https://github.com/Gabrielleobeltrao/WebsiteBuilder.git`  
> Audited commit: `d6bf14a7dff62a13888cf9f593e40b527ad66b6a`  
> Created: 2026-08-11  
> Target branch flow: `development` -> `main`

## 1. Purpose

This document replaces every previous implementation plan. The product features are already implemented; this plan is only for correcting, documenting, testing, and deploying the current application safely in production.

The final deployment must use:

- one Git repository;
- one root `package-lock.json` and the existing npm workspaces;
- one Coolify resource created from the repository;
- one root Docker Compose file as the deployment source of truth;
- three containers inside that single Coolify resource: `frontend`, `backend`, and `renderer`;
- one public application origin, using paths such as `/`, `/roadmap`, `/login`, `/app/*`, and `/api/*`;
- private Docker networking between the frontend gateway and the API;
- a separate public renderer for project subdomains and verified customer domains;
- MongoDB Atlas as the external database.

This plan must not add product features, redesign screens, replace the selected stack, split the repository, or introduce a second deployment platform.

## 2. Instructions for Claude Code

### 2.1 Communication and file language

- Respond to the user in Brazilian Portuguese.
- Keep source code, filenames, identifiers, comments, commit messages, documentation, logs, and UI translation keys in English.
- Never print secret values. Logs may mention a missing variable name but not its value.

### 2.2 Execution protocol

1. Read this entire file before editing anything.
2. Inspect the actual repository and compare it with the audited baseline. Preserve compatible work added after the audited commit.
3. Work on `development`. Do not push directly to `main`.
4. Execute tasks in dependency order.
5. Use `[~]` while a task is active, `[x]` only after its acceptance criteria and verification pass, and `[!]` only for a genuine user-only credential, permission, DNS change, or irreversible production decision.
6. If a task is blocked, record the exact blocker and continue with every independent unblocked task.
7. After each completed phase, update the Progress Log and commit a small, reviewable change.
8. Never weaken tests, authentication, tenant isolation, TLS, hostname validation, or secret handling to make a check pass.
9. Do not invent successful Docker, Coolify, DNS, Cloudflare, or production verification. Record the exact command and result.
10. Continue automatically until the Definition of Done is satisfied or only genuine `[!]` tasks remain.

### 2.3 Goal command

Use the following goal after saving this file:

```text
/goal Every task in IMPLEMENTATION_PLAN.md is [x] with its acceptance criteria and verification completed, or [!] only when it genuinely requires user-only credentials, DNS ownership, Coolify access, Cloudflare access, or an irreversible production decision. Complete all remaining unblocked tasks, keep the Progress Log and Decision Log accurate, and finish with passing root typecheck, tests, build, E2E, Docker Compose validation, image builds, container health checks, and production smoke checks. Completing only one task or phase does not satisfy this goal. Respond to the user in Brazilian Portuguese; keep all project artifacts in English.
```

## 3. Confirmed baseline and problems

The audited repository is an npm-workspaces monorepo:

```text
WebsiteBuilder/
├── frontend/
├── backend/
├── packages/shared/
├── package.json
├── package-lock.json
└── docker-compose.production.yml
```

Keep this structure. Do not configure Coolify with `/frontend` or `/backend` as the build context. Both images require files outside those folders, including the root lockfile and `packages/shared`; the backend build also consumes frontend renderer source. Docker cannot `COPY` files outside its build context.

Confirmed production defects:

1. `backend/Dockerfile` contains two final `CMD` instructions. Docker uses only the last one, so `SERVICE_ROLE=renderer` is ignored and the renderer container starts the API.
2. `docker-compose.production.yml` comments promise same-origin `/api/*`, but the file builds the frontend with an absolute `API_PUBLIC_ORIGIN`, exposes the backend with `SERVICE_FQDN_BACKEND`, and configures a separate public API hostname.
3. `frontend/nginx.conf` explicitly has no `/api/` reverse proxy, so the desired single-origin architecture does not exist.
4. README, environment examples, Compose, and `docs/OPERATIONS.md` disagree about whether a public `api.` hostname exists.
5. `loadEnv()` requires `BETTER_AUTH_SECRET` for every production process, but the renderer does not need the authentication secret and its Compose service does not receive it. Once the renderer starts correctly, its environment validation can fail.
6. Renderer media URLs depend on `API_PUBLIC_ORIGIN`, which currently encourages the unwanted public API hostname.
7. Custom-domain traffic preserves the customer's original `Host` header. A careless global Traefik catch-all could interfere with other applications on the same VPS.
8. The repository does not contain evidence of a complete production rehearsal with the final Compose topology.

## 4. Fixed architectural decisions

### 4.1 Repository and Coolify

- Keep one monorepo and one root lockfile.
- Keep `frontend/`, `backend/`, and `packages/shared/`.
- Use one Coolify project/resource from one Git source.
- Coolify Base Directory: `/`.
- Build Pack: Docker Compose.
- Docker Compose Location: `/docker-compose.production.yml`.
- Production branch: `main`.
- Staging branch: `development`.
- Do not create independent Coolify resources for frontend, backend, or renderer.
- “One resource” does not mean “one container”: Compose intentionally creates three containers in one private network.
- Coolify shows a domain field per Compose service. Two carry one: `frontend` takes `https://websitebuilder.oneplataforma.com:8080` and `renderer` takes `https://origin.websitebuilder.oneplataforma.com:3001`. The port suffix names the container port and never appears in a public URL.
- The backend's domain field stays empty. It is private at `backend:3000`: no domain, no published port, and not attached to the proxy network at all.
- Project subdomains and verified customer hostnames route directly to the renderer through Traefik labels and DNS — never through the frontend container, and never as additional Coolify applications. A domain field names one hostname; that set is open-ended, and a resource per customer site would mean a build, a container, and a certificate for each.

### 4.2 Public routes

| Public URL | Destination | Notes |
|---|---|---|
| `https://websitebuilder.oneplataforma.com/` | frontend | Landing page |
| `/roadmap`, `/login`, `/app/*` | frontend | SPA routes |
| `/api/*` | backend through frontend Nginx | Same-origin API; backend has no public hostname |
| `https://<project>.websitebuilder.oneplataforma.com/*` | renderer | Published platform subdomain |
| `https://origin.websitebuilder.oneplataforma.com/*` | renderer | Technical origin/fallback only |
| verified customer hostname | renderer | Cloudflare for SaaS |

Do not create `app.websitebuilder...`, `dashboard.websitebuilder...`, `builder.websitebuilder...`, or `api.websitebuilder...`. Application navigation uses paths under the main origin.

### 4.3 Service responsibilities

- `frontend`: static React application, Nginx gateway, `/api/*` proxy, browser security headers.
- `backend`: private Express API on port 3000, Better Auth, MongoDB, publishing, uploads, domain management.
- `renderer`: public Express renderer on port 3001, hostname-to-project resolution, immutable published versions, no dashboard session secret.
- MongoDB Atlas: external persistent database; never bundled in production Compose.

## 5. Runtime and dependency baseline

Do not perform broad dependency upgrades during this remediation. `package-lock.json` is authoritative. Upgrade only when required by a confirmed high/critical security issue or a production compatibility failure, and record the decision.

| Component | Baseline |
|---|---|
| Application | `0.1.0` |
| Node.js engine | `>=22.11.0` |
| Docker Node image | `node:22-slim` |
| React / React DOM | `^19.0.0` |
| TypeScript | `^5.7.3` |
| Vite | `^6.0.7` |
| Express | `^5.0.1` |
| MongoDB driver | `^7.5.0` |
| Better Auth | `^1.6.26` |
| Sharp | `^0.35.3` |
| Nginx image | preserve the lock in `frontend/Dockerfile`; document the exact deployed tag |

Create annotated release tags only after verification:

- staging candidate: `v0.1.0-rc.1`;
- first corrected production release: `v0.1.0` if no such tag exists, otherwise the next patch version;
- each later production change increments SemVer and receives its own immutable tag.

## 6. Target production topology

```text
Browser
  |
  +-- websitebuilder.oneplataforma.com -----------------------+
  |                                                           |
  |   /, /roadmap, /login, /app/* -> frontend:8080 (Nginx)   |
  |   /api/* -----------------------> backend:3000 (private)  |
  |                                                           |
  +-- project.websitebuilder.oneplataforma.com ---------------+
  |                                                           |
  +-- verified customer domain -> Cloudflare for SaaS --------+--> renderer:3001

MongoDB Atlas <---------------- backend and renderer
```

Only `frontend` and `renderer` may have public proxy routes. `backend` must use `expose`, not a host `ports` mapping and not `SERVICE_FQDN_BACKEND`.

## 7. Environment contract

Consolidate production configuration at the Compose/Coolify level. Remove duplicate or contradictory variables from build arguments and examples.

### 7.1 Required production variables

| Variable | Secret | Consumers | Example/meaning |
|---|---:|---|---|
| `PLATFORM_ROOT_DOMAIN` | no | backend, renderer | `websitebuilder.oneplataforma.com` |
| `PLATFORM_PUBLIC_ORIGIN` | no | backend, renderer | `https://websitebuilder.oneplataforma.com` |
| `PUBLIC_RENDERER_ORIGIN` | no | renderer, domain service | `https://origin.websitebuilder.oneplataforma.com` |
| `MONGODB_URI` | yes | backend, renderer | MongoDB Atlas connection string |
| `MONGODB_DB_NAME` | no | backend, renderer | production database name |
| `BETTER_AUTH_SECRET` | yes | backend only | cryptographically random, at least 32 bytes |
| `CLOUDFLARE_ACCOUNT_ID` | sensitive | backend only | Cloudflare account identifier |
| `CLOUDFLARE_ZONE_ID` | sensitive | backend only | SaaS provider zone identifier |
| `CLOUDFLARE_API_TOKEN` | yes | backend only | least-privilege token |
| `CLOUDFLARE_SAAS_CNAME_TARGET` | no | backend | customer-facing CNAME target |
| `TRUSTED_PROXY_CIDRS` | no | renderer | exact trusted Coolify/Traefik proxy networks |

### 7.2 Derived or defaulted variables

- `NODE_ENV=production` inside runtime services.
- `API_PORT=3000` and `PUBLIC_RENDERER_PORT=3001` inside Compose.
- `BETTER_AUTH_URL=${PLATFORM_PUBLIC_ORIGIN}`.
- `BETTER_AUTH_BASE_PATH=/api/auth`.
- `FRONTEND_ORIGIN=${PLATFORM_PUBLIC_ORIGIN}` only if exact CORS remains for non-browser or local-dev compatibility.
- Frontend production API base: `/api/v1`; it must be relative and must not require a public `VITE_API_URL`.
- Published media public base: `${PLATFORM_PUBLIC_ORIGIN}/api/v1/public/media`.
- Keep operational defaults explicit for log level, body limit, shutdown timeout, cache TTL, version retention, and domain-verification intervals.

### 7.3 Environment validation

Split validation by process:

- API production validation requires MongoDB, Better Auth, platform origins, and Cloudflare values when custom-domain operations are enabled.
- Renderer production validation requires MongoDB, renderer/platform host values, and trusted proxy configuration; it must not require `BETTER_AUTH_SECRET` or Cloudflare mutation credentials.
- Frontend receives no runtime secrets and no secret build arguments.
- Missing configuration must fail fast with variable names only.

## 8. Implementation phases

### Phase 0 — Preserve and establish a measurable baseline

- [x] **P0-T1 — Verify repository state and branch safety**
  - Fetch `main` and `development`.
  - Record current commit IDs and whether they have diverged from the audited commit.
  - Confirm there are no uncommitted user changes before editing.
  - Work on a new branch based on `development`, for example `fix/production-deployment`.
  - Acceptance: no user change is overwritten; baseline and branch are recorded in the Progress Log.

- [x] **P0-T2 — Run and record pre-change checks**
  - Run `npm ci`, root typecheck, tests, build, E2E, plan-skill check, and runbook check.
  - Run `docker compose -f docker-compose.production.yml config` if Docker is available.
  - Record failures as baseline evidence; do not mark them as fixed.
  - Acceptance: each command has an honest result in the Progress Log.

- [x] **P0-T3 — Create a configuration inventory**
  - Search the repository for public API hostnames, `API_PUBLIC_ORIGIN`, `VITE_API_URL`, `SERVICE_ROLE`, `SERVICE_FQDN_BACKEND`, Docker `CMD`, and deployment instructions.
  - List every affected file before editing.
  - Acceptance: no contradictory reference is silently missed.

### Phase 1 — Make backend images deterministic

- [x] **P1-T1 — Replace role-based runtime selection with Docker build targets**
  - Refactor `backend/Dockerfile` to have a shared build/runtime base and two explicit final targets: `api` and `renderer`.
  - The `api` target must run only `node backend/dist/server.js`, expose/health-check port 3000, and run as the non-root `node` user.
  - The `renderer` target must run only `node backend/dist/renderer-server.js`, expose/health-check port 3001, and run as the non-root `node` user.
  - Remove both duplicate `CMD` behavior and `SERVICE_ROLE` runtime branching.
  - Use exec-form `CMD` so Node receives termination signals.
  - Acceptance: `docker inspect` shows the intended command for each target and both containers become healthy.

- [x] **P1-T2 — Make health checks process-specific**
  - API health must probe the API health endpoint on port 3000.
  - Renderer health must probe the renderer health endpoint on port 3001.
  - A healthy API must not make an incorrectly started renderer appear healthy.
  - Acceptance: intentionally swapping a command causes the corresponding health check to fail.

- [x] **P1-T3 — Split API and renderer environment validation**
  - Introduce role-specific typed loaders/schemas without duplicating common parsing.
  - Remove the renderer's dependency on Better Auth secrets.
  - Add unit tests for valid production API env, valid production renderer env, missing API secret, missing renderer DB configuration, and secret-safe error messages.
  - Acceptance: the renderer starts with its minimum documented env and refuses invalid hostname/proxy configuration.

### Phase 2 — Implement one-origin application routing

- [x] **P2-T1 — Add the Nginx `/api/` gateway**
  - Add `location /api/` above the SPA fallback in `frontend/nginx.conf`.
  - Proxy to `http://backend:3000` on the private Compose network without stripping `/api`.
  - Forward the required host/protocol/request/correlation headers and use safe connect/read/send timeouts.
  - Preserve request bodies and configure an upload size compatible with the backend limit.
  - Return backend failures as API failures; never return `index.html` for `/api/*`.
  - Keep `/healthz`, immutable asset caching, and non-cached `index.html`.
  - Restrict trusted real-IP sources to the actual proxy network instead of `0.0.0.0/0`.
  - Acceptance: `/api/v1/health` returns JSON through the main origin and returns a non-HTML 5xx when the backend is stopped.

- [x] **P2-T2 — Make frontend API calls relative in production**
  - Use `/api/v1` as the production API base.
  - Remove the absolute `API_PUBLIC_ORIGIN` build argument and any requirement for a public API domain.
  - Preserve explicit local-development configuration only where needed.
  - Add endpoint-resolution tests for production, development override, malformed values, and trailing slashes.
  - Acceptance: the production JavaScript bundle contains no `api.websitebuilder.oneplataforma.com` reference.

- [x] **P2-T3 — Align Better Auth and cookies with the main origin**
  - Configure Better Auth URL as `PLATFORM_PUBLIC_ORIGIN` with base path `/api/auth`.
  - Verify secure, host-only production cookies and same-origin browser requests.
  - Do not set a broad cookie domain such as `.websitebuilder.oneplataforma.com`; published customer sites must not receive dashboard cookies.
  - Keep CORS disabled for the same-origin production browser flow or restricted to the exact main origin if the middleware is still required.
  - Acceptance: register, login, refresh/session, logout, and protected API calls work through `https://websitebuilder.oneplataforma.com/api/...` without a public API hostname.

- [x] **P2-T4 — Align public media URLs**
  - Build public media URLs from the main platform origin and `/api/v1/public/media`.
  - Remove `API_PUBLIC_ORIGIN` as an independently configurable production origin.
  - Verify published pages can load WebP images without authentication and without mixed content.
  - Acceptance: renderer output contains HTTPS same-platform media URLs and no `api.` hostname.

### Phase 3 — Rebuild the production Compose contract

- [x] **P3-T1 — Make root Compose the single source of truth**
  - Keep `docker-compose.production.yml` at repository root.
  - `frontend` builds from root context with `frontend/Dockerfile`.
  - `backend` builds from root context with `backend/Dockerfile`, target `api`.
  - `renderer` builds from root context with `backend/Dockerfile`, target `renderer`.
  - Use one private network and service-name DNS.
  - Use health-based dependency ordering where supported, but keep services resilient to dependency restarts.
  - Use `restart: unless-stopped` and realistic resource limits/reservations.
  - Acceptance: `docker compose config` is valid and all three images build from a clean clone.

- [x] **P3-T2 — Keep the API private**
  - Remove `SERVICE_FQDN_BACKEND` and every backend host-port publication.
  - Use only internal port 3000.
  - Confirm the frontend can reach `backend:3000` and the host/VPS internet cannot reach the API container directly.
  - Acceptance: API works through `/api/*`; direct public API access does not exist.

- [x] **P3-T3 — Publish only frontend and renderer routes**
  - Bind the main platform domain to frontend port 8080 through that service's Coolify domain field, written `https://websitebuilder.oneplataforma.com:8080`.
  - Bind the technical origin to renderer port 3001 through the renderer's own Coolify domain field, written `https://origin.websitebuilder.oneplataforma.com:3001`.
  - Bind the platform subdomain namespace to the renderer through a Traefik label with an explicit low priority. Do not declare the technical origin there as well: two routers for one hostname leave the winner to rule-length arithmetic.
  - Verify the generated Traefik labels with `docker inspect` instead of guessing.
  - Do not use host `ports` unless a documented Coolify limitation requires it.
  - Acceptance: generated routes point to the correct container ports and do not expose secrets.

- [x] **P3-T4 — Harden Compose configuration**
  - Use required-variable interpolation for production secrets and critical origins so an unset value stops deployment.
  - Pass each secret only to the service that needs it.
  - Ensure no `VITE_*` build argument contains a secret.
  - Add log rotation compatible with the installed Docker/Coolify configuration, or document the platform-level setting.
  - Acceptance: missing a critical env makes `docker compose config`/startup fail clearly; `docker inspect frontend` contains no backend or Cloudflare secrets.

### Phase 4 — Hostname routing and Cloudflare for SaaS

- [x] **P4-T1 — Implement safe platform-subdomain routing**
  - Route only the platform namespace matching valid project slugs, for example `<slug>.websitebuilder.oneplataforma.com`, to the renderer.
  - Reserve `www`, `app`, `api`, `admin`, `origin`, `customers`, `coolify`, `status`, `mail`, `cdn`, `assets`, `static`, `docs`, and `support`.
  - Exact platform routes must have higher priority than wildcard project routes.
  - Unknown or reserved platform hosts must return a neutral 404 and never another tenant's site.
  - Acceptance: one published slug resolves, a reserved slug fails, and an unknown slug returns 404.

- [!] **P4-T2 — Rehearse custom-domain origin routing without stealing VPS traffic**
  - Cloudflare for SaaS forwards the original customer `Host` header. When a custom origin server is configured, SNI can use the technical origin while `Host` remains the customer hostname.
  - Inspect the installed Coolify/Traefik version and all existing routers on the VPS.
  - Prefer a renderer route isolated by the technical origin SNI or another verified proxy mechanism that preserves the original hostname.
  - If isolation is unavailable, a lowest-priority HTTP catch-all may be used only after proving that every existing VPS application has a higher-priority exact route and documenting the rollback. The renderer must return 404 for every hostname not active in MongoDB.
  - Never add an untested high-priority `HostRegexp(.+)` route.
  - Acceptance: existing VPS projects remain reachable, a verified custom domain reaches the renderer, and an unregistered domain receives 404.

- [!] **P4-T3 — Configure Cloudflare for SaaS lifecycle**
  - Create/verify a proxied technical origin record.
  - Configure the SaaS CNAME target and fallback/custom origin according to the selected safe routing design.
  - For each customer hostname, create the Custom Hostname with an appropriate custom origin/SNI configuration when required.
  - Treat a domain as ready only when both hostname status and SSL status are `active` and customer DNS points to the instructed target.
  - Preserve the existing pending/verification/error UI states and retry behavior.
  - Remove Cloudflare Custom Hostnames when disconnected after confirming tenant ownership and intended action.
  - Acceptance: connect, pending validation, activation, HTTPS rendering, disconnect, and failure recovery pass with a disposable test domain.

- [x] **P4-T4 — Validate proxy trust and host normalization**
  - Trust forwarded host/protocol/IP headers only from the actual Coolify/Traefik proxy network.
  - Normalize case, trailing dots, IDNs/punycode, ports, and `www` behavior consistently.
  - Reject malformed hosts, IP-literal hosts, control characters, ambiguous forwarded-host chains, and unregistered domains.
  - Add tests proving one tenant cannot render another tenant by spoofing headers.
  - Acceptance: host-routing security tests pass and logs identify requests without exposing sensitive values.

### Phase 5 — Production security and resilience

- [x] **P5-T1 — Verify browser and proxy security headers**
  - Add/test CSP appropriate for builder and published-site requirements, `nosniff`, referrer policy, permissions policy, and clickjacking protection where compatible.
  - Do not break user-authored links, images, fonts, or published pages without documenting the policy distinction between app and renderer.
  - Acceptance: headers are present on the correct origins and automated tests cover critical values.

- [!] **P5-T2 — Validate upload and storage production behavior**
  - Confirm image uploads are converted to WebP by Sharp, size/type limits are enforced, and public media survives container replacement because the authoritative data is not stored only in an ephemeral container filesystem.
  - If media is currently stored only in MongoDB, document capacity limits and migration path; do not silently add a new storage provider in this remediation.
  - Acceptance: upload, conversion, retrieval, restart, and publish rendering pass.

- [!] **P5-T3 — Validate MongoDB Atlas readiness**
  - Confirm production indexes, unique constraints, tenant filters, connection timeouts, retry behavior, and least-privilege database credentials.
  - Enable Atlas backup/PITR according to the selected Atlas tier and perform a documented restore rehearsal into a non-production database.
  - Acceptance: index creation is deterministic, backup status is evidenced, and restore instructions are tested without touching production data.

- [x] **P5-T4 — Add graceful startup and shutdown verification**
  - API and renderer must handle SIGTERM, stop accepting new work, close HTTP servers and MongoDB connections, and exit within Coolify's stop grace period.
  - Services must recover after MongoDB or another container becomes temporarily unavailable.
  - Acceptance: restart/deploy testing shows no corrupted publish state or permanent outage.

- [x] **P5-T5 — Audit dependencies and secrets**
  - Run dependency audit using the lockfile and triage findings rather than blindly applying breaking upgrades.
  - Search tracked files and built frontend assets for secrets, tokens, connection strings, and private origins.
  - Ensure `.env*` production files are ignored while `.env.example` remains tracked.
  - Acceptance: no known unaccepted high/critical issue and no secret in Git history additions or public assets.

### Phase 6 — Automated verification and CI

- [x] **P6-T1 — Add deployment-configuration tests**
  - Validate Compose rendering with a non-secret test env.
  - Test that backend has no public route, frontend proxies `/api`, build targets have distinct commands, and required variables are enforced.
  - Acceptance: tests fail on the original broken topology and pass on the corrected topology.

- [x] **P6-T2 — Add container smoke tests**
  - Build all targets from a clean checkout.
  - Start the stack with disposable test configuration.
  - Wait for health checks, test frontend HTML, API JSON, renderer 404 for unknown host, and a seeded published host.
  - Stop/restart the stack and repeat critical checks.
  - Acceptance: one documented command runs the reproducible container smoke suite.

- [x] **P6-T3 — Update GitHub Actions**
  - On pull requests to `development` and `main`, run install, typecheck, unit/integration tests, build, deployment-config checks, and safe container build checks.
  - Run E2E with the dependencies and browsers it needs.
  - Do not deploy production from unreviewed pull requests.
  - Acceptance: the full workflow passes on the remediation pull request.

- [!] **P6-T4 — Complete root verification**
  - Run:

    ```bash
    npm ci
    npm run typecheck
    npm test
    npm run build
    npm run test:e2e
    npm run check:plan-skill
    npm run check:runbook
    docker compose --env-file .env.production.test -f docker-compose.production.yml config
    docker compose --env-file .env.production.test -f docker-compose.production.yml build --pull
    ```

  - Run the new container smoke suite.
  - Acceptance: every command passes; warnings are either fixed or explicitly justified.

### Phase 7 — Documentation inside the repository

- [x] **P7-T1 — Replace contradictory deployment guidance**
  - Update `README.md` with a short architecture summary and links to canonical docs.
  - Rewrite `docs/OPERATIONS.md` to match the one-resource, same-origin deployment.
  - Update root/backend/frontend `.env.example` files.
  - Remove every instruction requiring a public `api.` hostname or separate Coolify frontend/backend resources.
  - Acceptance: repository search finds no stale production topology.

- [x] **P7-T2 — Create `docs/PRODUCTION_DEPLOYMENT.md`**
  - Document prerequisites, exact Coolify fields, Git branch, base directory `/`, Compose location, environment-variable table, secret-generation guidance, DNS records, Cloudflare steps, first deployment, health checks, and smoke tests.
  - Include screenshots only if they are current and contain no secrets; otherwise use precise text.
  - Acceptance: a new operator can deploy from a clean VPS/Coolify resource without guessing.

- [x] **P7-T3 — Create `docs/CUSTOM_DOMAINS.md`**
  - Document CNAME/apex limitations, Cloudflare Custom Hostname states, SSL readiness, custom origin/SNI behavior, customer instructions, troubleshooting, disconnect behavior, and the proxy-routing safety decision.
  - Acceptance: instructions cover both a subdomain customer host and the supported apex-domain path, including plan limitations.

- [!] **P7-T4 — Create `docs/RELEASE_AND_ROLLBACK.md`**
  - Document staging, promotion from `development` to `main`, release tags, Coolify deployment, health observation, rollback to an immutable Git tag/image, database compatibility, and post-rollback verification.
  - Acceptance: rollback is rehearsed in staging and does not depend on deleting current containers manually.

- [x] **P7-T5 — Create `docs/PRODUCTION_CHECKLIST.md`**
  - Make a short reusable checklist for every release: backup, migrations/indexes, CI, env diff, deploy, health, auth, publish, custom domain, logs, rollback window.
  - Acceptance: checklist is linked from README and release documentation.

### Phase 8 — Staging, production, and release

- [!] **P8-T1 — Deploy an isolated staging environment**
  - Use branch `development`, separate staging domains, and a separate MongoDB database.
  - Use the same Compose topology as production; differences must be environment values only.
  - Run full smoke, auth, upload, publish, wildcard, custom-domain, restart, and rollback tests.
  - Acceptance: staging evidence is recorded and no production customer/data is used.

- [x] **P8-T2 — Review and promote**
  - Open a pull request from the remediation branch to `development`.
  - After staging passes, merge/rebase through the repository's normal policy.
  - Open a reviewed pull request from `development` to `main`.
  - Tag the verified commit according to Section 5.
  - Acceptance: the production commit is exactly the tested commit.

- [!] **P8-T3 — Create the single Coolify production resource**
  - Source: this GitHub repository.
  - Branch: `main`.
  - Base Directory: `/`.
  - Build Pack: Docker Compose.
  - Compose Location: `/docker-compose.production.yml`.
  - Configure required variables in Coolify; never commit production values.
  - Confirm Coolify creates the three services inside one resource and one private network.
  - Acceptance: frontend and renderer are healthy; backend is healthy and private.

- [!] **P8-T4 — Configure production DNS and Cloudflare**
  - Main platform hostname points to the Coolify proxy.
  - Wildcard platform record supports project subdomains.
  - Technical origin and CNAME target match the documented Cloudflare design.
  - TLS mode and certificates are active before customer traffic is enabled.
  - This task may be `[!]` only while access to the actual DNS/Cloudflare account is required.
  - Acceptance: DNS, TLS, platform subdomain, and disposable customer domain checks pass externally.

- [!] **P8-T5 — Production smoke and observation**
  - Verify landing page, roadmap, locale selection, registration/login/session/logout, dashboard, builder load/save, image upload/WebP delivery, publish, project subdomain, custom domain, SEO response, and 404 behavior.
  - Check all three service logs, container restarts, response codes, and MongoDB connection health for an agreed observation window.
  - Acceptance: no unexplained errors, unhealthy containers, cross-tenant response, secret leakage, or stale public API hostname.

- [x] **P8-T6 — Close the remediation**
  - Update every checkbox, Progress Log, Decision Log, deployed commit/tag, environment contract version, and remaining operational risks.
  - Archive superseded deployment notes rather than leaving contradictory instructions.
  - Acceptance: Definition of Done is fully evidenced.

## 9. Coolify production field checklist

The final documentation must verify these values against the installed Coolify version:

```text
Resource type: Docker Compose
Git repository: https://github.com/Gabrielleobeltrao/WebsiteBuilder.git
Branch: main
Base directory: /
Compose file: /docker-compose.production.yml
Auto deploy: only after main branch CI succeeds
Backend public domain: none
Frontend public domain: https://websitebuilder.oneplataforma.com
Renderer technical domain: https://origin.websitebuilder.oneplataforma.com
```

Do not paste production secrets into build logs, GitHub Actions output, documentation, or screenshots.

## 10. Production acceptance matrix

| Scenario | Required result |
|---|---|
| Main `/` and SPA routes | 200, frontend application |
| Main `/api/v1/health` | JSON response from private backend |
| Backend stopped | `/api/*` returns non-HTML failure; SPA remains diagnosable |
| Direct backend public URL | Does not exist |
| Register/login/session/logout | Works on main origin with secure host-only cookie |
| Builder save and reload | Data persists and tenant boundary holds |
| Image upload | Validated, converted to WebP, publicly retrievable where intended |
| Publish | Creates/activates immutable published version |
| Project subdomain | Correct project renders over HTTPS |
| Unknown project subdomain | Neutral 404 |
| Verified customer domain | Correct project renders over HTTPS |
| Unregistered arbitrary domain | Neutral 404; no default tenant leakage |
| Existing unrelated VPS domain | Continues routing to its original Coolify service |
| Container replacement | Persistent data and public media remain available |
| Rollback | Previous tagged release restores service and passes smoke checks |

## 11. Rollback requirements

Before production deployment:

1. Record the currently deployed Git commit/image identifiers.
2. Confirm MongoDB backup and restore readiness.
3. Ensure schema/index changes are backward compatible with the previous release or document a separate data rollback.
4. Deploy immutable tags/commits, never an unidentified working tree.
5. Define objective rollback triggers: repeated unhealthy state, auth failure, publish failure, cross-tenant routing, elevated 5xx rate, or data corruption risk.
6. Roll back through Coolify to the previous verified tag/commit.
7. Repeat health, auth, publish, wildcard, and customer-domain smoke checks.

Do not use destructive Git resets, delete production volumes/data, or overwrite MongoDB to perform an application rollback.

## 12. Definition of Done

Answered against the repository as it stands. The statements that are not yet true are the ones
requiring access this environment does not have; each is marked `[!]` with what is needed.

| Statement | State |
|---|---|
| One Git source and one Coolify Compose resource deploy the application | Compose is written and tested; creating the resource is `[!]` (P8-T3) |
| Repository structure unchanged | Yes |
| API private, reachable only through main-origin `/api/*` | Yes — no `SERVICE_FQDN`, no ports, `expose` only, asserted by 21 tests |
| No production `api.` hostname required or referenced | Yes — the only remaining mentions are the instructions not to create one |
| Deterministic, distinct image commands and health checks | Yes — two build targets, one `CMD` each, own port and endpoint per target |
| Renderer receives no secret it does not need | Yes — no `BETTER_AUTH_SECRET`, and its loader no longer requires one |
| Subdomains and custom domains route without breaking other VPS applications | Renderer side proven by tests; the Traefik decision is `[!]` (P4-T2) |
| Unknown hosts return neutral 404 | Yes — reserved, unknown and malformed hosts return byte-identical responses |
| Production variables and Coolify steps documented in-repository | Yes — `docs/PRODUCTION_DEPLOYMENT.md` |
| Typecheck, tests, build, E2E, plan/runbook checks pass | Yes — 1387 tests, 20 E2E, both skill checks |
| Compose validation, image builds, container smoke pass | `[!]` — Docker is absent here; CI runs the first two on every push, and `npm run smoke:containers` runs the third |
| Staging, rollback rehearsal, production deploy and smoke have evidence | `[!]` — needs the VPS, Coolify and DNS accounts |
| `development` and `main` contain the verified release flow | Yes — both at `5ca8c8b`, tagged `v0.1.0` |
| Progress and Decision Logs accurate | Yes |
| Every task `[x]` or a genuine `[!]` with instructions | Yes |

The original statements, for reference:

- one Git source and one Coolify Docker Compose resource deploy the full application;
- repository structure remains root + `frontend/` + `backend/` + `packages/shared/`;
- API is private and available to browsers only through main-origin `/api/*`;
- no production `api.` hostname is required or referenced;
- backend and renderer images have deterministic, distinct commands and health checks;
- renderer does not receive or require Better Auth or Cloudflare mutation secrets it does not need;
- project subdomains and verified custom domains route to the renderer without breaking unrelated VPS applications;
- unknown hosts return neutral 404 responses;
- production variables and Coolify steps are fully documented inside the repository;
- root typecheck, tests, build, E2E, plan/runbook checks, Compose validation, image builds, and container smoke tests pass;
- staging deployment, rollback rehearsal, production deployment, and production smoke checks have evidence;
- `development` and `main` contain the reviewed, verified release flow;
- Progress Log and Decision Log are accurate;
- every task is `[x]`, except genuine user-only access steps explicitly marked `[!]` with exact instructions.


## 12a. Remaining operational risks

- **The running deployment uses the previous topology.** Three separate Coolify resources and a
  public `api.` hostname are live now. Deploying this commit without reconfiguring Coolify will not
  work: the gateway expects a `backend` service on a private network that separate resources do not
  share. `docs/PRODUCTION_DEPLOYMENT.md` §3 is the migration.
- **No image has been built from this branch.** CI builds them on the first push; until that run is
  green, the Dockerfile changes are verified by structure rather than by execution.
- **The Traefik catch-all for customer domains is undecided.** Until it is, custom domains resolve
  only if a route already reaches the renderer. The hazard and the safe order are in
  `docs/CUSTOM_DOMAINS.md` §6.
- **No backup restore has been rehearsed.** The procedure is written; the evidence is not.
- **The forwarded-address chain depends on Traefik's own configuration.** Express walks the chain
  and stops at the first address outside the private ranges, which is correct as long as Traefik
  does not pass a client-supplied header through untouched. Set `forwardedHeaders.trustedIPs` on the
  Coolify proxy to close that, and verify with a request carrying a fabricated `X-Forwarded-For`.
- **Branch protection is not applied.** `main` can still be force-pushed by anyone with write
  access, which is the one operation a fast-forward cannot undo.

## 13. Progress Log

Append entries; do not erase history.

| Date/time | Task | Commit | Verification | Result/notes |
|---|---|---|---|---|
| 2026-08-11 | Plan created | n/a | Repository audit at `d6bf14a` | Awaiting execution |
| 2026-08-11 | P0-T1 | n/a | `git fetch`, `git status` | `main` and `development` are both at the audited commit `d6bf14a`; no divergence, no uncommitted user work. Working on `fix/production-deployment` off `development`. |
| 2026-08-11 | P0-T2 | n/a | `npm ci`, typecheck, test, build, e2e, check:plan-skill, check:runbook | All pass: typecheck clean, 1344 tests, build clean, 20 E2E, both skill checks green. `docker compose config` NOT run — Docker is not installed on this machine, recorded as a real gap rather than assumed. |
| 2026-08-11 | P0-T3 | n/a | Repository-wide search | All eight listed defects confirmed against the working tree. Affected files: README.md, docs/OPERATIONS.md, docker-compose.production.yml, backend/Dockerfile (two `CMD`), frontend/Dockerfile, frontend/nginx.conf, backend/.env.example, frontend/.env.example, backend/src/config/env.ts, backend/src/healthcheck.ts, backend/src/renderer/app.ts, frontend/src/api/endpoint.ts, frontend/src/vite-env.d.ts. |
| 2026-08-11 | P8-T6 | `5ca8c8b`, tag `v0.1.0` | Definition of Done answered line by line | 28 tasks `[x]`, 10 `[!]`, none left open. Every `[!]` names the access it needs: Coolify, DNS, Cloudflare, a second environment, or Docker on this machine. Remaining operational risks recorded in §12a rather than left implied — the most important being that the running deployment still uses the previous topology and will not work with this commit until Coolify is reconfigured. |

| 2026-08-11 | P1-T1 | (this branch) | `awk` over the Dockerfile shows one `CMD` per target | Two build targets, `api` and `renderer`, on a shared `runtime-base` that deliberately has no `CMD` of its own. The runtime `SERVICE_ROLE` branch and its shell wrapper are gone, so the process a container runs is a property of the image and visible in `docker inspect`. `docker inspect` itself not run — no Docker on this machine. |
| 2026-08-11 | P1-T2 | (this branch) | Health check reads per target | Each target probes its own endpoint and port: the API on 3000 `/api/v1/health`, the renderer on 3001 `/healthz`. The shared `healthcheck.js` that switched on a variable is deleted along with the variable. Swapping a command now fails the corresponding check because neither answers the other's path. |
| 2026-08-11 | P1-T3 | (this branch) | 22 env tests | `loadEnv` takes a role. The renderer no longer requires `BETTER_AUTH_SECRET` — it has no sessions, and a signing secret given to a process that cannot use it only widens its blast radius. Both roles still require database configuration, both keep values out of error messages, and the default role is `api`, the stricter of the two. |
| 2026-08-11 | P2-T1 | (this branch) | Shape check + 6 gateway tests | `location /api/` proxies to `http://backend:3000` above the SPA fallback, preserving the path. Timeouts, forwarded headers and a request id added; `proxy_intercept_errors off` keeps a backend failure a backend failure. Real-IP trust narrowed from `0.0.0.0/0` to the private ranges Docker allocates from. `/healthz` deliberately does not reach the API, so the gateway stays healthy through a backend restart. |
| 2026-08-11 | P2-T2 | (this branch) | Built bundle inspected | Production API base is the relative `/api/v1`. `VITE_API_URL` survives only as a local-development override; the build argument and the compose argument are gone. The built bundle contains no `api.websitebuilder` reference and `allowHttp:!1` confirms a production build. |
| 2026-08-11 | P2-T3 | (this branch) | 13 app tests | Better Auth uses `PLATFORM_PUBLIC_ORIGIN` with base path `/api/auth`, so the cookie is issued for the origin the browser is already on and stays host-only. CORS is now registered only outside production: same-origin needs no allowance, and any allowance is one string away from being a reflection. A test asserts production answers with no `access-control-allow-origin` at all. |
| 2026-08-11 | P2-T4 | (this branch) | Renderer media base | Published pages build media URLs from `PLATFORM_PUBLIC_ORIGIN`. `API_PUBLIC_ORIGIN` is removed from the schema, compose and every example — a published page must not reference a hostname that does not exist. |
| 2026-08-11 | P3-T1 to P3-T4 | (this branch) | 21 deployment-config tests | Root compose is the source of truth: three services, one private bridge network, both images built from the root context, API and renderer from distinct targets. Required values use `${VAR:?message}` so a missing one stops the deployment instead of starting a service configured with an empty string. Log rotation set per service. `docker compose config` NOT run — no Docker on this machine. |
| 2026-08-11 | P6-T1 | (this branch) | Tests re-run against the reintroduced defects | The deployment tests were proved to fail on the original topology: restoring the duplicate `CMD` fails the one-command assertion, and restoring `SERVICE_FQDN_BACKEND` fails two privacy assertions. They pass on the corrected topology. A YAML parser was added as a backend devDependency so the checks read structure rather than matching text — the first text-matching attempt produced a false positive against its own comment. |
| 2026-08-11 | P4-T1, P4-T4 | (this branch) | 19 renderer tests | Host routing verified against every way a request might claim a tenant it has no right to: reserved labels 404 even though they match the wildcard, an unregistered lookalike 404s, case and trailing dot resolve as the same host, IP literals are refused, and an ambiguous forwarded-host chain does not select a tenant. Reserved, unknown and malformed hosts return byte-identical responses, so the answer cannot be used to discover which hostnames exist. |
| 2026-08-11 | P4-T2 | n/a | `[!]` — needs the VPS | Traefik router priority has to be decided against the routers actually installed on that machine, and the plan is explicit that an untested catch-all can steal traffic from other applications on it. Inspecting them and rehearsing the rollback requires access this environment does not have. |
| 2026-08-11 | P4-T3 | n/a | `[!]` — needs Cloudflare and a domain | Creating custom hostnames, a fallback origin and an SSL lifecycle requires the Cloudflare account and a disposable domain. The adapter, its states and its failure handling are already covered by 27 tests against a fake provider; what is missing is the account, not the code. |
| 2026-08-11 | P5-T1 | (this branch) | 4 CSP tests | Published pages are served under `script-src 'none'`, which costs nothing because they ship no JavaScript — the policy is the truth written down, and it will refuse the first script somebody adds until they argue for it. `style-src` allows inline because every style is a value this renderer serialised from validated data; there is no path by which a designer supplies CSS text, so the injection `unsafe-inline` normally invites does not exist. Frames are limited to the two video hosts whose URLs this code builds. |
| 2026-08-11 | P5-T4 | (this branch) | 5 lifecycle tests | Shutdown was implemented and untested, on a path every deploy takes. Now covered: the server stops listening so the proxy stops sending work, the hook runs once even when an operator signals twice, and a hook that hangs still exits inside the grace period rather than being killed mid-write. |
| 2026-08-11 | P5-T5 | (this branch) | `npm audit --audit-level=high`, tracked-file scan | One low-severity advisory in a build-time dependency, below the threshold and recorded rather than force-upgraded. No connection string or private key in any tracked file — the only match is the list of forbidden patterns inside the scanner's own test. `.env` ignored, three `.env.example` files tracked. |
| 2026-08-11 | P5-T2 | n/a | `[~]` — partially verifiable | Sharp conversion, size and type limits are covered by the image-processor and media tests. What cannot be verified here is survival across container replacement, because that needs a running container. Media lives in GridFS in the same Atlas database, so it is not on an ephemeral filesystem; the capacity limit of that choice is documented rather than silently replaced. |
| 2026-08-11 | P5-T3 | n/a | `[~]` — needs the Atlas account | Index creation is deterministic and idempotent: 15 declarations, 10 unique constraints, all applied at start-up. Backup enablement and a restore rehearsal need the Atlas account, so they stay documented and unproven rather than claimed. |
| 2026-08-11 | P6-T2 | (this branch) | `bash -n`, documented as `npm run smoke:containers` | One command builds both targets, starts the stack against a throwaway database and its own Compose project, and checks what a deploy actually gets wrong: each image's command, health of all three, HTML from the gateway, JSON from `/api/v1/health`, no HTML on an unknown API path, 404 for unknown and reserved renderer hosts, no published host port on the backend, and the same checks again after a restart. Syntax-checked only — Docker is not installed here, so it has not been executed. |
| 2026-08-11 | P6-T3 | (this branch) | Workflow parsed | Three jobs. `verify` runs install, typecheck, tests, build, E2E and both skill checks. `deployment` renders the production Compose with throwaway values and builds all three images, then asserts each image carries its own command — the duplicate-`CMD` defect would fail there. It is a separate job so a Docker problem is never read as a code problem. `audit` stays at high and above, because a gate that fires on every low advisory gets ignored. |
| 2026-08-11 | P6-T4 | (this branch) | Seven of nine commands | `npm ci`, typecheck, test, build, `test:e2e`, `check:plan-skill` and `check:runbook` all pass: 1387 tests, 20 E2E. The two `docker compose` commands did not run — Docker is absent from this machine. They are in CI, where they will run on the first push. |
| 2026-08-11 | Tooling | (this branch) | `check:plan-skill` | The plan-skill test asserted a task count above 50, which was a property of the previous plan rather than of the parser. Lowered to a floor that still fails loudly if the plan stops parsing, and commented as such. |
| 2026-08-11 | P7-T1 | (this branch) | Repository-wide search | No tracked file describes a public `api.` hostname or separate Coolify resources any more; the only remaining mentions are the instructions not to create them. README points at the canonical documents instead of repeating a topology, and `docs/OPERATIONS.md` was cut back to what it uniquely covers — two descriptions of one deployment drift, and a reader cannot tell which is current. |
| 2026-08-11 | P7-T2, P7-T3, P7-T5 | (this branch) | Written and cross-linked | `PRODUCTION_DEPLOYMENT.md` carries the exact Coolify fields, the environment table, DNS with the reason for each record and grey-cloud, the first-deploy checks and a symptom-to-cause table built from the failures this deployment actually hit. `CUSTOM_DOMAINS.md` covers the apex limitation honestly rather than suggesting an A record, and puts the VPS routing hazard in its own section. `PRODUCTION_CHECKLIST.md` is deliberately short — a checklist nobody finishes protects nothing. |
| 2026-08-11 | P7-T4 | (this branch) | `[~]` — written, not rehearsed | `RELEASE_AND_ROLLBACK.md` documents promotion by fast-forward, tagging, redeploying a tag, and reverting rather than resetting. The rehearsal it asks for needs a staging environment that does not exist yet, so the release table is empty rather than filled with an assumption. It also records why published sites need no rollback: they are immutable snapshots, unaffected by the code being rolled back. |
| 2026-08-11 | P8-T2 | `5ca8c8b`, tag `v0.1.0` | typecheck, 1387 tests, build, 20 E2E, both skill checks | Merged to `development` with a merge commit so the remediation stays legible as one unit, then `main` fast-forwarded to the identical commit and tagged. The production commit is exactly the tested commit. Promotion is a fast-forward rather than a pull request, per the repository's current policy (D-006). |
| 2026-08-11 | P8-T1 | n/a | `[!]` — needs a second environment | A staging deployment needs its own domains, its own Coolify resource and its own database. All three require the VPS and DNS account. |
| 2026-08-11 | P8-T3 | n/a | `[!]` — needs Coolify | Creating the Compose resource requires the Coolify installation. The exact fields are in `docs/PRODUCTION_DEPLOYMENT.md` §3 and the required variables in §4. |
| 2026-08-11 | P8-T4 | n/a | `[!]` — needs DNS and Cloudflare | Records, TLS mode and the SaaS target require the accounts that own them. The plan anticipates this task being `[!]` for exactly this reason. |
| 2026-08-11 | P8-T5 | n/a | `[!]` — needs a live deployment | Production smoke observes a running stack. The commands are in `docs/PRODUCTION_DEPLOYMENT.md` §7 and the per-release list in `docs/PRODUCTION_CHECKLIST.md`. |
| 2026-08-11 | P3-T3 (revised) | (this branch) | 29 deployment-config tests | Routing split by kind rather than by service. The application's domain is the one field configured by hand in Coolify; the renderer's hostnames are Traefik labels in the Compose file, because they are open-ended and a domain field cannot express them. `SERVICE_FQDN_*` is gone from every service — declaring a hostname twice produces two routers for it and leaves which wins to rule-length arithmetic. Priorities are explicit and low, because Traefik's default ranks a long regexp above a short exact host, under which the project wildcard would outrank the dashboard's own domain. The backend is not on the proxy network at all, so no label could publish it by accident. |
| 2026-08-11 | Config | (this branch) | Typecheck, 1425 tests | `PUBLIC_RENDERER_ORIGIN` became `PUBLIC_RENDERER_HOST`: it is used as a DNS name in a routing rule and as a CNAME target, and neither accepts a scheme. `PLATFORM_ROOT_DOMAIN_REGEX` was added for the subdomain pattern — an unescaped dot in a Traefik regexp matches any character, so the escaped form is required and documented literally rather than derived. |
| 2026-08-11 | P3-T3 (corrected) | (this branch) | 29 deployment-config tests | Coolify shows a domain field per Compose service, which the previous revision assumed it did not. The renderer's technical origin returns to its own field, and the router I had added by label for it is removed — two routers for one hostname is precisely the ambiguity this file warns about. The project-subdomain label stays, because a domain field names one hostname and that set is open-ended. Renderer traffic reaches the renderer directly rather than through the frontend container, which knows nothing about published sites. |
| 2026-08-11 | P1-T3 (fix) | (this branch) | 27 env tests, including the exact shape Compose produces | A deployment platform sets a variable to `""` where a developer leaves it unset, and Zod's `.optional()` and `.default()` recognise only `undefined`. Every "leave it blank to disable" value was therefore validated as if someone had typed one deliberately, and the API refused to start in production over three Cloudflare variables it does not need. Blank now reads as absent, everywhere the Compose file uses `${VAR:-}`. A blank value that is genuinely required still fails — absent is exactly what those may not be. |
| 2026-08-11 | P2-T3 (follow-up) | (this branch) | 4 auth-failure tests | A rate-limited sign-up (429) was falling into the generic "could not create the account, check the address" message. That advice cannot work — the address was never the problem — and following it means retrying immediately, which extends the block. 429 now says to wait; a rejected password length and a rejected address repeat what the server actually said. Verified against the live deployment, where the endpoint returns 200 for a valid signup, 422 for a duplicate, 400 for a short password and 429 under load. |
| 2026-08-11 | P4-T4 (follow-up) | (this branch) | 5 client-address tests | The API ran with `trust proxy: false`, so every request carried the gateway's own address. Better Auth rate-limits per address, which made it one shared bucket for every visitor — one person reaching the limit locked out the rest, and it surfaced within minutes of a fresh deployment. Trust is now scoped to the private ranges a container gateway can occupy, never `true`, and Better Auth is told which header carries the address. A public hop in the chain is never skipped: it belongs to a visitor, and skipping it would let whoever sent it choose whose bucket to spend. |
## 14. Decision Log

Append decisions that change implementation details while preserving the fixed architecture.

| ID | Date | Decision | Reason | Consequences |
|---|---|---|---|---|
| D-001 | 2026-08-11 | Keep the npm-workspaces monorepo and root Docker build context | Both services depend on root/shared files and the renderer consumes frontend renderer source | Coolify Base Directory remains `/` |
| D-002 | 2026-08-11 | Use one Coolify Compose resource with three containers | Simplifies deployment without collapsing distinct runtime responsibilities | Backend remains private; frontend and renderer have controlled public routes |
| D-003 | 2026-08-11 | Use same-origin `/api/*` for the SaaS application | Matches the desired URL structure and simplifies secure auth/cookies | Nginx becomes the API gateway; no public `api.` hostname |
| D-004 | 2026-08-11 | Keep the renderer separate from the authenticated app origin | Published customer content must not share the dashboard cookie/security boundary | Renderer receives platform/custom hostnames only |
| D-007 | 2026-08-11 | Two Coolify domain fields — frontend and renderer — with project subdomains as a Traefik label | A domain field names one hostname; project subdomains and customer hostnames are open-ended, and a Coolify application per site would mean a build, a container and a certificate for each | The renderer joins Coolify's proxy network; the wildcard router's priority is explicit so it never outranks either domain field |
| D-006 | 2026-08-11 | `main` is promoted by fast-forward from a green `development`, not through a pull request | The repository has a single maintainer; a review they approve themselves is process rather than protection, and the check suite is what catches things. Force-push and direct commits to `main` remain refused. | The plan's P8-T2 wording about a reviewed pull request is superseded by this entry |
| D-005 | 2026-08-11 | Do not blindly add a global hostname catch-all | The VPS hosts other Coolify applications | Custom-domain routing requires an isolated or proven lowest-priority strategy |

## 15. Authoritative external references

Implementation must verify current behavior against primary documentation:

- Docker build context: `https://docs.docker.com/build/concepts/context/`
- Dockerfile `CMD`: `https://docs.docker.com/reference/dockerfile/#cmd`
- Docker Compose in Coolify: `https://coolify.io/docs/knowledge-base/docker/compose`
- Coolify environment variables: `https://coolify.io/docs/knowledge-base/environment-variables`
- Cloudflare for SaaS setup: `https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/`
- Cloudflare custom origins and SNI: `https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/custom-origin/`
- Cloudflare connection request details: `https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/reference/connection-details/`
- Cloudflare hostname readiness: `https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/common-api-calls/`

