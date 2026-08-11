# ADR: First-party analytics for published sites

- Status: accepted
- Date: 2026-08-11
- Baseline: `development@3223c7f`
- Specification: `ANALYTICS_IMPLEMENTATION_PLAN.md`

## Context

The platform measures published traffic on the server: the renderer writes a daily counter per
`{workspace, project, path}` after serving a real route, and the workspace overview reads it. That
answers *how many people arrived*. It cannot answer how far they scrolled, what they clicked, or
whether the page was fast for them, because nothing the platform controls runs in the visitor's
browser.

Published pages carry `script-src 'none'`. The comment above that constant states its own purpose:
*"If a script is ever added to public output, this line is what will refuse it until someone argues
for the change."* This document is that argument.

The alternative — telling customers to paste a third-party snippet — was rejected. It would move
their visitors' behaviour to a company neither they nor we chose, on a page we render, under a
policy we would have to widen to `script-src https:` for every site whether or not it uses one.

## Decisions

### 1. Ingestion is same-origin, on the renderer

The tracker posts to `/__wb/events` on the site's own hostname. The renderer already resolves that
hostname to a tenant on every request, so the identity of the data is a property of the connection
rather than a claim in the payload. Custom domains work with no additional configuration, and there
is no CORS allowance to widen — the endpoint accepts only `application/json`, which a cross-origin
browser cannot send without a preflight the renderer never answers.

The alternative, a shared analytics hostname, would require permissive CORS and would make every
customer's traffic identifiable by a third party watching DNS.

### 2. The CSP relaxation is conditional

Two policies exist. A site without analytics enabled receives the current one, byte for byte, with
`script-src 'none'`. Only a page that actually carries the tracker receives `script-src 'self';
connect-src 'self'`. Neither permits an external origin or an inline script.

This matters because analytics is disabled by default: on the day this ships, no existing customer's
policy changes.

### 3. Identity is derived by the server, never accepted from the browser

`workspaceId` and `projectId` are absent from the event schema entirely — a field that does not exist
cannot be spoofed. `pageId` comes from resolving the reported path against the published route
manifest, and a path that is not a published route is discarded rather than stored. This is the same
rule that keeps server-side view counting bounded: request paths are attacker-controlled, so counting
them directly would let anyone create unlimited rows in a customer's workspace.

The published version is the one exception: the browser reports which version it is running, because
the active pointer may have moved after the page loaded, and attributing a visitor's clicks to a
layout they never saw is precisely the stale-overlay problem heatmaps must avoid. The hint is
accepted only when the version document exists, and falls back to the active version otherwise.

### 4. No raw event store, and no scheduler

The specification called for a raw-event collection with a background aggregator holding a
distributed lease and repairable watermarks. The backend has no scheduler, queue, worker or lease of
any kind, and adding one is a subsystem, not a feature.

It is also unnecessary. Every additive metric — views, clicks, scroll buckets, section attention,
vitals — is an idempotent `$inc` upsert at write time. The one family that is not additive is session
classification, because a session that is bouncing at second 5 has stopped bouncing at second 11.
Rather than decrement counters (where double-counting bugs live), one document per session is
mutated only by commutative operators, and engagement and bounce are derived at query time. The
session row is continuously self-correcting, so there is nothing to repair.

**Accepted cost:** an aggregation bug cannot be repaired by replaying history, because no history is
kept. The mitigation is placement — aggregation is a pure function with no database dependency,
tested against fixtures — not a replay log. Keeping raw per-visitor events would also be the largest
privacy surface in the product and the hardest thing to export and delete correctly.

**Ceiling:** the session query is proportional to sessions in the window and exceeds the 500 ms
overview budget at roughly 30,000–50,000 sessions per day for a single site. The replacement is
known and purely additive: a Mongo-leased roll-forward that folds closed sessions into daily
counters, with no change to the stored shape.

### 5. Heatmap data is deleted with the version it describes

Coordinates only mean something against the layout that produced them. The specification asked to
retain a published version because analytics references it; done that way, a site that publishes
daily would never prune and would accumulate hundreds of full document snapshots.

The dependency is inverted: when a version is pruned, its bins go with it. Only spatial data carries
a version — traffic, engagement and Web Vitals do not, so a performance trend never resets on
publish. Heatmap history is therefore bounded by `PUBLISHED_VERSION_RETENTION_COUNT`, which is
already an operator-tunable variable.

### 6. Heatmap snapshots render in the dashboard, not in a frame

The specification asked for the published page inside an isolated frame. Published pages set
`frame-ancestors 'none'`, and the site is a different origin from the dashboard, so an overlay could
not measure element geometry inside it. The snapshot is rendered by the same component the renderer
uses to produce the published HTML, so alignment holds by construction rather than by testing, and
no security header is weakened for a dashboard feature.

### 7. Server-counted and browser-measured views are both shown

They will never agree: server counting survives ad blockers, disabled JavaScript and a declined
consent prompt; browser measurement does not. Presenting one number would mean either hiding the
truthful floor or claiming the measured subset is the whole.

Both are shown and labelled, and their ratio is reported as measurement coverage — which is also a
correctness oracle: the server count is always greater than or equal to the browser count, and a
violation means ingestion is double-counting.

### 8. No session replay

Replay would multiply the privacy surface, the storage cost, the masking burden and the breach
consequence, to answer questions aggregate click, scroll and attention maps already answer. It is
out of scope for this release and is not a deferred commitment.

## Open — requires a decision that is not an engineering one

These are recorded as blocked rather than assumed:

- whether consent is required by default, and in which jurisdictions the product claims anything;
- the policy for Global Privacy Control and Do Not Track signals;
- the default retention period offered to customers;
- the wording of the consent disclosure and the privacy-policy link.

The implementation supports each of these as configuration. Nothing here decides them, and the
product must not claim legal compliance automatically.
