# WebsiteBuilder — First-Party Analytics and Page Performance Plan

> Plan version: **1.0.0**  
> Repository: `https://github.com/Gabrielleobeltrao/WebsiteBuilder.git`  
> Audited baseline: `main@0d116a9` (superseded — see the correction in section 3)  
> Corrected baseline: `development@3223c7f`  
> Created: 2026-08-11  
> Target branch flow: feature branch -> `development` -> `main`

## 1. Goal

Build privacy-conscious, first-party analytics for published websites. A site owner must be able to understand traffic, active engagement, scroll depth, section attention, element clicks, traffic sources, devices, and real-user technical performance without connecting an external analytics provider.

The feature adds a site-level route:

```text
/app/:workspaceId/sites/:projectId/analytics
```

Use the label **Analytics** in English and **Desempenho** in Portuguese. Keep it distinct from the existing pre-publish performance audit: the audit predicts problems before publishing; Analytics measures real visitors after publishing.

This plan does not include A/B testing, session replay, advertising attribution, CRM integration, Google Analytics, Google Tag Manager, or external heatmap providers.

## 2. Execution rules

1. Read this entire file and inspect the current repository before editing.
2. This file is the source of truth only for the Analytics feature. Do not reopen the completed production-remediation plan.
3. Work from current `development` on a short-lived feature branch such as `feature/first-party-analytics`.
4. Preserve the current single Coolify Docker Compose resource and its three services. Do not add a public resource or public domain.
5. Respond to the user in Brazilian Portuguese. Keep code, documentation, identifiers, comments, commits, and translation keys in English.
6. Mark an active task `[~]`, a verified task `[x]`, and use `[!]` only for a genuine user-only permission, legal policy decision, or production operation.
7. Complete tasks in dependency order and continue automatically through every unblocked task.
8. Do not mark a task complete until its acceptance criteria and relevant tests pass.
9. Never fabricate analytics data. Empty datasets must show an explicit no-data or collection-disabled state.
10. Never collect form values, typed text, passwords, emails, full IP addresses, authentication cookies, builder data, or unpublished preview activity.

### Goal command

```text
/goal Every task in ANALYTICS_IMPLEMENTATION_PLAN.md is [x] with its acceptance criteria and verification completed, or [!] only when it genuinely requires user-only credentials, a legal/privacy policy decision, or a production operation. Complete every remaining unblocked task, keep the Progress Log and Decision Log accurate, and finish with passing root typecheck, tests, build, E2E, container smoke tests, analytics ingestion tests, privacy tests, tenant-isolation tests, and performance-budget checks. Completing only one task or phase does not satisfy this goal. Respond to the user in Brazilian Portuguese; keep all project artifacts in English.
```

## 3. Confirmed starting point

The current application already provides useful foundations:

- immutable published versions;
- stable project, page, section, and element IDs;
- hostname-to-project resolution in the public renderer;
- one public renderer serving platform subdomains and verified custom domains;
- MongoDB Atlas and workspace/project tenant isolation;
- bilingual authenticated UI;
- a responsive dashboard shell;
- server-side traffic measurement that already ships.

**Correction, 2026-08-11.** This plan was audited at `main@0d116a9`, one commit before the workspace
dashboard landed. The `analytics: { state: "not_connected" }` placeholder it describes no longer
exists. `backend/src/modules/analytics/repository.ts` ships a `siteViews` collection of daily
counters written by the renderer after it serves a real published route, feeding
`loadWorkspaceDashboard` and the workspace overview at `/app/:workspaceId/overview`. That
measurement is retained unchanged as the always-on baseline: it survives ad blockers, disabled
JavaScript and a declined consent prompt, none of which the browser tracker does. See decision
A-009.

Important constraint: published pages currently ship no JavaScript and use `script-src 'none'`. Analytics requires a small self-hosted script, so CSP must change deliberately to `script-src 'self'` and `connect-src 'self'`. Do not allow inline scripts or third-party tracking origins.

**Correction, 2026-08-11.** The relaxation is conditional on the tracker actually being injected. A
site with analytics disabled — which is every existing site, by A-005 — keeps the current policy
byte for byte. Two constants exist rather than one changed constant. See decision A-010.

## 4. Product scope

### 4.1 Overview metrics

For the selected period and page filters, show:

- page views;
- anonymous sessions;
- engaged sessions;
- engagement rate;
- average engaged time;
- bounce rate with an in-product definition;
- average and median maximum scroll depth;
- CTA/link clicks;
- form submissions when forms are present;
- top page and top traffic source;
- percentage change versus the immediately preceding equal-length period when comparable data exists.

**Correction, 2026-08-11.** Two items in this list are constrained by what exists. Session-metric
comparison against the preceding equal period is capped at 45 days, because session retention is 90
days and a 90-day comparison would read an empty window; view metrics compare to roughly 200 days
from daily counters. And `form_submissions` is deferred: there is no form element in the builder
schema and the forms module has no HTTP surface, so no published page can contain a form and the
event can never fire. The existing `no_forms` state is shown instead of a zero.

Do not label anonymous sessions as unique people. Persistent unique visitors may be shown only when the site has an enabled consent mode that permits a random first-party visitor identifier.

### 4.2 Charts and tables

The overview must include:

- sessions and page views over time;
- engagement over time;
- page performance table;
- scroll-depth distribution at 25%, 50%, 75%, 90%, and 100%;
- section-attention ranking;
- clicks by element, button, or link;
- traffic sources and allowed UTM dimensions;
- device categories: desktop, tablet, and mobile;
- browser and operating-system families at a low-cardinality level;
- domains/hosts used to reach the site, distinguishing the platform hostname from verified custom domains.

### 4.3 Filters

Support:

- presets: today, last 7 days, last 30 days, last 90 days;
- custom bounded date range;
- one page, multiple pages, or all pages;
- device category;
- published version (heatmaps only — see the correction in 8.2; traffic collections carry no version);
- hostname/domain;
- traffic source;
- local display timezone while all stored timestamps remain UTC.

Filter state must be represented in the URL query string so a view can be refreshed, bookmarked, and shared with another authorized workspace member.

### 4.4 Heatmaps

Provide three aggregate heatmap modes:

1. **Click/tap map** — click frequency on interactive and non-interactive areas.
2. **Scroll map** — percentage of sessions reaching each vertical depth.
3. **Attention map** — active visible time by section and coarse page region.

Heatmaps require exactly one page, one published version, and one device category. If the general filters contain multiple pages or versions, the UI must ask the user to narrow the selection before rendering a heatmap.

The overlay must use the exact immutable published-version snapshot. Never draw events from an older layout over the current layout.

**Correction, 2026-08-11 — see decision A-012.** The snapshot is rendered inside the dashboard by the
same component the renderer uses to produce published HTML, not inside an isolated frame. A frame
cannot work: published pages set `frame-ancestors 'none'`, and the site is a different origin from
the dashboard, so an overlay could not measure element geometry inside it. Relaxing that header for
every customer's published page to serve one dashboard tab is not a trade worth making. Rendering
in-app makes alignment hold by construction rather than by testing, and the existing preview route
is the working precedent.

Mouse movement is an optional second-stage enhancement. If implemented, aggregate it client-side into coarse cells at a low sampling frequency. Do not store exact cursor trails and do not imply that mouse movement is eye tracking.

### 4.5 Real-user technical performance

Add a **Technical performance** tab showing field data from actual visitors:

- Largest Contentful Paint (LCP);
- Interaction to Next Paint (INP);
- Cumulative Layout Shift (CLS);
- First Contentful Paint (FCP);
- Time to First Byte (TTFB).

Show p75 for LCP, INP, and CLS, split by mobile and desktop. Use current Core Web Vitals thresholds and explain good/needs-improvement/poor ratings. Do not report a passing score until the minimum sample threshold is met.

### 4.6 Responsive behavior

- Full dashboard analytics must work on desktop, tablet, and mobile.
- Charts stack and tables become horizontally contained on narrow screens.
- Heatmap inspection is available on mobile as a scaled read-only visualization; it does not edit the site.
- Never require hover to reveal essential data.

## 5. Measurement definitions

Use one documented metrics module shared by backend and frontend. Every label must have a tooltip/help definition.

| Metric | Definition |
|---|---|
| Page view (server) | One successfully rendered published route view, excluding known bots and previews. Counted by the renderer; unaffected by consent, ad blockers or disabled JavaScript |
| Page view (browser) | One `page_view` event received from the tracker. A subset of the server count; their ratio is the measurement coverage |
| Session | Anonymous activity grouped by a random first-party session ID; expires after 30 minutes of inactivity |
| Engaged time | Time while the page is visible and the visitor is not idle, accumulated from bounded heartbeats |
| Engaged session | At least 10 seconds of engaged time, two page views, or one meaningful interaction/conversion |
| Bounce | A session with one page view, under 10 seconds engaged, and no meaningful interaction |
| Scroll depth | Maximum percentage of scrollable document height reached during a page view |
| Section view | Section at least 50% visible for at least 1 continuous second |
| Section attention | Active visible milliseconds while the section meets the visibility threshold |
| CTA click | Click/tap on a rendered button or link with a stable element ID |
| Dead click | Repeated click/tap on a non-interactive area, using a conservative documented rule |
| Rage click | At least 3 clicks in a small area within 1 second, reported only as an aggregate count |
| Conversion | A configured meaningful event; initially form success or selected CTA clicks |

Store the definitions in `docs/ANALYTICS_METRICS.md` and expose concise versions in the UI.

## 6. Target architecture

```text
Published page
  |
  | GET /__wb/a.js                  self-hosted tracker
  | POST /__wb/events               same-origin batched events
  v
Renderer service
  | resolve Host -> workspace/project/version/page
  | validate, minimize, rate-limit, deduplicate
  v
MongoDB Atlas
  | raw events with short TTL
  | session summaries
  | hourly/daily rollups
  | heatmap bins
  | Web Vitals distributions
  v
Private authenticated API
  | enforce Better Auth + workspace membership + project scope
  v
Analytics dashboard
```

No external analytics API is required. The event endpoint lives on each published site's own origin, including custom domains, so no analytics CORS wildcard is needed.

The renderer derives `workspaceId`, `projectId`, active `publishedVersionId`, and `pageId` from the trusted hostname and resolved route. Never trust those identity fields from the browser payload.

## 7. Event contract

Create strict shared schemas for a versioned batched envelope.

### 7.1 Envelope

```ts
type AnalyticsBatchV1 = {
  schemaVersion: 1;
  batchId: string;
  sessionId: string;
  pageViewId: string;
  sentAt: string;
  events: AnalyticsEventV1[];
};
```

The server adds authoritative tenant/page/version identity and server receipt time.

**Correction, 2026-08-11.** `sentAt` orders events within a batch and is never stored. Only the
server's `receivedAt` is persisted, which removes the bounded-skew requirement in 7.3 rather than
implementing it. Deduplication is batch-level, keyed on `batchId`: 7.1 declares no per-event
identifier, so the per-event rule in 7.3 has nothing to key on. See decision A-013.

### 7.2 Allowed event types

- `page_view`;
- `engagement_heartbeat`;
- `page_leave`;
- `scroll_depth`;
- `section_visibility`;
- `element_click`;
- `page_region_click`;
- `form_success`;
- `web_vital`;
- optional `pointer_attention_bins` behind an explicit feature flag.

### 7.3 Payload limits

- maximum 50 events per batch;
- maximum 64 KiB decoded request body;
- UUID format validation for event, batch, session, and page-view IDs;
- client timestamps accepted only within a bounded skew window;
- string lengths and enums strictly bounded;
- normalized coordinates clamped to `[0, 1]`;
- duration and counter values clamped to documented maxima;
- duplicate event IDs ignored idempotently;
- unknown fields rejected.

### 7.4 Data minimization

Never collect:

- form values or field names that expose visitor content;
- selected text, keystrokes, clipboard content, or DOM text;
- passwords, emails, phone numbers, names, or submitted lead data;
- full URL query strings or fragments;
- full referrer paths from external sites;
- raw IP addresses in analytics collections;
- exact device fingerprints;
- dashboard/editor/preview activity;
- authentication or application cookies.

Allow only explicitly recognized UTM keys and strip all other query parameters before storage.

## 8. Data model and retention

All collections and useful indexes must start with `workspaceId` and `projectId` where applicable.

### 8.1 Collections

- `analyticsRawEvents`: minimized short-lived events for repair/reaggregation; TTL default 30 days.
- `analyticsSessions`: bounded session summaries; TTL default 90 days.
- `analyticsHourlyRollups`: time-series counts for recent charts; retention default 90 days.
- `analyticsDailyRollups`: long-term page/source/device totals; retention default 13 months.
- `analyticsSectionRollups`: section views and attention time by day/version/device.
- `analyticsClickBins`: normalized click/tap grid cells plus stable element counts.
- `analyticsScrollBins`: reached-session counts by depth bucket.
- `analyticsVitalSamples` or histograms: bounded samples/buckets for p50/p75/p95 field metrics.
- `analyticsConsentSettings`: site collection state, privacy mode, retention, disclosures, and conversion configuration.

Use atomic upserts and `$inc` for rollups. Avoid one unbounded document per project/day.

**Correction, 2026-08-11.** The shipped design uses six collections, not nine. `analyticsRawEvents`
is not built (A-008); `analyticsHourlyRollups` is not built, because the session collection answers
recent time-series directly; `analyticsClickBins`, `analyticsScrollBins` and
`analyticsSectionRollups` collapse into one `analyticsBins` collection with a `kind` discriminator,
identical in index and query shape at one third of the index maintenance; and
`analyticsVitalSamples` becomes fixed-edge histograms whose bucket edges sit exactly on the Core Web
Vitals thresholds, so the displayed p75 *rating* is exact while storage is independent of traffic.
A `analyticsBatches` collection is added for deduplication.

### 8.2 Published-version safety

Analytics history depends on immutable published versions. Never draw retained heatmap data over a
layout that did not produce it.

**Correction, 2026-08-11 — see decision A-011.** The dependency is inverted rather than implemented
as written. Retaining a version because analytics references it means a site that publishes daily
never prunes and accumulates hundreds of full document snapshots. Instead, heatmap bins are deleted
in the same operation that prunes their version, since coordinates against a deleted layout are
unrenderable anyway. Only `analyticsBins` carries a version; traffic, engagement and Web Vitals do
not, so those histories survive every publish and a performance trend never resets. Heatmap history
is therefore bounded by `PUBLISHED_VERSION_RETENTION_COUNT`, which is already operator-tunable.

### 8.3 Aggregation

**Superseded, 2026-08-11 — see decision A-007.** This section required a background aggregator in
the API process holding a MongoDB lease, with per-partition watermarks and repair from retained raw
events. It also contradicted section 6, which places ingestion in the renderer.

No aggregator is built. Every additive metric is an idempotent `$inc` upsert written at ingestion.
Session classification, the one non-additive family, is handled by mutating a single session
document with commutative operators only and deriving engagement and bounce at query time, so the
row is continuously self-correcting and there is nothing to repair.

Accepted cost: an aggregation bug cannot be repaired by replay, because no raw history is kept. The
mitigation is that aggregation is a pure function with no database dependency, unit-tested against
fixtures. Ceiling: roughly 30,000-50,000 sessions per day for a single site, at which point a
Mongo-leased roll-forward of closed sessions into daily counters is added without changing the
stored shape. Both are documented in `docs/ANALYTICS_OPERATIONS.md`.

## 9. Tracker behavior

The tracker must:

- be self-hosted by the renderer;
- load with `defer` and never block server-rendered content;
- stay within an agreed compressed performance budget;
- do nothing in editor or preview routes;
- generate random session/page-view IDs without fingerprinting;
- pause engagement time when `document.visibilityState !== "visible"`;
- pause after a documented idle period and resume on meaningful activity;
- use `IntersectionObserver` for section visibility;
- use passive scroll listeners and requestAnimationFrame throttling;
- batch events in memory;
- prefer `navigator.sendBeacon` on page hide and use `fetch(..., { keepalive: true })` fallback;
- retry transient failures with a strict cap and discard old batches rather than harming page performance;
- never throw an uncaught error into the customer's page;
- respect analytics-disabled state, consent choice, Global Privacy Control, and Do Not Track according to the documented product policy;
- collect Web Vitals using a pinned, bundled/self-hosted implementation rather than a third-party CDN.

The site must remain completely usable if the tracker or ingestion endpoint fails.

## 10. Privacy and consent

Analytics is disabled by default for existing projects until the owner reviews settings.

Add site settings for:

- analytics enabled/disabled;
- consent-required mode, default enabled;
- privacy-policy URL;
- bilingual consent copy inherited from the published-site locale;
- collection categories: essential aggregate traffic, interaction heatmaps, technical performance;
- retention period within platform limits;
- honor GPC/DNT;
- delete all analytics data;
- export aggregated data to CSV.

When consent is required, no analytics storage or events are created before affirmative consent. Store only the visitor's consent preference using the minimum necessary first-party mechanism. Declining must be as easy as accepting, and changing the choice must remain accessible.

Do not claim legal compliance automatically. Add an operator note requiring review for the jurisdictions in which each customer operates.

## 11. UI specification

### 11.1 Navigation

Add Analytics/Desempenho as a core site module on `SiteDashboard`, available for every site. It must not appear in the global workspace sidebar because analytics is scoped to a selected site.

The site route is:

```text
/app/:workspaceId/sites/:projectId/analytics
```

### 11.2 Page structure

```text
Analytics / Desempenho
├── Overview
├── Pages
├── Heatmaps
├── Technical performance
└── Settings
```

Keep one shared filter bar above the analytical tabs. Settings may use its own layout.

### 11.3 States

- **Disabled:** explain the feature and show an Enable analytics action.
- **Collecting:** enabled but insufficient sample; explain that real traffic is needed.
- **No data for filters:** collection exists but the chosen range has no events.
- **Ready:** charts and tables use real data.
- **Partial:** some metrics unsupported by the browser or below sample threshold.
- **Error:** preserve filters and offer retry; never substitute zeroes.

### 11.4 Heatmap viewer

- page selector;
- published-version selector with publish timestamp;
- device selector;
- mode selector: click, scroll, attention;
- exact rendered snapshot inside an isolated frame;
- colored aggregate overlay with legend;
- sample-size indicator;
- section/element detail on selection;
- empty and insufficient-sample states;
- CSV/PNG export may be implemented after the on-screen view, not instead of it.

### 11.5 Accessibility and i18n

- Implement all strings in `en-US` and `pt-BR`.
- Charts need text summaries, keyboard-accessible points or an equivalent data table, and non-color status labels.
- Heatmap colors need a legend and selectable table alternative.
- Announce loading/error/filter updates appropriately.
- Respect reduced motion.

## 12. API surface

Use authenticated endpoints under the existing same-origin API:

```text
GET    /api/v1/workspaces/:workspaceId/projects/:projectId/analytics/overview
GET    /api/v1/workspaces/:workspaceId/projects/:projectId/analytics/timeseries
GET    /api/v1/workspaces/:workspaceId/projects/:projectId/analytics/pages
GET    /api/v1/workspaces/:workspaceId/projects/:projectId/analytics/sections
GET    /api/v1/workspaces/:workspaceId/projects/:projectId/analytics/heatmap
GET    /api/v1/workspaces/:workspaceId/projects/:projectId/analytics/vitals
GET    /api/v1/workspaces/:workspaceId/projects/:projectId/analytics/settings
PATCH  /api/v1/workspaces/:workspaceId/projects/:projectId/analytics/settings
GET    /api/v1/workspaces/:workspaceId/projects/:projectId/analytics/export.csv
DELETE /api/v1/workspaces/:workspaceId/projects/:projectId/analytics/data
```

The public renderer owns only:

```text
GET  /__wb/a.js
POST /__wb/events
```

The CSV endpoint does not go through the shared JSON client, which parses every response body as
JSON; it needs its own download path.

Every dashboard endpoint must verify the Better Auth session and current workspace membership. Query filters must always include the authorized `workspaceId` and route `projectId`; a client-supplied workspace/project inside a body is ignored or rejected.

## 13. Implementation phases

**Correction, 2026-08-11.** This section contains 34 tasks, not the 38 stated in the goal command.
Five prerequisites were also found during planning that no task covers and that block later phases;
they are listed as P1-T0a through P1-T0e below.

### Phase 0 — Baseline and design freeze

- [x] **P0-T1 — Establish a clean branch and baseline**
  - Record `main`, `development`, current production tag, and the current deployment topology.
  - Run root install, typecheck, tests, build, E2E, and container smoke tests before edits.
  - Acceptance: pre-existing failures are recorded and no user work is overwritten.
  - Done on `feature/first-party-analytics` from `development@3223c7f`. Local `main` is stale at
    `b242f29`; `origin/main` is at `3223c7f`. Typecheck and tests green; one intermittent
    pre-existing failure recorded in the Progress Log. The production tag and live topology are
    not readable from this environment and are the `[!]` half of this task.

- [x] **P0-T2 — Write the architecture decision record**
  - Create `docs/adr/analytics-first-party.md` covering same-origin ingestion, privacy limits, version-bound heatmaps, retention, and no session replay.
  - Acceptance: unresolved choices are explicit before schemas are committed.
  - Written. The four privacy/legal choices are listed as open rather than assumed.

- [x] **P0-T3 — Define budgets and capacity assumptions**
  - Document tracker size, events per page view, maximum batch size, ingestion latency, dashboard query latency, raw retention, and initial supported monthly traffic.
  - Add a rough MongoDB storage formula and alert threshold.
  - Acceptance: the feature has measurable operational ceilings rather than “unlimited” claims.
  - Written to `docs/ANALYTICS_OPERATIONS.md`, each budget naming the test that enforces it.

### Phase 1 — Shared analytics contracts

- [x] **P1-T0a — Emit element identity on buttons and links**
  - `data-element-id` is currently emitted only for elements in `free`-layout sections, so most
    sections render anonymous elements. Wrapping is not available: a plain wrapper changes every
    flex/grid item, and `display: contents` removes the element from its parent's layout.
  - Emit it on the rendered button and anchor roots instead, and remove it from the positioning
    wrapper so nested duplicates cannot double-count. Coordinates plus `data-section-id` carry
    everything that is not a button or a link.
  - Acceptance: SSR tests prove a button carries its id in both `free` and non-`free` sections, and
    that no element carries two.

- [x] **P1-T0b — Emit page identity**
  - Nothing identifies a page in published HTML today. Add `data-page-id` to the page root as an
    overlay anchor and coordinate origin. It is not an identity claim: ingestion resolves the page
    server-side from the published route manifest.
  - Acceptance: SSR test asserts the attribute, and ingestion tests prove the value is not trusted.

- [x] **P1-T0c — Split the published-site CSP**
  - Keep the current policy for pages without the tracker and add a second policy with
    `script-src 'self'` and `connect-src 'self'` for pages that carry it.
  - Acceptance: a site with analytics disabled receives the original policy byte for byte; the
    analytics policy contains no `'unsafe-inline'` and no external origin, and keeps
    `frame-ancestors 'none'`.

- [x] **P1-T0d — Make published pages reachable from browser tests**
  - The E2E harness boots the API and the built frontend only; nothing serves published HTML, which
    blocks every browser test of the tracker, consent and accuracy.
  - Hoist the in-memory database into a shared setup both processes read, add a renderer web server,
    add a browser project that resolves `*.localhost` to loopback, and seed a published site.
  - Acceptance: a browser test loads a published page over the renderer and asserts its content.

- [x] **P1-T0e — Add the tracker size budget**
  - Add the tracker ceiling to the shared performance budgets and measure the built artefact.
  - Acceptance: the budget fails the build when exceeded, rather than living in prose.

- [x] **P1-T1 — Add strict shared schemas and metric definitions**
  - Add versioned event, filter, response, heatmap, vital, settings, and export schemas to `packages/shared`.
  - Add boundary and malformed-input tests.
  - Acceptance: frontend, renderer, and API use the same contracts.
  - Done in `packages/shared/src/analytics.ts`: event union, batch envelope, source and campaign
    allowlist, settings with defaults, dashboard and heatmap filters, engagement rules, and Core Web
    Vitals thresholds with histogram edges placed exactly on them. 25 boundary tests, including one
    asserting the envelope has nowhere to put a tenant identifier and one asserting no event can
    carry visitor text.

- [x] **P1-T2 — Add stable analytics markup**
  - Render stable `data-wb-page`, `data-wb-section`, `data-wb-element`, and element-kind attributes without exposing tenant secrets.
  - Preserve stable IDs across immutable published versions.
  - Acceptance: SSR tests prove expected IDs and no draft-only information leaks.
  - Covered by P1-T0a and P1-T0b. The existing `data-page-id`, `data-section-id` and
    `data-element-id` names are reused rather than adding a parallel `data-wb-*` set, which would
    double the identity markup on every published page to say the same thing twice.

### Phase 2 — Storage and aggregation

- [x] **P2-T1 — Add analytics repositories and indexes**
  - Implement the collections, TTL indexes, unique deduplication indexes, tenant-first query indexes, and bounded rollup partitioning.
  - Acceptance: index tests cover expiry, tenant scope, and idempotency.

- [x] **P2-T2 — Implement session and rollup aggregation**
  - Aggregate page views, engagement, bounce, scroll, sections, elements, sources, devices, hostnames, conversions, and vitals.
  - Write-time idempotent upserts with commutative operators only; no lease, no watermark, no raw
    event store (A-007, A-008). Aggregation is a pure function with no database dependency.
  - Acceptance: replaying the same batch does not double-count, and the arithmetic is proven by
    fixture tests that never touch a database.

- [ ] **P2-T3 — Bind heatmap data to version lifetime**
  - Delete a version's bins in the same operation that prunes the version (A-011). Only spatial data
    carries a version; traffic, engagement and vitals survive every publish.
  - Acceptance: pruning a version removes its bins and no other project's; a rollback to a retained
    version still renders its heatmap; a failed cleanup never fails a publish.

### Phase 3 — Public tracker and ingestion

- [ ] **P3-T1 — Build and self-host the tracker**
  - Produce a separately built browser asset with no external runtime dependency.
  - Serve it from a generated source constant, not the filesystem: the backend bundles its sources,
    so reading a sibling asset works in development and fails in the built image. Commit the
    generated constant with a test that rebuilds and asserts byte-identity.
  - Serve it before the published-page catch-all with immutable caching when versioned.
  - Inject only into eligible published pages.
  - Update CSP to allow only self-hosted script and connections.
  - Acceptance: published pages work with JavaScript disabled and tracker failure is non-fatal.

- [ ] **P3-T2 — Implement page, engagement, scroll, section, and click collection**
  - Implement the behavior in Section 9 with client-side batching and coarse coordinates.
  - Add desktop, tablet, mobile, hidden-tab, idle, short-page, no-scroll, and bfcache tests.
  - Acceptance: automated browser tests produce the expected bounded event sequence.

- [ ] **P3-T3 — Implement Web Vitals collection**
  - Pin and bundle the official `web-vitals` package or an equivalently tested local implementation.
  - Collect LCP, INP, CLS, FCP, and TTFB without blocking rendering.
  - Acceptance: supported metrics arrive with device/page/version identity and unsupported cases remain absent, not zero.

- [ ] **P3-T4 — Implement same-origin ingestion**
  - Resolve host and route before accepting events; add strict validation, deduplication, rate limiting, bot filtering, body limits, and generic errors.
  - Never log request payloads or raw identifiers.
  - Acceptance: spoofed tenant IDs, unknown hosts, malformed batches, oversized bodies, replayed events, and abuse cases are rejected safely.

### Phase 4 — Privacy controls

- [ ] **P4-T1 — Implement site analytics settings**
  - Add disabled-by-default settings, collection categories, retention, consent mode, policy link, and conversion configuration.
  - Acceptance: settings are tenant-scoped, audited, validated, and reflected in newly published output.

- [ ] **P4-T2 — Implement consent behavior**
  - Add accessible bilingual accept/decline/manage controls when required.
  - Ensure zero pre-consent events/storage beyond the essential consent preference.
  - Respect decline, withdrawal, GPC, and the documented DNT policy.
  - Acceptance: browser tests verify each consent state and withdrawal stops future collection.

- [ ] **P4-T3 — Add deletion and export**
  - Export aggregated analytics as CSV with filters and metadata definitions.
  - Delete all project analytics using a typed confirmation. Deletion is synchronous and
    tenant-scoped: there is no background infrastructure, and adding one for a delete would be a
    subsystem built to avoid a bounded `deleteMany`.
  - Acceptance: deletion cannot target another project and removes raw, rollup, session, heatmap, and snapshot data.

### Phase 5 — Authenticated analytics API

- [ ] **P5-T1 — Implement overview and timeseries queries**
  - Add bounded date filters, page multi-select, comparison period, device, hostname, source, and version filters.
  - Acceptance: queries use indexes, enforce membership, and meet the latency budget on seeded scale data.

- [ ] **P5-T2 — Implement page, section, click, and heatmap queries**
  - Return aggregate bins and stable element/section metadata, never raw visitor trails.
  - Require one page/version/device for visual heatmaps.
  - Acceptance: incompatible filters produce a typed validation response rather than misleading data.

- [ ] **P5-T3 — Implement Web Vitals queries and ratings**
  - Calculate p50/p75/p95 and current threshold ratings by page/device.
  - Enforce a documented minimum sample threshold.
  - Acceptance: percentile tests use deterministic fixtures and insufficient samples are explicit.

### Phase 6 — Dashboard UI

- [ ] **P6-T1 — Add the route and contextual navigation**
  - Add the analytics route and an Analytics/Desempenho core-site link.
  - Do not add it as a global workspace module.
  - Acceptance: authorized deep links work, unauthorized access fails, and mobile navigation remains usable.

- [ ] **P6-T2 — Build shared filters and overview**
  - Implement URL-synchronized filters, KPI definitions, comparison states, time-series charts, device/source breakdowns, and truthful empty states.
  - Acceptance: one/multiple/all-page filtering and date comparison work in unit and E2E tests.

- [ ] **P6-T3 — Build page and section analysis**
  - Add sortable page table, scroll distribution, section attention, CTA clicks, form success, and conversion indicators.
  - Acceptance: labels resolve stable IDs to the selected published-version names without leaking deleted draft content.

- [ ] **P6-T4 — Build the heatmap viewer**
  - Render the correct immutable version snapshot and overlay click, scroll, and attention aggregates.
  - Provide accessible table fallback and mobile read-only inspection.
  - Acceptance: changing page/version/device reloads compatible bins; layout alignment tests pass at supported breakpoints.

- [ ] **P6-T5 — Build technical performance**
  - Show p75 Core Web Vitals, thresholds, trends, device split, sample size, and pages needing attention.
  - Acceptance: no unsupported or insufficient metric is shown as zero or passing.

- [ ] **P6-T6 — Build analytics settings**
  - Implement enable/disable, consent, disclosure, retention, conversions, export, and destructive deletion flows.
  - Acceptance: destructive actions require typed confirmation and settings are fully bilingual.

### Phase 7 — Integration and operational readiness

- [ ] **P7-T1 — Connect the workspace overview to site analytics**
  - **Reworded 2026-08-11.** The placeholder this task described no longer exists; restoring
    `not_connected` behaviour would be a regression. The workspace overview already shows measured
    server-counted traffic.
  - Link its traffic rows to the per-site analytics route, and label server-counted versus
    browser-measured views wherever both appear.
  - Acceptance: the workspace overview never fabricates zero traffic, and never presents the browser
    subset as the whole.

- [ ] **P7-T2 — Add observability without visitor leakage**
  - Add aggregate ingestion rate, rejected batches, queue/aggregation lag, storage size, query latency, and error metrics.
  - Do not include event payloads, session IDs, or visitor identifiers in logs.
  - Acceptance: operators can detect failure without inspecting visitor behavior.

- [ ] **P7-T3 — Add production environment controls**
  - Add documented variables for feature enablement, retention limits, sampling, rate limits, batch limits, aggregation interval, and optional anonymous-ID secret.
  - Keep them inside the existing API/renderer services; no new public port or domain.
  - Acceptance: Compose validation and secret-placement tests pass.

- [ ] **P7-T4 — Write documentation**
  - Create `docs/ANALYTICS.md`, `docs/ANALYTICS_METRICS.md`, `docs/ANALYTICS_PRIVACY.md`, and `docs/ANALYTICS_OPERATIONS.md`.
  - Update README, roadmap, environment examples, operations, and deployment docs.
  - Acceptance: docs explain collection, definitions, consent, retention, capacity, troubleshooting, backup, deletion, and rollback.

### Phase 8 — Verification, staging, and release

- [ ] **P8-T1 — Security and tenant-isolation suite**
  - Prove cross-workspace/project reads and deletes fail.
  - Prove browser-supplied tenant IDs cannot redirect ingestion.
  - Test hostname spoofing, forwarded-host rules, payload abuse, rate limits, and log redaction.
  - Acceptance: all security tests pass.

- [ ] **P8-T2 — Accuracy suite**
  - Use deterministic browser journeys for page views, multi-page sessions, idle/hidden time, scroll thresholds, sections, clicks, forms, consent, and vitals.
  - Compare emitted events, stored data, rollups, API responses, and UI values end-to-end.
  - Acceptance: every displayed number traces to known fixture events.

- [ ] **P8-T3 — Performance and capacity suite**
  - Measure tracker size and impact, page Lighthouse/lab delta, ingestion throughput, Mongo growth, aggregation lag, and dashboard query latency.
  - Run concurrent event batches and verify rate limiting/backpressure.
  - Acceptance: documented budgets pass or the rollout is reduced/sampled before release.

- [ ] **P8-T4 — Complete root verification**
  - Run root typecheck, tests, build, E2E, runbook checks, deployment-config tests, Docker builds, and container smoke tests.
  - Acceptance: every command passes without suppressing failures.

- [ ] **P8-T5 — Stage with synthetic traffic**
  - Deploy from `development` with a separate database/site.
  - Generate desktop/mobile visits across multiple pages and versions.
  - Verify heatmap alignment, consent, retention, deletion, custom-domain ingestion, and Web Vitals.
  - Acceptance: staging evidence and screenshots contain no secrets or real visitor data.

- [ ] **P8-T6 — Controlled production rollout**
  - Release disabled by default behind a server-controlled feature flag.
  - Enable for one internal test site, observe ingestion/storage/query health, then expand deliberately.
  - Do not alter the existing Coolify domains or add a service.
  - Acceptance: production smoke checks pass and rollback is documented.

## 14. Test matrix

At minimum, cover:

- platform subdomain and custom domain;
- home page and non-home page;
- desktop, tablet, and mobile;
- page with and without scroll;
- page with repeated section/element names but unique IDs;
- new publish version after traffic exists;
- rollback to an older published version;
- JavaScript disabled;
- tracker blocked;
- ingestion unavailable;
- consent accepted, declined, withdrawn, and not answered;
- hidden tab and idle visitor;
- bfcache restore and duplicate page events;
- known bot and aggressive event sender;
- unknown hostname;
- workspace member and non-member;
- zero data, insufficient data, ready data, and partial browser support;
- English and Portuguese UI;
- UTC storage across daylight-saving/timezone boundaries.

## 15. Performance budgets

Finalize exact values in P0-T3. Initial ceilings:

- tracker JavaScript: target <= 8 KiB Brotli, hard ceiling 15 KiB;
- no synchronous script and no third-party request;
- event batch <= 64 KiB and <= 50 events;
- pointer events never sent one request per movement;
- tracker main-thread work p95 <= 2 ms per callback on target devices;
- no measurable CLS caused by analytics or consent UI;
- ingestion p95 <= 200 ms before durable acceptance at expected initial load;
- overview query p95 <= 500 ms for 90 days;
- heatmap query p95 <= 1 second for one page/version/device;
- analytics failures never make a published page unavailable.

## 16. Definition of Done

The feature is complete only when:

- published pages collect only enabled, consent-permitted first-party analytics;
- no form content, typed text, full IP, credential, or raw replay is stored;
- the renderer authoritatively resolves tenant/page/version identity;
- analytics is isolated by workspace and project;
- page views, sessions, engagement, bounce, scroll, sections, clicks, conversions, sources, devices, hostnames, and Web Vitals are accurate against fixtures;
- dashboard filters support all, one, or multiple pages;
- heatmaps enforce one page/version/device and align to the exact immutable snapshot;
- technical performance uses real-user p75 metrics and sample thresholds;
- UI is responsive, accessible, and complete in English and Portuguese;
- disabled, collecting, no-data, partial, ready, and error states are truthful;
- retention, export, and deletion work across every analytics collection;
- tracker and ingestion failures do not break customer sites;
- no new Coolify resource, public domain, or external analytics provider is required;
- root verification, security, accuracy, performance, container, staging, and production smoke checks pass;
- every task is `[x]`, except genuine user-only steps documented as `[!]`.

## 17. Explicitly deferred

- A/B and multivariate experiments;
- session replay or video-like playback;
- raw cursor trails;
- advertising pixels and cross-site attribution;
- Google Analytics/Tag Manager synchronization;
- external CRM or calendar integrations;
- AI-generated recommendations;
- cohort/funnel builder beyond the initial fixed conversion metrics;
- revenue attribution;
- public share links for analytics reports.

## 18. Progress Log

Append entries; do not erase history.

| Date/time | Task | Commit | Verification | Result/notes |
|---|---|---|---|---|
| 2026-08-11 | Plan created | n/a | Repository audit at `main@0d116a9` | Awaiting execution |
| 2026-08-11 | P0-T1 baseline | n/a | `npm run typecheck && npm run test` on `development@3223c7f` | Green: 495 shared, 448 backend, 486 frontend. One intermittent failure recorded: `backend/tests/media-api.test.ts` "accepts an image and returns WebP variants" fails occasionally under full-suite load and passes in isolation (Sharp under memory pressure). Pre-existing, unrelated to analytics. Production tag and live topology are `[!]` — no production access. |
| 2026-08-11 | P0-T2 ADR | n/a | `docs/adr/analytics-first-party.md` written | Eight decisions recorded; four privacy/legal choices left explicitly open |
| 2026-08-11 | P0-T3 budgets | n/a | `docs/ANALYTICS_OPERATIONS.md` written | Budgets, per-page-view event count, storage formula with a worked example, alert threshold, scale ceiling and its replacement |
| 2026-08-11 | P1-T1/P1-T2 contracts | `052547e` | `npx vitest run packages/shared/src/analytics.test.ts` | 25 tests |
| 2026-08-11 | P2-T1/P2-T2 storage and aggregation | n/a | `npx vitest run backend/tests/analytics-{aggregate,repository}.test.ts` | 37 tests: 17 fixture tests of the arithmetic with no database, 20 against a real MongoDB covering index shape, retention ordering, deduplication, tenant isolation and version lifetime |
| 2026-08-11 | P1-T0a..e prerequisites | n/a | `npm run typecheck && npm run test && npm run build && npm run test:e2e` | 1436 unit tests and 28 E2E green, including a new `published-site` browser project. Two pre-existing defects found and fixed: elements outside free-layout sections carried no id at all, and the renderer could not run under `tsx` because the frontend components it renders were outside the backend tsconfig's `include` — so `npm run dev:renderer` had never served a page. |

## 19. Decision Log

Append decisions; do not erase history.

| ID | Date | Decision | Reason | Consequences |
|---|---|---|---|---|
| A-001 | 2026-08-11 | Build first-party analytics | The product needs integrated site/page insights without requiring a customer-owned external provider | Tracker, ingestion, storage, and dashboard are owned by WebsiteBuilder |
| A-002 | 2026-08-11 | Use same-origin renderer ingestion | Works for platform and customer domains without broad CORS or a public API hostname | Renderer accepts only bounded analytics endpoints before its page catch-all |
| A-003 | 2026-08-11 | Bind heatmaps to immutable versions | Coordinates are meaningless after a layout changes | Analytics snapshots must outlive compatible heatmap retention |
| A-004 | 2026-08-11 | No session replay in this release | Replay greatly increases privacy, storage, masking, and security complexity | Aggregate click, scroll, and attention maps only |
| A-005 | 2026-08-11 | Keep analytics disabled by default | Existing published sites did not disclose or consent to tracking | Owners must review settings before collection starts |
| A-006 | 2026-08-11 | Preserve the current deployment topology | Analytics can run through existing renderer/API services | No new Coolify resource, domain, or public port |
| A-007 | 2026-08-11 | Write-time aggregation with query-time derivation; no scheduler, lease or watermark | The backend has no scheduler, queue, worker or lease; adding one is a subsystem. Every additive metric is an idempotent `$inc`, and session rows are self-correcting under commutative operators | Ceiling ~30-50k sessions/day/site, documented; replacement is a leased roll-forward of closed sessions into daily counters with no schema change |
| A-008 | 2026-08-11 | No raw event store | Its only stated purpose was feeding a repair job that no longer exists, and it would be the largest privacy surface and the hardest data to export and delete | An aggregation bug is unrecoverable for data already collected; mitigated by aggregation being a pure, fixture-tested function |
| A-009 | 2026-08-11 | Keep server-side view counting as the always-on baseline | It survives ad blockers, disabled JavaScript and declined consent, stores no identifier, and already ships to every customer | Two page-view numbers, labelled server-counted and browser-measured; their ratio is the coverage indicator and a correctness oracle (server >= browser, always) |
| A-010 | 2026-08-11 | Relax the CSP only on pages that carry the tracker | Analytics is disabled by default, so no existing customer's policy should change | Two policy constants; a disabled site keeps `script-src 'none'` byte for byte |
| A-011 | 2026-08-11 | Delete heatmap bins with their version | Retaining versions for analytics means a daily publisher never prunes and accumulates hundreds of document snapshots | Heatmap history is bounded by `PUBLISHED_VERSION_RETENTION_COUNT`; traffic, engagement and vitals carry no version and survive every publish |
| A-012 | 2026-08-11 | Render heatmap snapshots in-app, not in a frame | `frame-ancestors 'none'` blocks framing, and a cross-origin frame cannot be measured for overlay alignment | The dashboard shares the renderer component, so alignment holds by construction; no security header is weakened |
| A-013 | 2026-08-11 | Batch-level deduplication; never store a client clock | The envelope declares no per-event identifier, and a client timestamp would require a skew window to defend | One insert per batch before any counter write; a client that re-partitions events into a new batch id could double-count, and the tracker does not |
| A-014 | 2026-08-11 | pt-BR label is "Análises", not "Desempenho" | "Desempenho" collides with this module's own technical-performance tab and with the pre-publish audit's performance category | English label stays "Analytics" |

## 20. Primary references

- Core Web Vitals and p75 evaluation: `https://web.dev/articles/vitals`
- Official Web Vitals library: `https://github.com/GoogleChrome/web-vitals`
- Analytics session model: `https://support.google.com/analytics/answer/9191807`
- PostHog heatmap categories: `https://posthog.com/docs/toolbar/heatmaps`
- Microsoft Clarity heatmap overview: `https://learn.microsoft.com/en-us/clarity/heatmaps/heatmaps-overview`
- Microsoft Clarity attention maps: `https://learn.microsoft.com/en-us/clarity/heatmaps/attention-maps`
- ICO cookie and similar-technology guidance: `https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/`

