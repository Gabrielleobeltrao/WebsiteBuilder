# Operations guide

Everything an operator needs to stand up, run and recover this platform. It contains no real
secrets and no screenshots of a token.

> **Status.** The manifests and procedures below are written against the architecture and reviewed,
> but Docker is not installed on the development machine, so no image has been built and no staging
> deploy or restore has been rehearsed here. Treat the first deploy as the rehearsal and record the
> result at the bottom of this file.

---

## 1. What runs where

| Service | Public address | Role |
|---|---|---|
| Application | `https://websitebuilder.oneplataforma.com` | Marketing, auth, `/app/*` |
| API | `https://api.websitebuilder.oneplataforma.com` | Auth, data, publishing, domain jobs |
| Public renderer | `https://origin.websitebuilder.oneplataforma.com` plus every project and customer host | Serves published customer sites |
| MongoDB | none | Application data |

`api` and `origin` sit inside the same space as customer sites, `*.websitebuilder.oneplataforma.com`.
That is safe for two reasons that both have to hold: an explicit DNS record beats the wildcard, and
`PLATFORM_RESERVED_SUBDOMAINS` refuses both names as project slugs. Remove either and a project
called `api` would take over the API's hostname.

### Why the cookie is safe across these

The application and the API are different origins on one registrable domain. The session cookie is
**host-only to the API** — Better Auth sets no `Domain` attribute — so the browser sends it on
credentialed requests to `api.` and nowhere else. It is never transmitted to a published customer
site, whatever that site contains.

That is the whole reason not to widen it. A cookie with `Domain=.oneplataforma.com` would be sent on
every request to every customer subdomain, and the people writing those pages are not the people you
are protecting the session from.

CORS carries the other half: the API answers exactly one origin, `FRONTEND_ORIGIN`, with
credentials. An allowlist that reflected the request's own origin would let any site on the internet
use a signed-in visitor's session.

Customer sites live under `websitebuilder.oneplataforma.com` — deliberately not under the
application's own hostname.

---

## 2. Deployment shapes

### 2.1 One Compose resource (recommended)

Coolify → new resource → **Docker Compose**, base directory `/`, file
`docker-compose.production.yml`. All three services land on one internal network and reach each
other by service name. Nothing further is needed.

### 2.2 Separate resources per service

Also supported, with one mandatory extra step: the gateway reaches the API by name, and separate
Coolify resources are on separate networks.

1. Enable **Connect To Predefined Network** on the frontend and the API resources.
2. On the **frontend** resource set `BACKEND_ORIGIN` to the API container's internal address
   (`http://<container-name>:3000`, shown on the API resource's Configuration tab).

Without this, every `/api/*` request returns 502.

| | Frontend | API | Renderer |
|---|---|---|---|
| Build pack | Dockerfile | Dockerfile | Dockerfile |
| Base directory | `/` | `/` | `/` |
| Dockerfile | `/frontend/Dockerfile` | `/backend/Dockerfile` | `/backend/Dockerfile` |
| Start command | *(image default)* | `node backend/dist/server.js` | `node backend/dist/renderer-server.js` |
| Port | 8080 | 3000 | 3001 |
| Domain | `${PLATFORM_ROOT_DOMAIN}` | **none** | `origin.${PLATFORM_ROOT_DOMAIN}` and `*.${PLATFORM_ROOT_DOMAIN}` |

---

## 3. DNS

All records are in the `oneplataforma.com` zone. Names are relative to it.

| Record | Type | Points to | Why |
|---|---|---|---|
| `websitebuilder` | A | VPS | The application |
| `api.websitebuilder` | A | VPS | The API |
| `origin.websitebuilder` | A | VPS | Technical renderer host and the Cloudflare fallback origin |
| `*.websitebuilder` | A | VPS | Every project subdomain, `acme.websitebuilder.oneplataforma.com` |
| `customers.websitebuilder` | CNAME | `origin.websitebuilder.oneplataforma.com` | What customers point their own domain at |

Explicit records win over the wildcard, which is why `origin` and `customers` are listed separately
even though `*` would otherwise match them.

Set all of these to **DNS only** (grey cloud) in Cloudflare. The free Universal SSL covers
`oneplataforma.com` and one level of subdomain; `origin.websitebuilder.oneplataforma.com` is three
labels deep and outside it, so a proxied record there serves a certificate error. Grey cloud lets
Traefik issue the certificates on the VPS instead.

`PLATFORM_RESERVED_SUBDOMAINS` still refuses `app`, `api` and the rest as project slugs. They are in
a different part of the tree now, but a project called `api` producing
`api.websitebuilder.oneplataforma.com` would still be a hostname nobody intended to hand out.

### Certificates for the wildcard

Let's Encrypt issues a wildcard certificate only through a DNS-01 challenge, which needs a DNS
provider configured in Coolify. Without that, each project subdomain gets its own certificate via
HTTP-01 on first request — this works, at the cost of latency on that first hit.

---

## 4. Routing rules

Traefik must send the exact apex host to the gateway and everything else validated to the renderer:

- Host is exactly `websitebuilder.oneplataforma.com` → the application.
- Host is `api.websitebuilder.oneplataforma.com` → the API.
- Any other host under the wildcard → renderer. The renderer resolves the hostname against active domain records and
  answers a neutral 404 for anything it does not recognise, so a catch-all rule here cannot leak a
  tenant.

Inside the gateway, `/api/` is matched **before** the SPA fallback
([frontend/nginx.conf.template](../frontend/nginx.conf.template)). This ordering is the point: if
`index.html` were ever served for `/api/*`, a backend outage would return 200 with HTML and every
client would parse a login page as JSON.

---

## 5. Environment

Copy [.env.example](../.env.example). Production values go in Coolify per service, never in the
repository.

Placement rules:

- `VITE_*` is compiled into the browser bundle. Only the public origin and the relative API path
  belong there. A credential named `VITE_ANYTHING` is a published credential — `npm run test`
  includes a scan of the built bundle that fails if a backend variable name or a connection string
  appears in it.
- `MONGODB_URI`, `BETTER_AUTH_SECRET` and every `CLOUDFLARE_*` value are backend-only. They go on
  the API resource (and `MONGODB_URI` also on the renderer, which reads published snapshots).
- `TRUSTED_PROXY_CIDRS` must match the real Coolify/Traefik range. Leave it empty until you know it:
  empty means no forwarded header is believed, which is safe. A range wider than the actual proxy
  lets anyone who can set `X-Forwarded-Host` choose which customer's site they are served.

Startup validates everything with Zod and fails naming the variable, never its value.

### Cloudflare token scope

Zone → SSL and Certificates → **Edit**, restricted to the single zone in `CLOUDFLARE_ZONE_ID`.
Nothing account-wide. With the token absent, development uses an in-memory fake provider; in
production, startup refuses rather than promising customers a domain nobody registered.

---

## 6. Backups

MongoDB Atlas (current setup):

1. Atlas → Backup → enable **Cloud Backup**. Snapshots are encrypted at rest by default.
2. Retention: daily for 7 days, weekly for 4 weeks, monthly for 12 months.
3. Restore rehearsal, quarterly: restore the latest snapshot into a *new* cluster, point a staging
   API at it, confirm sign-in, one published site rendering, and one publish. Never restore over
   production to test a restore.
4. Record the date, snapshot ID and outcome in §10.

Self-hosted MongoDB in Coolify instead: enable the resource's scheduled backup to S3-compatible
storage with a server-side-encrypted bucket, same retention, same rehearsal.

GridFS media lives in the same database and is covered by the same snapshot.

---

## 7. Monitoring and alerts

| Signal | Where | Alert when |
|---|---|---|
| Disk | Coolify server metrics | > 80 % |
| Memory / CPU | Coolify per-resource | Sustained > 85 % for 10 min |
| Uptime | External checker | `https://${PLATFORM_ROOT_DOMAIN}/api/v1/health` or `https://origin.${PLATFORM_ROOT_DOMAIN}/healthz` fails twice |
| Publish failures | API logs, `msg` contains publish | Any 5xx from `POST /publishing` |
| Unknown-host spike | Renderer logs, 404 with `host` | Sharp rise — usually a DNS change or a scan |
| Certificate failures | Domain records with `status: failed` | Any customer domain failed for over an hour |
| Verification stalls | Domains pending beyond `DOMAIN_VERIFICATION_TIMEOUT_HOURS` | Any |

Renderer logs carry the hostname and the request line only. Published documents may contain
personal data and never enter a log; neither do form submission bodies.

---

## 8. Smoke checklist

Run after every deploy. Replace `example.com` with the real root domain.

```bash
ROOT=example.com

curl -sS -o /dev/null -w '%{http_code} apex\n'        https://$ROOT/
curl -sS -o /dev/null -w '%{http_code} roadmap\n'     https://$ROOT/roadmap
curl -sS -o /dev/null -w '%{http_code} app\n'         https://$ROOT/app
curl -sS -w ' api-health\n'                            https://$ROOT/api/v1/health
curl -sS -w ' renderer-health\n'                       https://origin.$ROOT/healthz

# The API must answer as an API even when it fails. HTML here means the SPA fallback is in front
# of the proxy and every client would parse a login page as JSON.
curl -sS -I https://$ROOT/api/v1/does-not-exist | grep -i content-type

# A published project subdomain and an unknown host.
curl -sS -o /dev/null -w '%{http_code} project\n'     https://acme.$ROOT/
curl -sS -o /dev/null -w '%{http_code} unknown\n'     https://nothing-here.$ROOT/
```

Then, in the application:

1. Publish a site. Confirm the public address serves the new content.
2. Publish again with no changes. Confirm it reports nothing changed and creates no new version.
3. Edit, publish, roll back. Confirm visitors see the older version and the draft is untouched.
4. Connect a disposable test subdomain, watch it move pending → certificate → working, make it
   primary, confirm the secondary redirects, then disconnect it and confirm the site still serves
   on its platform address.
5. Restart the API resource. Confirm published sites keep serving throughout — the renderer reads
   its own snapshots and does not depend on the API process.

---

## 9. Incidents

**Cloudflare API unavailable.** Already-active customer domains keep serving: the renderer resolves
only stored active records and never calls the provider. New activations and re-verification pause
and retry. Do nothing except confirm the refresh loop resumes.

**A publish failed.** Nothing changed for visitors — the pointer only moves after the snapshot is
written and verified. Read the blockers on the publish screen; they are the same ones the server
checked.

**Wrong content on a customer domain.** Check the domain record's `projectId`. Hostnames are
globally unique, so this means a record was written wrong, not that the renderer guessed. Disconnect
the domain to take it out of service immediately.

**Database unreachable.** The API answers health with `database: down`. The renderer serves cached
sites until their TTL expires, then answers 404. Restore from §6.

---

## 10. Branch and deployment protection

> **Not applied automatically.** These rules need an authenticated session with admin rights on the
> repository, which this environment does not have. The exact configuration is below; until it is
> applied, the residual risk is stated with it.

### What to configure

GitHub → Settings → Branches → Add branch ruleset.

**Ruleset `main`** — target branch `main`:

| Setting | Value |
|---|---|
| Restrict deletions | on |
| Block force pushes | on |
| Require a pull request before merging | on, 1 approval |
| Require status checks to pass | on — `verify` and `audit` |
| Require branches to be up to date before merging | on |
| Allow bypass | nobody, including administrators |

**Ruleset `development`** — target branch `development`:

| Setting | Value |
|---|---|
| Restrict deletions | on |
| Block force pushes | on |
| Require status checks to pass | on — `verify` |
| Require a pull request | **off** |

Pull requests are deliberately not required on `development`. Task branches merge back into it
constantly, and a review gate there would either be rubber-stamped or worked around — neither of
which is a control. The gate that matters is the one on `main`.

Also set the default branch to `development` (Settings → General → Default branch), so a clone and
a new pull request start where work belongs.

### Deployment sources

| Environment | Branch | Where |
|---|---|---|
| Production | `main` | Coolify → each resource → Configuration → Branch |
| Staging (optional) | `development` | A separate set of resources with their own database and secrets |

A task branch cannot deploy production because no resource watches it. Confirm this by looking at
the branch field on all three production resources; it is one screen and worth checking after any
Coolify upgrade.

### Residual risk until the rules are applied

- `main` can be force-pushed or deleted by anyone with write access.
- `development` can be merged into `main` without the checks having passed.
- The checks in `.github/workflows/quality.yml` still run on every pull request and their failure is
  visible; nothing prevents merging past a red one.

The local gates are unchanged and unweakened: `npm run typecheck && npm run test && npm run build &&
npm run test:e2e` is the same command the workflow runs.

---

## 11. Rehearsal record

| Date | Action | Result |
|---|---|---|
| — | Staging deploy | Not yet performed |
| — | Restore from backup | Not yet performed |
