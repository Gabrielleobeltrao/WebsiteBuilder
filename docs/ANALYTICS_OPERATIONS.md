# Analytics — budgets, capacity and operations

Companion to `docs/adr/analytics-first-party.md`. Every number here is a ceiling the system is
designed against, not an aspiration. A budget nobody enforces is prose, so each one names the test
that fails when it is exceeded.

## Performance budgets

| Budget | Value | Enforced by |
|---|---|---|
| Tracker JavaScript, Brotli | target 8 KiB, hard ceiling 15 KiB | `PERFORMANCE_BUDGETS.publishedSiteTrackerBytes`, asserted in `backend/tests/bundle-budget.test.ts` |
| Published-page JavaScript, total | 60 KiB | `PERFORMANCE_BUDGETS.publishedSiteJavaScriptBytes` (pre-existing) |
| Synchronous scripts on a published page | zero | The tracker is injected with `defer`; asserted in the renderer tests |
| Third-party requests from a published page | zero | CSP has no external origin in `script-src` or `connect-src` |
| Events per batch | 50 | Shared schema, rejected with 400 |
| Decoded request body | 64 KiB | Route-local `express.json` limit, rejected with 413 |
| Tracker main-thread work | p95 ≤ 2 ms per callback | Passive listeners, rAF-throttled scroll, `IntersectionObserver` |
| Layout shift caused by analytics | zero | The tracker injects no DOM; consent UI is fixed-position over the viewport |
| Ingestion latency | p95 ≤ 200 ms to durable acceptance | Two writes per batch: one dedup insert, one bulk upsert |
| Overview query | p95 ≤ 500 ms over 90 days | Session `$group` on an indexed range |
| Heatmap query | p95 ≤ 1 s for one page/version/device | Bin scan on a unique-prefix index |

The last two are the ones that degrade with success rather than with code. See the ceiling below.

## Events per page view

A typical page view emits four batches:

1. `page_view` plus the first `web_vital` samples (FCP, TTFB) — sent shortly after load;
2. one `engagement_heartbeat` batch per 15 s of *visible, non-idle* time, carrying accumulated
   scroll-depth and section-visibility updates;
3. `element_click` events, coalesced into the next scheduled batch rather than sent individually;
4. a final batch on page hide carrying `page_leave`, the remaining vitals (LCP, CLS, INP) and any
   pending counters, delivered with `navigator.sendBeacon`.

A visitor who reads one page for a minute therefore produces roughly 5 requests, not 50. Pointer
movement, if ever enabled, is aggregated client-side into coarse cells and never sent per movement.

## Storage formula

Rows, not bytes, are the thing that grows. Only sessions grow with traffic; everything else grows
with the *shape* of the site.

```
analyticsSessions   ≈ sessions/day × 90 days                     (~250 B/row)
analyticsDaily      ≈ pages × devices × sources × 400 days        (~150 B/row)
analyticsBins       ≈ pages × devices × versions × (cells + 5 + sections)
analyticsVitals     ≈ pages × devices × 5 metrics × 30 buckets × 400 days
analyticsBatches    ≈ batches/hour × 2                            (~60 B/row)
```

Worked example — a 10-page site, 3 device categories, 5 traffic sources, 20 retained versions, a
400-cell click grid, 8 sections per page, at 1,000 sessions/day:

| Collection | Rows | Approx. size |
|---|---|---|
| `analyticsSessions` | 90,000 | 22 MB |
| `analyticsDaily` | 60,000 | 9 MB |
| `analyticsBins` | 247,800 | 30 MB |
| `analyticsVitals` | 1,800,000 | 220 MB |
| **Total** | | **~280 MB per site** |

`analyticsVitals` dominates, and it is the one that does not grow with traffic at all — it is
`pages × devices × metrics × buckets × days`. If storage becomes a problem before query latency
does, the correct lever is reducing vital retention from 400 days to 90, which cuts the total by
roughly two thirds and costs only the year-over-year comparison.

**Alert threshold:** raise an alert when the analytics collections exceed 40% of the Atlas cluster's
storage, or when any single project exceeds 2 GB. The second is the useful one — it means either a
site with far more pages than the model assumes, or a bug creating rows per request instead of per
page.

## Scale ceiling

The write path is comfortable well past the read path. One batch costs one dedup insert plus one
bulk upsert of at most ~40 operations; a project serving a million page views a month averages under
two writes a second.

**The binding constraint is the session query.** Overview metrics group over every session in the
window, so cost is proportional to sessions, not to pages. That exceeds the 500 ms budget at roughly
**30,000–50,000 sessions per day for a single site** over a 90-day window. Every other query scans
counters whose cardinality is fixed by the site's shape and does not grow with traffic.

When a site approaches that, the replacement is known and additive: a Mongo-leased roll-forward in
the API process folds sessions older than the 30-minute inactivity window into a daily counter
collection and deletes them. Closed days are then read from counters and only today is read live.
The stored session shape does not change; only who reads it.

## Rate limiting

The limiter is an in-process token bucket with two required buckets — per client address and per
project — so one hot or hostile site cannot exhaust the process for other tenants.

**State is per process, deliberately.** With N renderer replicas the effective limit is N times the
configured value. This is accepted because the alternatives are worse: Redis would mean a new
Coolify resource, which the deployment design forbids, and a Mongo-backed counter would put a
database round-trip in front of every beacon — a larger availability risk than the abuse it
prevents. The renderer runs as a single replica today.

**Address-keyed limiting requires `TRUSTED_PROXY_CIDRS` to be set on the renderer.** Without it the
renderer trusts no forwarded header, every visitor presents the gateway's address, and an
address-keyed bucket would throttle the entire internet as one client. The limiter therefore keys on
address only when trusted ranges are configured, and falls back to the per-project bucket otherwise.
The deployment-configuration test asserts the variable is present.

## What is never logged

Request bodies, session identifiers, page-view identifiers, batch identifiers, coordinates, element
and section identifiers, the User-Agent string, the visitor address, and query strings.

The renderer's logger already narrows requests to method and URL and adds only the hostname. For the
ingestion route the URL carries no data, so the existing configuration is correct by construction —
and a test asserts that fixture identifiers never appear anywhere in captured log output.

## Observability

Aggregate counters only, none of which identify a visitor: batches accepted, batches rejected by
reason, ingestion duration, bulk-write duration, sessions written, analytics storage size, dashboard
query duration, and query errors.

An operator must be able to see that ingestion is failing without being able to see what any visitor
did.
