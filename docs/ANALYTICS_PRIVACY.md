# Privacy

What is collected from a visitor to a published site, what is not, and what a site owner controls.

**This document describes behaviour, not compliance.** Whether that behaviour satisfies the law where
a given customer operates is a decision for whoever runs this platform, taken per jurisdiction. The
product does not claim compliance and must not be configured as though it does.

## What is collected

Only from a site whose owner enabled measurement, and — where consent is required — only after a
visitor accepts:

- a random session identifier, generated on the device, stored under the site's own origin, expiring
  after 30 minutes of inactivity;
- a random identifier per page view and per batch, both discarded after aggregation;
- the path of a published page, resolved server-side against what was actually published;
- counters: page views, engaged milliseconds, interactions, scroll depths reached;
- a coarse device category derived from **viewport width**;
- the **host** a visitor arrived from, and recognised campaign parameters (`utm_source`,
  `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`);
- normalised click coordinates, stored as a cell in a 40 × 60 grid;
- section identifiers the site itself assigned, with visible time;
- Core Web Vitals values.

## What is never collected

- form values, field names, typed text, selections or clipboard contents;
- names, email addresses, phone numbers or any submitted data;
- full URLs, query strings or fragments — the tracker sends `location.pathname` alone;
- referrer paths; only the host;
- IP addresses. The address is used, in memory, as a rate-limit key and is never written anywhere;
- User-Agent strings;
- device fingerprints of any kind;
- authentication or application cookies;
- anything at all from the editor, the dashboard, or a preview.

The event schema has no field free text could arrive in — every event is a counter, an identifier the
site assigned, or a coordinate — and a test asserts it.

## What a visitor controls

- **Consent.** When the site requires it, nothing is collected and nothing is stored before an
  affirmative answer — not a session identifier, not a sampling decision. Declining is the same
  control, the same size, in the same place as accepting.
- **Withdrawal.** The choice is remembered and can be changed; a refusal is not re-asked on the next
  page load.
- **Browser signals.** Where the site honours them, Global Privacy Control and Do Not Track are
  treated as a refusal, and no prompt is shown.
- **Blocking.** A blocked or failed tracker collects nothing and breaks nothing.

Server-side view counting continues in all of these cases. It stores a page, a day and a number: no
identifier, no address, no device, nothing that could be traced to a visit.

## What a site owner controls

Analytics → Settings, per site:

- measurement on or off — **off by default**;
- consent required or not — **required by default**;
- honouring browser privacy signals — **on by default**;
- the privacy-policy address shown beside the prompt;
- retention: 30, 90, 180 or 400 days;
- categories: visits and engagement, interaction maps, loading performance;
- deletion of everything measured, confirmed in a dialog.

Deletion removes sessions, daily counters, heatmap bins, Web Vitals **and** server-counted views. A
customer asking to delete their analytics means all of it.

## Retention

| Data | Kept |
|---|---|
| Batch identifiers (deduplication) | 2 hours |
| Sessions | 90 days |
| Daily counters, Web Vitals, server views | 400 days |
| Heatmap bins | As long as the published version they describe |

Expiry is enforced by the database, not by a job that could fail to run.

## Open decisions

These are recorded as unresolved rather than assumed, and the implementation carries whichever way
they are decided:

- whether consent should be required by default in every market this platform serves;
- the precise policy for Global Privacy Control and Do Not Track;
- the default retention offered to customers;
- the wording of the consent disclosure, and which jurisdictions are claimed.
