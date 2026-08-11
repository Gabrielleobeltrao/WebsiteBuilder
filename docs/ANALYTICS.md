# Analytics

First-party measurement for published sites. No external provider, no shared analytics hostname, and
no data leaving the platform's own infrastructure.

See also: `docs/ANALYTICS_METRICS.md` for what each number means, `docs/ANALYTICS_PRIVACY.md` for what
is and is not collected, `docs/ANALYTICS_OPERATIONS.md` for budgets and capacity, and
`docs/adr/analytics-first-party.md` for why the design is shaped this way.

## Turning it on

Two switches, in two places, and both must be open:

1. **The deployment.** `ANALYTICS_INGESTION_ENABLED` on the renderer service. It defaults to `false`,
   so a deployment never starts with an open write endpoint by accident.
2. **The site.** Analytics → Settings → *Measure this site*, per project, off by default. Sites
   published before this feature existed disclosed no measurement to their visitors, and turning it
   on for them without their owner deciding to would be a promise made on someone else's behalf.

Until both are on, published pages carry no script and are served the same content-security policy
they were before: `script-src 'none'`.

## What a visitor's browser does

A page whose site is collecting carries one deferred script from its own origin:

```html
<script defer src="/__wb/a.js?v=<hash>" data-endpoint="/__wb/events" data-version="…" …></script>
```

The tracker is about 4 KB compressed. It sends batched counters to `/__wb/events` on the same
hostname — the site's own, including a customer's custom domain — so no cross-origin request is made
and no CORS allowance exists to widen.

If it fails to load, fails to send, or is blocked, the page is unaffected. Every entry point is
wrapped: a customer's site must not break because their statistics did.

## What the server does with a batch

1. Resolves the hostname to exactly one workspace, project and published version. **None of that
   comes from the payload** — the event schema has no such fields.
2. Resolves the reported path against the published route manifest. A path that is not a published
   route is discarded rather than stored.
3. Verifies the version the browser reported; if it does not exist for this project, falls back to
   the active one.
4. Claims the batch id, so a retried beacon is recognised rather than counted twice.
5. Applies counters: one session row, one daily row per page/device/source, one bin per grid cell or
   section, one histogram bucket per Web Vital sample.

Nothing about a visitor is logged, and no aggregation job runs — every metric is either an increment
at write time or a calculation at read time.

## Reading it

`/app/:workspaceId/sites/:projectId/analytics`, with filter state in the query string so a view can
be reloaded, bookmarked and shared with another authorised member.

- **Overview** — server-counted and browser-measured views side by side, with their ratio as
  measurement coverage; visits, engagement, bounce, engaged time, clicks, devices, sources, hosts.
- **Pages** — views, clicks and scroll depth per page, and a CSV download.
- **Heatmaps** — clicks, scroll and attention drawn over the exact published version they were
  recorded against. Requires one page, one version and one device.
- **Technical performance** — Core Web Vitals from real visitors, p75, rated only above the sample
  threshold.
- **Settings** — collection, consent, retention, categories, and deletion.

## Two view counts, and why they disagree

The renderer counts a view for every successfully served page. The tracker counts one for every
browser that ran it. The second is always smaller, because it excludes anyone who blocks scripts,
disables JavaScript, or declines consent.

Both are shown. Their ratio is the coverage figure, and it is also a correctness check: **the server
count is always greater than or equal to the browser count.** A browser count that exceeds it means
ingestion is double-counting.

## Troubleshooting

**No numbers at all.** Check both switches. Then check the page source for `/__wb/a.js` — if it is
absent the site's setting is off or the settings cache has not expired (60 s by default).

**The script loads but nothing arrives.** Check the response of `POST /__wb/events`: `404` means the
hostname does not resolve to a site, `415` means something is sending a content type other than
JSON, `429` means a rate limit. Aggregate counts for all of these are on the renderer's `/healthz`.

**Numbers stopped after a publish.** Traffic, engagement and Web Vitals span publishes. Heatmaps do
not: their coordinates are deleted with the layout that produced them, so a version pruned by
`PUBLISHED_VERSION_RETENTION_COUNT` takes its maps with it.

**Consent prompt never appears.** It is rendered hidden and revealed by the tracker only when there
is a decision to make. A visitor who already answered, or who has JavaScript off, does not see it.
