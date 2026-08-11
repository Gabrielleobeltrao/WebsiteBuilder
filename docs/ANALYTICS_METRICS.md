# What each number means

Written down once and shared: the rules below live in `packages/shared/src/analytics.ts`, which the
tracker, the ingestion endpoint, the query layer and the dashboard all import. Two products' "bounce
rate" can differ by a factor of two; this is what ours means.

| Metric | Definition |
|---|---|
| Page view (server) | One successfully rendered published route, counted by the renderer. Excludes known crawlers. Unaffected by consent, blockers or disabled JavaScript. |
| Page view (browser) | One `page_view` event received from the tracker. A subset of the above. |
| Measurement coverage | Browser views ÷ server views. How much of the traffic the rest of this dashboard describes. |
| Visit (session) | Activity grouped by a random identifier stored on the visitor's own device, renewed after **30 minutes** of inactivity. Not a person, and never labelled as one. |
| Engaged time | Time while the page was visible and the visitor was not idle, accumulated from bounded heartbeats. A hidden tab and an idle visitor both stop it. |
| Engaged visit | At least **10 seconds** of engaged time, **or** a second page view, **or** one interaction. |
| Bounce | A single page view, under 10 seconds engaged, and no interaction. The exact complement of engaged for a one-page visit — asserted by a test, so a visit can never be reported as both. |
| Scroll depth | The deepest of 25 / 50 / 75 / 90 / 100 % reached during a page view. Each depth counts once per view. |
| Section view | A section at least **50 %** visible for at least **one continuous second**. |
| Section attention | Milliseconds a section spent meeting that visibility threshold while the page was visible. |
| Click | One physical click or tap. Counted from the page-region event, so a click on a button is one click and not two. |
| Element click | A click whose target carries a stable element identifier — buttons and links. |
| Web Vital | LCP, INP, CLS, FCP or TTFB, measured by the pinned `web-vitals` library on the visitor's own device. |
| p75 | The 75th percentile of a metric's distribution, read from a histogram. Reported only above **50 samples**. |
| Rating | Good / needs improvement / poor, against the current Core Web Vitals thresholds. |

## Thresholds

| Metric | Good | Poor |
|---|---|---|
| LCP | ≤ 2500 ms | > 4000 ms |
| INP | ≤ 200 ms | > 500 ms |
| CLS | ≤ 0.1 | > 0.25 |
| FCP | ≤ 1800 ms | > 3000 ms |
| TTFB | ≤ 800 ms | > 1800 ms |

Samples are counted into histogram buckets rather than stored individually, so storage does not grow
with traffic. Bucket edges sit **exactly on** the two thresholds, which means the p75 *value* is
known to within one bucket width while the p75 *rating* — what the dashboard shows — is exact.

## What is deliberately not measured

- **Unique people.** Nothing here identifies a person across visits, so nothing claims to.
- **Form submissions and conversions.** No form element exists in the builder, so no published page
  can contain one and the metric could never be anything but zero.
- **Session replay.** Out of scope, and not a deferred promise.
- **Mouse movement.** Not collected. It is not attention and it is not eye tracking.

## Comparison periods

The previous equal-length window is offered only where it can still hold data. Sessions are kept 90
days, so a 90-day view has no comparable predecessor and says so rather than reporting a collapse in
traffic that never happened. View counts, which are kept 400 days, compare further back.
