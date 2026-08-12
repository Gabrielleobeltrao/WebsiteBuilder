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

Coolify then shows a domain field per Compose service. Fill two of the three:

| Service | Domain |
|---|---|
| `frontend` | `https://websitebuilder.oneplataforma.com:8080` |
| `backend` | *(leave empty)* |
| `renderer` | `https://origin.websitebuilder.oneplataforma.com:3001` |

**The port suffix matters.** It is how Coolify names the container port behind each hostname — the
frontend listens on 8080 inside its container, the renderer on 3001. Neither appears in a public
URL; visitors reach `https://websitebuilder.oneplataforma.com` and
`https://origin.websitebuilder.oneplataforma.com`.

**The backend's field stays empty.** That is what keeps it private: reachable as `backend:3000` on
the Compose network and from nowhere else. It is also not attached to the proxy network, so filling
that field by mistake would not be enough to publish it.

Project subdomains do not go here. A domain field names one hostname, and that set is open-ended —
every project gets one. It is a Traefik label instead, described in §6.

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
PUBLIC_RENDERER_HOST=origin.websitebuilder.oneplataforma.com

MONGODB_URI=<Atlas connection string>
MONGODB_DB_NAME=websitebuilder

BETTER_AUTH_SECRET=<openssl rand -base64 48>
```

Two of those need a word.

The root domain is **not** a variable in the routing rules. Coolify applies the Traefik labels to the
container without interpolating them — a deployed container was found carrying
`HostRegexp(...${PLATFORM_ROOT_DOMAIN_REGEX}$$)` as literal text, which matches no hostname at all
and answers every published site with the proxy's own 404. The rules in `docker-compose.production.yml`
therefore spell the domain out, and changing it means editing those two lines.

`PUBLIC_RENDERER_HOST` is a hostname, with no `https://`. It is used as a DNS name in a routing rule
and as the Cloudflare fallback origin, and neither accepts a scheme.

`WILDCARD_CERT_RESOLVER` defaults to `letsencrypt`, the resolver a Coolify host already has — and
that resolver answers the **HTTP** challenge, which cannot issue a wildcard. Section 5.1 sets up a
DNS-01 resolver; name it here once it exists. Until then every project subdomain is served with
Traefik's self-signed certificate, and a browser reports the site as impersonating itself.

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


## A 504 on the application hostname

Traefik answering `Gateway Timeout` after exactly thirty seconds means it matched a router and could
not reach the container behind it. The container is usually fine; what is wrong is which address
Traefik dialled.

A container on more than one network leaves that choice to Traefik, and Docker returns a container's
networks in a randomised order. The gateway sits on the resource network — which the proxy is on —
and on `internal`, which it is not. Without `traefik.docker.network`, roughly every other container
recreation picked the unreachable one, so the application "stopped working by itself" after a deploy
that changed nothing about it.

Both public services therefore carry `traefik.docker.network=coolify` and are attached to the proxy
network. `backend/tests/deployment-config.test.ts` asserts both.

To confirm it on a live host:

```bash
for c in frontend backend renderer; do
  N=$(docker ps --format '{{.Names}}' | grep "^$c-" | head -1)
  echo "$c: $(docker inspect "$N" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}')"
done
docker inspect coolify-proxy --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

Every publicly routed container must share a network with the proxy. The backend must not: it is
reached only as `backend:3000` on the private network, which is what makes the single-origin design
true rather than merely intended.

## 4.1 The certificate for published sites

Every published site gets a hostname under the root domain, so the proxy needs a certificate that
covers all of them. Let's Encrypt issues a wildcard only through the DNS-01 challenge, and the
resolver a Coolify host ships with answers the HTTP one — which cannot work here, because the
challenge would have to answer on a hostname whose certificate does not exist yet.

The deployment avoids the problem rather than solving it: **Cloudflare terminates TLS.**

1. In the Cloudflare zone, create an `A` record named `*` pointing at the VPS address.
2. Leave it **proxied** (orange cloud). Cloudflare's certificate covers `*.oneplataforma.com`.
3. SSL/TLS → mode **Full**. Traefik answers the edge with its own default certificate, which Full —
   as opposed to Full (strict) — accepts.

One level only. Cloudflare's free certificate covers `algo.oneplataforma.com` and **not**
`algo.websitebuilder.oneplataforma.com`, which is why published sites live directly under the root
domain. Two levels would need either a DNS-01 resolver on the proxy or Cloudflare's Advanced
Certificate Manager.

Names the platform uses itself must never be claimable as a site address:

```
PLATFORM_RESERVED_SUBDOMAINS=websitebuilder,origin,www,api,admin,mail,cdn,app
```

The product refuses those slugs on top of its own built-in list, which cannot be shortened.

Verify from anywhere except the server:

```bash
echo | openssl s_client -connect <slug>.oneplataforma.com:443 \
  -servername <slug>.oneplataforma.com 2>/dev/null | openssl x509 -noout -issuer
```

`issuer=` naming Cloudflare or Let's Encrypt means the browser will accept it.
`CN=TRAEFIK DEFAULT CERT` means the record is not proxied and the edge is being bypassed.

## 5. DNS

All records are in the `oneplataforma.com` zone; names are relative to it.

| Record | Type | Points to | Proxy | Why |
|---|---|---|---|---|
| `websitebuilder` | A | VPS IP | DNS only | The application |
| `origin.websitebuilder` | A | VPS IP | DNS only | Technical renderer host and Cloudflare fallback origin |
| `*` | A | VPS IP | **Proxied** | Every published site, with Cloudflare's certificate |
| `customers.websitebuilder` | CNAME | `origin.websitebuilder.oneplataforma.com` | DNS only | What customers point their own domain at |

There is deliberately no `api` record. Creating one would publish an API that the architecture keeps
private.

**Grey cloud for the platform's own two hostnames.** Cloudflare's free certificate covers
`oneplataforma.com` and one level below it. `origin.websitebuilder.oneplataforma.com` is three labels
deep and outside that, so a proxied record there would serve a certificate error. DNS-only lets
Traefik issue for them itself, which it can, because each is one concrete hostname.

**Orange cloud for the site wildcard.** `*` is where every published site lives, and it is the record
that cannot be served by Traefik alone — a `HostRegexp` router has no concrete hostname to request a
certificate for. Proxied, Cloudflare presents its own certificate for any `slug.oneplataforma.com`
and the origin never needs one. §4.1 has the three settings.

An explicit record always wins over the wildcard, so `websitebuilder` keeps its own grey-cloud
record and the dashboard is unaffected by any of this.

---

## 6. Routing

Two sources.

**The two exact hostnames** come from the Coolify domain fields in §3. Coolify generates a Traefik
router for each: the application to `frontend:8080`, the technical origin to `renderer:3001`.

**Project subdomains** come from one label on the `renderer` service, because a domain field names
one hostname and this set is open-ended:

| Router | Rule | Priority | Goes to |
|---|---|---|---|
| `wb-renderer-projects` | any single label under the root domain | 10 | `renderer:3001` |

Renderer traffic never passes through the frontend container. It reaches the renderer directly, on
its own port — the frontend is a static gateway for the application and knows nothing about
published sites.

Nothing routes to `backend`. It is not on the proxy network, so a stray label could not publish it
by accident.

**Why the priority is written down.** Traefik ranks routers by rule length when priority is unset,
and a long regexp outranks a short exact host. Left to the default, the project wildcard would
outrank both domain fields — the dashboard would be served by the renderer, and so would the
technical origin. At 10 it loses to every exact-host router on the machine, including the ones other
applications create.

The project pattern requires exactly one label before the root domain, so the apex never matches and
`origin.websitebuilder.oneplataforma.com` — three labels — does not either. `websitebuilder` itself
does match the pattern, and is protected by two things rather than one: the priority above, which
loses to its exact-host router, and `PLATFORM_RESERVED_SUBDOMAINS`, which stops anyone publishing a
site under that name in the first place.

**The rules spell the domain out.** They contain no `${...}`, because Coolify applies these labels
without interpolating them — a deployed container was found carrying `${PLATFORM_ROOT_DOMAIN_REGEX}`
as literal text in its rule, matching nothing, which presents as every published site returning the
proxy's 404. A test asserts no label in the file contains an interpolation.

The renderer answers 404 for any hostname without an active record, including every reserved label,
so even a rule that matched too much could not expose a tenant.

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
