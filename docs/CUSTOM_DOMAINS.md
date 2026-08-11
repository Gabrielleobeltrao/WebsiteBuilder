# Customer custom domains

How a customer connects their own hostname, what the platform promises at each stage, and the one
routing decision on this VPS that can break unrelated applications.

---

## 1. What is supported

**Subdomains, fully.** `www.customer.com` or `site.customer.com` point at the platform with a CNAME.
This is the path to recommend.

**Apex domains, conditionally.** `customer.com` with no subdomain needs a CNAME at the zone root,
which DNS does not allow. It works only where the customer's DNS provider offers CNAME flattening or
ALIAS records — Cloudflare, Route 53 and a few others do; many registrars do not.

Do not tell a customer to "just add an A record". The platform's address can change, and an A record
they set once will keep pointing at wherever it used to be. The honest advice is to use `www` and
have their provider redirect the apex to it, which every provider supports.

---

## 2. What the customer does

They create one record with their DNS provider:

| Type | Name | Value |
|---|---|---|
| CNAME | `www` | `customers.websitebuilder.oneplataforma.com` |

The exact record is shown in the application, on **Site → Settings → Domains**, and it comes from
the provider rather than from a template — so it is right even when the provider asks for something
different.

---

## 3. The states, and what each one means

A domain is shown as working only when ownership **and** the certificate are both complete. The two
are tracked separately because they fail separately.

| State | What is true | What the customer should do |
|---|---|---|
| Waiting for your DNS record | The record is not visible yet | Add it; propagation can take an hour |
| Checking your DNS record | It was found and is being confirmed | Nothing |
| Issuing the security certificate | Ownership is proven | Nothing; usually minutes |
| Working | Ownership and certificate are both active | Nothing |
| Something went wrong | The provider rejected or timed out | Compare the record exactly, then "Check again" |

Nothing is ever marked active on a timer. The stored status is a cache of the provider's answer, and
a refresh that fails leaves the previous state alone — a provider outage must not demote a domain
that is serving traffic.

---

## 4. When the provider is unavailable

Already-active domains keep serving. The renderer resolves hostnames from stored records and never
calls the provider on a request, so an outage at Cloudflare cannot take a customer's site down.

What pauses is new activation and re-verification. A domain claimed during an outage is stored and
reported as pending, so the customer does not lose their place and nothing has to be retyped.

If the platform has no Cloudflare credentials at all, connecting a domain is refused with a message
saying custom domains are not configured. It is refused rather than accepted, because telling a
customer their domain works while nothing was registered anywhere is the one failure with no
recovery path.

---

## 5. Disconnecting

Removing a domain removes the provider mapping and the local record. The site, its content and its
platform hostname are untouched — disconnecting an address is not deleting a site.

A provider that has already forgotten the hostname counts as success, and a provider that is
temporarily unreachable does not block the removal: a customer must always be able to take their
domain back.

---

## 6. Routing safety

> This is the part that can break applications unrelated to this platform.

Cloudflare for SaaS forwards the customer's **original** `Host` header. The VPS must route on that
header to the renderer, without claiming traffic belonging to anything else Coolify hosts.

The platform's own routers are already in place and deliberately narrow: an exact host for the
technical origin and a single-label pattern for project subdomains, both defined as labels on the
renderer service. Neither matches an arbitrary customer hostname, which is why connecting one needs
a decision on the VPS rather than a change in this repository.

Before adding any rule:

1. Inspect every existing Traefik router on the VPS and record its rule and priority.
2. Prefer isolating the renderer by the technical origin's SNI, or another mechanism that preserves
   the original hostname without a broad match.
3. A lowest-priority HTTP catch-all is acceptable **only** after proving every existing application
   has a higher-priority exact route, and only with the rollback written down first.
4. Never add an untested high-priority `HostRegexp(.+)`. It takes every hostname on the machine,
   including ones this platform knows nothing about.

The renderer itself is safe under a catch-all: it answers 404 for any hostname without an active
record, and reserved, unknown and malformed hosts all return byte-identical responses. The risk is
never that the renderer leaks a tenant — it is that the rule intercepts another application's
traffic before that application's router sees it.

---

## 7. Cloudflare configuration

Needed only when onboarding customer domains.

**Zone ID** — `dash.cloudflare.com` → select the zone → Overview → right column, under API.

**API token** — `dash.cloudflare.com/profile/api-tokens` → Create Custom Token:

| Field | Value |
|---|---|
| Permissions | Zone → SSL and Certificates → Edit |
| Zone Resources | Include → Specific zone → your zone |

Nothing account-wide. This token manages certificates on one zone and can do nothing else, which is
why a custom token is created rather than a global key used. It is shown once.

**Fallback origin** — SSL/TLS → Custom Hostnames → Fallback Origin →
`origin.websitebuilder.oneplataforma.com`. Custom hostnames stay pending without it.

Cloudflare for SaaS has its own plan and per-hostname terms; the dashboard states the current ones
at the point of enabling it.

---

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Stuck on "waiting for your DNS record" | The record is on the wrong name, or the provider is proxying it |
| Ownership active, certificate never issues | The fallback origin is not set |
| Works without `www`, fails with it, or the reverse | Only one of the two hostnames was connected |
| The site loads on its platform address but not the custom one | Routing on the VPS, not the provider — see §6 |
| Certificate error on a working domain | The record was switched to proxied after activation |
