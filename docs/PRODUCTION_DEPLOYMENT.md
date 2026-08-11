# Production deployment

Everything needed to deploy this platform from a clean Coolify installation. It contains no real
secrets.

> **Not yet rehearsed.** Docker is not installed on the machine this was written from, so no image
> has been built and no stack has been started here. The manifests are checked by tests that read
> their structure, and CI builds the images on every push. Treat the first deploy as the rehearsal
> and record the result in [RELEASE_AND_ROLLBACK.md](RELEASE_AND_ROLLBACK.md).

---

## 1. What gets deployed

One Coolify resource, three containers, one private network.

| Container | Public address | Role |
|---|---|---|
| `frontend` | `https://websitebuilder.oneplataforma.com` | Serves the SPA and proxies `/api/*` to the backend |
| `backend` | **none** | Auth, data, publishing, domain jobs |
| `renderer` | `https://origin.websitebuilder.oneplataforma.com` and every project/customer host | Serves published customer sites |

The API has no public route at all — no domain, no published port. The browser reaches it only
through `/api/*` on the application's own origin, which means it makes no cross-origin request, the
session cookie stays host-only to the origin it is already on, and there is no CORS allowance to
misconfigure.

The renderer is public for the opposite reason: it serves *customer* content, and sharing an origin
with the authenticated dashboard would put a published customer page and the admin session cookie
on one host.

---

## 2. Prerequisites

- A VPS with Coolify installed and its proxy running.
- A MongoDB Atlas cluster, or another MongoDB reachable from the VPS.
- DNS control over `oneplataforma.com`.
- Optional, and only for customer domains: a Cloudflare account with the zone.

---

## 3. Coolify fields

Create **one** resource. Not three.

| Field | Value |
|---|---|
| Resource type | Docker Compose |
| Repository | `https://github.com/Gabrielleobeltrao/WebsiteBuilder.git` |
| Branch | `main` |
| Base Directory | `/` |
| Docker Compose Location | `/docker-compose.production.yml` |
| Domains | `https://websitebuilder.oneplataforma.com:8080` |

**One domain field, one value, and the `:8080` matters.** It is how Coolify names the container port
behind that hostname — the frontend listens on 8080 inside its container. It never appears in the
public URL; visitors reach `https://websitebuilder.oneplataforma.com`.

Do not add the renderer's hostnames here. They are routed by labels in the Compose file, described
in §6, because they are open-ended: every project gets a subdomain and every customer may bring
their own hostname. A domain field cannot express that, and a Coolify application per customer site
would mean a build, a container and a certificate for each.

`Base Directory` is `/` and not `/backend`. It sets the Docker build context — what the build can
see — and both images need the root lockfile and `packages/shared`, which live above those folders.
Docker refuses to read outside its context, so a narrower setting fails on the first `COPY`.

Do not create separate resources for frontend, backend and renderer. Compose already creates three
containers inside this one, on a private network where `backend:3000` resolves. Separate resources
are separate networks, and the gateway would have nothing to proxy to.

---

## 4. Environment variables

Set these on the resource. Compose passes each one only to the service that needs it.

```
PLATFORM_PUBLIC_ORIGIN=https://websitebuilder.oneplataforma.com
PLATFORM_ROOT_DOMAIN=websitebuilder.oneplataforma.com
PLATFORM_ROOT_DOMAIN_REGEX=websitebuilder\.oneplataforma\.com
PUBLIC_RENDERER_HOST=origin.websitebuilder.oneplataforma.com

MONGODB_URI=<Atlas connection string>
MONGODB_DB_NAME=websitebuilder

BETTER_AUTH_SECRET=<openssl rand -base64 48>
```

Three of those need a word.

`PLATFORM_ROOT_DOMAIN_REGEX` is the same domain with its dots escaped. It goes into a Traefik
pattern, where an unescaped `.` matches any character — so `websitebuilderXoneplataforma.com` would
match a rule written without the backslashes. Copy it exactly as shown.

`PUBLIC_RENDERER_HOST` is a hostname, with no `https://`. It is used as a DNS name in a routing rule
and as the Cloudflare fallback origin, and neither accepts a scheme.

`COOLIFY_PROXY_NETWORK` defaults to `coolify`. Set it only if your installation named its proxy
network something else — `docker network ls` shows it. The renderer must share that network with
Traefik or its routes resolve to a container Traefik cannot reach, which presents as a 502 with no
obvious cause.

Optional, and only when onboarding a customer's own domain:

```
CLOUDFLARE_ZONE_ID=<zone id>
CLOUDFLARE_API_TOKEN=<scoped token>
CLOUDFLARE_SAAS_CNAME_TARGET=customers.websitebuilder.oneplataforma.com
```

Without them the platform runs normally and only connecting a customer domain is refused, with a
message saying so. See [CUSTOM_DOMAINS.md](CUSTOM_DOMAINS.md).

**Generating the secret.** `openssl rand -base64 48`. It must be at least 32 characters; the
process refuses to start otherwise, and says which of "not set" or "too short" it is. It is never
printed, and it is never given to the renderer, which has no sessions to sign.

**What has no variable.** There is no `VITE_*` build argument and no API origin to configure. The
browser calls `/api/v1` on the origin it is already on.

**If a required value is missing**, the deployment stops with the variable named. That is
deliberate: a default would start a service configured with an empty string and fail later, further
from the cause.

---

## 5. DNS

All records are in the `oneplataforma.com` zone; names are relative to it.

| Record | Type | Points to | Proxy | Why |
|---|---|---|---|---|
| `websitebuilder` | A | VPS IP | DNS only | The application |
| `origin.websitebuilder` | A | VPS IP | DNS only | Technical renderer host and Cloudflare fallback origin |
| `*.websitebuilder` | A | VPS IP | DNS only | Every project subdomain |
| `customers.websitebuilder` | CNAME | `origin.websitebuilder.oneplataforma.com` | DNS only | What customers point their own domain at |

There is deliberately no `api` record. Creating one would publish an API that the architecture keeps
private.

**Grey cloud, not orange.** Cloudflare's free Universal SSL covers `oneplataforma.com` and one level
of subdomain. `origin.websitebuilder.oneplataforma.com` is three labels deep and outside it, so a
proxied record there serves a certificate error. DNS-only lets Traefik issue certificates on the VPS.

**The wildcard certificate** needs a DNS-01 challenge, which requires a DNS provider configured in
Coolify (Settings → Advanced → Let's Encrypt DNS Challenge, with a token scoped to Zone → DNS →
Edit). Without it each project subdomain gets its own certificate on first request — that works, at
the cost of latency on that first hit.

---

## 6. Routing

Two sources, and only two.

**The application's domain** comes from the single Coolify field in §3. Coolify generates its
Traefik router.

**Everything else** comes from labels on the `renderer` service in the Compose file:

| Router | Rule | Priority | Goes to |
|---|---|---|---|
| `wb-renderer-origin` | exact `origin.websitebuilder.oneplataforma.com` | 100 | `renderer:3001` |
| `wb-renderer-projects` | any single label under the root domain | 10 | `renderer:3001` |

Nothing routes to `backend`. It is not even on the proxy network, so a stray label could not publish
it by accident.

**Why the priorities are written down.** Traefik ranks routers by rule length when priority is
unset, and a long regexp outranks a short exact host. Left to the default, the project wildcard
would outrank the application's own domain and the dashboard would be served by the renderer. The
wildcard sits at 10 so every exact-host router on the machine — including other applications' —
wins against it.

The project pattern requires a label before the root domain, so the apex itself never matches. The
renderer answers 404 for any hostname without an active record, including every reserved label, so
even a rule that matched too much could not expose a tenant.

**Verify rather than trust this table.** After the first deploy:

```bash
docker inspect <renderer container> --format '{{json .Config.Labels}}' | jq
```

**Customer hostnames are not covered by these two routers.** Adding a rule that matches arbitrary
hostnames on a VPS that hosts other applications is the one routing decision that can break things
unrelated to this platform. Read [CUSTOM_DOMAINS.md](CUSTOM_DOMAINS.md#6-routing-safety) before
adding one.

---

## 7. First deployment

1. Set the environment variables above.
2. Deploy. Coolify builds three images and starts three containers.
3. Watch all three become healthy. The frontend waits for the backend by design.

Then check, in this order:

```bash
ROOT=websitebuilder.oneplataforma.com

curl -sS https://$ROOT/api/v1/health          # {"status":"ok","database":"up"}
curl -sS -o /dev/null -w '%{http_code}\n' https://$ROOT/
curl -sS -I https://$ROOT/api/v1/does-not-exist | grep -i content-type
curl -sS https://origin.$ROOT/healthz
curl -sS -o /dev/null -w '%{http_code}\n' https://nothing-here.$ROOT/   # 404
```

The third one matters most. It must not be `text/html`. HTML there means `/api/*` is falling through
to the SPA, and every client will parse a login page as JSON — a failure that presents as a rejected
login and points at nothing.

Then, in the application: register an account, create a site, save, reload, publish, and open the
project's subdomain.

---

## 8. If something fails

| Symptom | Cause |
|---|---|
| `lstat .../backend: no such file` | Base Directory is not `/` |
| Build fails on a missing compiler | Something forced `NODE_ENV=development`; the image sets its own |
| `host not found in upstream "backend"` | The stack is not one Compose resource; there is no private network |
| Login says the credentials did not match, and `/api/v1/health` returns HTML | The gateway is not proxying `/api/` |
| Backend exits naming a variable | It is missing or too short; the message says which |
| Renderer restarts continuously | It is being probed on the API's health path — check the image target |

Container logs are in Coolify per service. The API and the renderer log structured JSON; neither
logs secrets, form bodies or published content.

---

## 9. Related

- [CUSTOM_DOMAINS.md](CUSTOM_DOMAINS.md) — customer hostnames and Cloudflare for SaaS
- [RELEASE_AND_ROLLBACK.md](RELEASE_AND_ROLLBACK.md) — promotion, tags, rollback
- [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) — the per-release list
- [OPERATIONS.md](OPERATIONS.md) — backups, monitoring, incidents
