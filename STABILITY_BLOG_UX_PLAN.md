# Stability, Blog Workflow, and Dashboard UX Plan

## 1. Execution contract

- Repository: `https://github.com/Gabrielleobeltrao/WebsiteBuilder.git`
- Work only on branch `development`. Never merge or push to `main`, deploy, seed a real database, or change a real `.env` while executing this plan.
- Audited baseline: `a22ccde7fbb278a94c6fe7d3f06a8f28aa49d10d` on 2026-09-03. Re-fetch and record drift before the first edit; do not discard unrelated work.
- The existing `IMPLEMENTATION_PLAN.md` is the completed Forms plan and remains historical evidence. This file is authoritative for the work below.
- Execute exactly one task at a time. Extract it with:

  ```bash
  node .claude/skills/execute-plan-task/scripts/extract-plan-task.mjs <TASK-ID> --plan STABILITY_BLOG_UX_PLAN.md
  ```

- Mark only the active task `[~]`. Mark it `[x]` only after its acceptance criteria and verification pass. Use `[!]` only for owner-only credentials, production access, or an irreversible decision.
- Append one Progress Log row after every completed task and a Decision Log row only when implementation materially deviates from this plan.
- Commit completed tasks independently with English commit messages. Push only `development`, and only after the task gates pass. Do not commit transient logs, secrets, generated build output, or local environment files.
- Preserve tenant scoping, optimistic concurrency, immutable published snapshots, the shared renderer/compiler, desktop-only authoring, and clean Desktop/Tablet/Mobile preview.
- Do not delete or recreate an old project as a repair. Diagnose and migrate it safely. A fresh project may be used only as a comparison fixture.
- User-facing copy must exist in both `pt-BR` and `en-US`; code, tests, commits, and technical documentation remain in English.

## 2. Audited baseline and verification

- `origin/development` is at `a22ccde`; `origin/main` is at `849c02b`. Development contains two newer commits concerning blog post fields and development ports.
- Working tree was clean after fetching the current branch.
- `npm run typecheck`: passed for shared, backend, and frontend.
- `npm run test -w packages/shared -- --run`: 665 tests passed in 39 files.
- `npm run test -w frontend -- --run`: 769 tests passed in 64 files.
- `npm run build`: passed. Vite still reports a main entry chunk of about 586 kB raw / 180 kB gzip, above its default 500 kB warning threshold.
- The complete backend suite could not be certified in the audit environment: MongoDB Memory Server 8.2.6 exited with code 100 and `open: Operation not permitted`. Treat this as an environment blocker, not as a passing backend result. Use a permitted MongoDB runtime, Docker, or CI for backend integration and E2E gates.
- Existing green tests do not cover the reported legacy journey: edit text in an old document, autosave, reload, preview, publish, and load the public route.

## 3. Confirmed findings

### Critical correctness

1. The shared editor store can retain a `blogTemplate` target after returning to a normal project because `loadFromProject` does not restore the project target. A later site save can be sent to the blog-template endpoint.
2. Blog template save always sends `fieldDefinitions: []`. Loading and saving an existing template can erase its field definitions.
3. Template conflict recovery calls the normal project loader instead of reloading the conflicted template.
4. Template publish calls save first, but save catches failures internally and returns no success result. Publish can continue after a failed or conflicted save and promote an older draft.
5. Template and post actions are labelled as publishing live content, but the public renderer serves the immutable site snapshot. Changes are actually live only after a successful site publish. The UI and backend comments currently promise two incompatible publication models.

### Legacy and rendering risk

1. Element migration traverses page sections and nested container children but omits `sharedSections`.
2. Responsive migration omits `sharedSections` and nested container children.
3. Published responsive CSS is compiled only for top-level section elements, while nested container children are rendered. Nested layout/style overrides therefore lack matching compiled rules.
4. Project records are trusted after MongoDB reads; there is no single runtime parse/normalize boundary with a diagnostic report for older documents.
5. A blog enabled before template IDs existed can lazily create templates, but the settings are not backfilled with their IDs. Site status can remain blocked even after the templates exist.

These are credible paths for the reported old-site failure, but the exact cause must be proven from a redacted copy of the affected document or a fixture derived from it before declaring the incident fixed.

### Blog model gaps

1. The post authoring screen is correctly a form for title, slug, excerpt, cover, body, author, and SEO, but `PostEditorRoute` does not load or pass template field definitions.
2. Custom field values are not included in `PublishablePost`, and the public renderer has no end-to-end custom-field binding context. The current custom-field scaffolding is not a complete user feature.
3. The block registry gives most page blocks the generic `blogTemplate` context. Article and index templates therefore offer unrelated blocks instead of focused, kind-specific choices.
4. Template preview opens the ordinary site preview rather than a representative blog index or article using the template being edited.

### Information architecture gaps

1. Each site card can show Publish, Visit, Panel, and Open builder, while the site name is also a dashboard link.
2. Blog is rendered as a low-priority optional-module row or a small “start module” link near the bottom of the dashboard.
3. The dashboard renders `ReadinessPanel` with `categories={{}}`, so it can only show “not checked” and cannot provide actionable readiness data.

## 4. Product decisions

### 4.1 One honest publication boundary

- Site publish is the only action that changes public output. Pages, blog posts, blog settings, and blog templates remain drafts until the site snapshot is published successfully.
- A post may be `draft` or `ready`; a template may be saved or ready. UI copy must say “Ready” or “Changes waiting to publish”, never “Live”, until the active site snapshot contains that revision.
- Do not make blog changes mutate the active public site behind the immutable snapshot system.

### 4.2 Blog V1 content contract

- Post authoring is a structured form, not a second free-form page builder.
- Supported V1 article bindings are: title, excerpt, cover image, body, author, and published date.
- The index template supports post collections plus static layout/content that helps present a blog.
- The article template supports semantic layout, static supporting content, and the V1 post bindings.
- Preserve any stored custom field definitions and values without erasing them, but do not advertise custom-field authoring until load, edit, save, preview, snapshot, and public resolution are all implemented end to end in a later plan.
- Use separate article/index allowlists derived from the typed registry. Do not create a parallel renderer or accept arbitrary HTML, CSS, or JavaScript.

### 4.3 Dashboard hierarchy

- A site card has one primary action: Dashboard. The site name may remain the same destination.
- A keyboard-accessible disclosure may show quick status, recent metrics, live address, pending changes, and a quick Edit action. Do not fetch metrics once per card; use one batched summary response.
- The site dashboard is the control center. Put primary Edit and Publish actions first, then a clear grid of destinations. Blog must be a visible module card whether it is active or available to start.
- Destructive settings remain inside the site dashboard, separated from everyday actions.

## 5. Implementation phases

### Phase 0 — Reproduction and compatibility boundary

- [x] **P0-T1 Capture the reported old-document failure as a deterministic fixture and journey.** Obtain a redacted export through existing authenticated APIs or add a read-only diagnostic export if necessary. Compare the affected old project with a newly created project without changing either source record. Add a fixture that preserves the failing schema/element shape and an integration test for edit text -> save -> reload -> preview -> publish -> public HTML. Include top-level text, text in a nested container, and text in a shared section where applicable.
  - Acceptance: at least one test fails for the real defect before the fix; the fixture contains no tenant identity, credentials, domain, or private content; the affected project is not deleted or rewritten.
  - Verify: focused shared/backend/frontend tests for the fixture; record the exact failing boundary in the Progress Log.

- [x] **P0-T2 Add one parse, normalize, and diagnostic boundary for stored project documents.** Validate MongoDB project records against the supported shared schema, apply versioned pure migrations in memory, report migrated/future/invalid paths, and refuse unsafe writes or publication with a typed actionable error instead of crashing or silently dropping content. Keep migrations idempotent and preserve desktop authorship.
  - Acceptance: supported legacy documents open without recreation; unsupported future documents are not overwritten; diagnostics identify the page, section, and element when possible; reads remain workspace-scoped.
  - Verify: legacy/current/future/corrupt repository and API tests; shared migration idempotence tests; backend typecheck.

**Checkpoint 0:** The reported failure has a reproducible cause or a precise evidence-backed diagnostic result. No UX work starts while saving, previewing, or publishing that fixture still loses or hides text.

- [!] **P0-T3 Confirm the incident on the affected account.** Open the reported site, edit a text block, save, reload, preview, publish, and load the public page. Compare the result with the fixture-derived reproduction and record whether the same boundary failed.
  - Blocked: requires the owner's credentials and access to their production workspace. Nothing in this repository can reach that document, and the plan forbids reading, exporting or rewriting it without that access. The technical fixes do not depend on this task; what depends on it is the claim that the customer's incident is resolved, which nobody may make until it runs.
  - Verify: owner performs the journey and reports the outcome; if it still fails, the refusal now names the page, section and element by id.

### Phase 1 — Editor, migration, and renderer correctness

- [x] **P1-T1 Make document traversal complete and shared.** Introduce or reuse one typed traversal/update utility for pages, shared sections, and recursively nested container elements. Apply it to element migration, responsive migration, readiness, media/reference collection, and any other project-wide transform found to be top-level-only. Do not double-process shared references when a page resolves them.
  - Acceptance: the same element shape is migrated and audited identically in a page, shared header/footer, or nested container; unchanged documents retain object identity where current callers depend on it.
  - Verify: shared tests covering all three locations, idempotence, and future-element reporting.

- [x] **P1-T2 Compile responsive placement and style rules for nested container children.** Define the nested container layout contract and make preview/public CSS include every rendered child without selector collisions. Preserve top-level output and deterministic content hashes.
  - Acceptance: nested text remains visible after save/reload and at Desktop/Tablet/Mobile widths; free, flex, and grid parents behave according to the documented contract; compiled CSS is deterministic.
  - Verify: responsive CSS tests, renderer parity tests, and browser viewport coverage for nested content.

- [ ] **P1-T3 Make editor targets and save results explicit.** Reset the target on normal project load; retain template field definitions without wiping them; return a typed success/failure result from save; block template publication after save error/conflict; and reload the correct project or template during conflict recovery. Cancel stale autosaves when route/target changes.
  - Acceptance: navigating project -> template -> project cannot write to the wrong endpoint; conflicts never publish stale content; loaded template metadata round-trips unchanged.
  - Verify: editor-store and EditorShell tests for navigation, in-flight edits, failed save, conflict reload, and template metadata preservation.

**Checkpoint 1:** The legacy regression, nested rendering cases, normal project save, and blog-template save all pass before changing publication semantics.

### Phase 2 — Blog lifecycle and publication truth

- [ ] **P2-T1 Repair blogs created before template IDs existed.** Make template creation/backfill a tenant-safe, idempotent service operation used by activation and legacy reads. Persist missing `indexTemplateId` and `articleTemplateId` together without replacing existing templates, and add a dry-run audit for affected projects.
  - Acceptance: opening or auditing an old enabled blog repairs only missing references; repeated repair is a no-op; site status no longer remains blocked after valid templates exist.
  - Verify: repository/API/site-status/publishing tests with pre-template blog settings and cross-tenant cases.

- [ ] **P2-T2 Enforce the single publication boundary from Section 4.1.** Replace misleading post/template “Publish” actions with draft/ready semantics and pending-change indicators. Ensure only site publish compiles the exact ready posts and saved templates into an immutable snapshot. Expose active snapshot revisions/hashes needed for honest UI comparisons.
  - Acceptance: saving or marking a post/template ready does not change public HTML; successful site publish changes it; failed site publish leaves the previous version live; dashboard copy never claims otherwise.
  - Verify: backend publication tests and frontend lifecycle tests for post edit, template edit, failed publish, successful republish, and rollback.

- [ ] **P2-T3 Make readiness real on the site dashboard.** Add or extend one server endpoint that returns revision-bound readiness categories plus module blockers, pending publication state, and actionable destinations. Remove the hard-coded empty category object and support rerun without mixing results from another revision.
  - Acceptance: unchecked, stale, clean, warning, and blocked states are truthful; each fixable issue links to its page/block/module; a clean label never comes from absent data.
  - Verify: site-status API, dashboard, readiness, revision-race, and tenant-isolation tests.

### Phase 3 — Focused blog authoring and templates

- [ ] **P3-T1 Split the blog template catalog by template kind.** Extend the registry/context model so index and article templates receive separate allowlists. Article templates expose semantic layout plus title, excerpt, cover, body, author, and published date bindings. Index templates expose semantic layout, post collections, and relevant supporting content. Exclude forms, pricing, countdowns, unrelated icon lists, and other blocks without a blog-data contract.
  - Acceptance: the catalog cannot insert a block unsupported by that template kind; existing stored blocks continue to render and remain removable/editable even if no longer offered for new insertion.
  - Verify: registry/catalog/i18n tests and backward-compatibility fixture tests.

- [ ] **P3-T2 Add template-aware sample preview.** Preview the article layout with a clearly labelled representative post and the index with representative cards, through the same renderer and responsive CSS used by publication. Make Back, Preview, Save, and conflict actions template-aware.
  - Acceptance: the template editor no longer opens ordinary site preview; Desktop/Tablet/Mobile preview shows bound title, cover, body, author, and date; preview never changes live output.
  - Verify: template route, preview route, renderer parity, accessibility, and three-viewport tests.

- [ ] **P3-T3 Stabilize the post form around the V1 contract.** Make title, derived/editable slug, excerpt, cover picker, rich-text body, author, SEO, draft/ready state, save status, conflict recovery, and unsaved-navigation protection consistent. Preserve stored custom fields but remove any visible path that cannot round-trip through public output.
  - Acceptance: a new and an old post can be edited without raw IDs or JSON; empty optional media never emits a broken request; every field used by the article template is authorable or system-generated.
  - Verify: PostEditor route/component/API tests, media ownership tests, lifecycle tests, and browser journey through site publication.

**Checkpoint 3:** A non-technical user can activate a blog, design index/article layouts from relevant blocks, write a post in a form, preview all devices, publish the site, and open the resulting public routes with no contradictory status.

### Phase 4 — Site list and dashboard information architecture

- [ ] **P4-T1 Simplify site cards and add a batched quick summary.** Keep Dashboard as the only persistent button. Add an accessible disclosure for live/draft state, last update, pending changes, blockers, live link, quick Edit, and measured 30-day views/visitors when analytics exists. Return all card summaries in one request or one batched endpoint; avoid per-card requests and layout shift.
  - Acceptance: collapsed cards show name, concise status, and one action; disclosure works by keyboard and screen reader; absent analytics is labelled unavailable rather than zero; phone layout does not overflow.
  - Verify: project summary/API query-count tests, SitesPage loading/error/empty/disclosure tests, accessibility, and phone viewport test.

- [ ] **P4-T2 Rebuild the site dashboard hierarchy.** Put Edit site and Publish changes at the top, followed by status/pending changes and a responsive destination grid for Pages, Blog, Forms, CMS, Media, Analytics, and Domains. Show Blog as an active card or a clear “Start blog” card, not a footer link. Keep settings/destructive controls visually separated.
  - Acceptance: Blog is visible without scrolling past settings; status badges come from server facts; every displayed destination exists; there is one dominant action per section.
  - Verify: SiteDashboard/module-route/i18n/accessibility tests at phone, tablet, and desktop widths.

- [ ] **P4-T3 Reduce action noise in the Blog dashboard.** Use one primary “New post” action, clear tabs/sections for Posts and Layouts, concise post rows/cards, and an accessible overflow menu for secondary actions. Show Ready/Draft, live snapshot state, and changes waiting to publish separately.
  - Acceptance: index/article layout entry points are prominent but not competing primary buttons; destructive delete remains confirmed; quick Edit is direct; mobile controls do not wrap into an unreadable button cloud.
  - Verify: BlogDashboard interaction, focus/menu, status-copy, i18n, and viewport tests.

### Phase 5 — End-to-end proof and handoff

- [ ] **P5-T1 Add critical integration and browser journeys.** Cover: legacy text edit/save/reload/preview/publish/public; project -> template -> project save isolation; old-blog template repair; article/index authoring; blog change remains pending until site publish; failed publish preserves live version; site-card disclosure; dashboard Blog discovery; and cross-tenant rejection.
  - Acceptance: each journey asserts persisted data and rendered output, not only button presence; tests run against a real permitted MongoDB runtime and fail when the corresponding production boundary is broken.
  - Verify: focused suites, then `npm run test` and `npm run test:e2e` with recorded counts and environment.

- [ ] **P5-T2 Run final gates, document operations, and hand off.** Run plan checks, typecheck, all tests, production build, bundle budgets, E2E, accessibility, and available container smoke. Update README status so it no longer points at stale task counts, and document the legacy audit/repair command, rollback, publication semantics, and remaining owner-only smoke.
  - Acceptance: no known regression is hidden by weakened assertions; the Progress Log records exact commands/counts/bundle sizes; all tasks are `[x]` except genuine owner-only `[!]`; final commits are pushed only to `development`.
  - Verify: `npm run check:plan-skill`, `npm run check:runbook`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run test:e2e`, and available container/deployed smoke.

## 6. Required verification matrix

| Surface | Required proof |
|---|---|
| Legacy documents | redacted fixture, idempotent migration, diagnostics, no recreation |
| Editor persistence | correct target, autosave isolation, conflict recovery, failed-save behavior |
| Rendering | top-level/shared/nested parity across editor, preview, and public output |
| Blog lifecycle | draft/ready vs active snapshot, republish, failed publish, rollback |
| Blog templates | article/index allowlists, bound sample preview, old-block compatibility |
| Post authoring | title/slug/excerpt/cover/body/author/SEO, save and conflict states |
| Dashboard | batched summaries, real readiness, Blog discovery, responsive/accessibility |
| Security | workspace scoping, media ownership, no secret/private content in fixtures |
| Operations | full Mongo-backed tests, E2E, build/budget, container and owner smoke |

## 7. Progress Log

Append one row per completed task. Never rewrite previous rows.

```text
YYYY-MM-DD HH:mm | Task | result | verification | commit SHA
2026-09-02 22:56 | P1-T2 | done | responsive CSS tests, legacy journey, full test, typecheck, build, E2E 100 | 0659abc
  Nested contract: a free container is the containing block and its children are placed by coordinate
  against the container's width, not the canvas; flex and grid children stay in flow. Selectors are
  id-only so nested rules cannot collide, and the walk is document order so the bytes stay stable.
  The E2E fixture now carries text inside a free container and asserts in a browser that the child
  sits inside its parent at every viewport — the earlier fixture had no nested content, so the
  compiler could omit those rules and the suite stayed green. Seeding also exposed a second invalid
  stored document: the seed's button link lacked `newTab`, published for as long as it has existed.
2026-09-02 22:49 | P1-T1 | done | shared traversal/migration/legacy tests, full test, typecheck, build | cc255bf
  One traversal (`mapDocumentElements`) now serves both migrations: pages, shared sections and nested
  containers, children before parents, object identity preserved so a load stays clean. Readiness had
  always walked all three, so it blocked publication on elements the migrations never visited — the
  reported failure. Every `responsive-layout` issue on the legacy fixture is now a warning; the
  edit -> save -> reload -> publish -> public HTML journey passes. Correction to P0-T1: its
  shared-section assertion used a text block, which has never changed version and so returns
  identical whether visited or not; it now asserts a version-1 form, which genuinely migrates.
  Remaining `it.fails`: the compiled stylesheet still reaches only top-level elements (P1-T2).
2026-09-02 22:43 | P0-T2 | done | shared diagnosis tests, backend boundary tests, full test, typecheck, build | 62c17aa
  `diagnoseStoredProject` is the single read boundary: current / migrated / future / invalid, with
  issues located by page, section and element id rather than array index. `ProjectRepository.findById`
  and the publishing compiler both route through it; `saveDocument` and `publish` refuse a future or
  invalid record with `UnsupportedDocumentError` -> `UNSUPPORTED_DOCUMENT` (409). Two defects found by
  the boundary itself: validating the whole stored record against the strict document schema called
  every published site invalid (the schema describes the document, storage keeps `activePublishedVersionId`
  beside it), and a renderer fixture had been storing a button whose link lacked `newTab` by calling
  the repository directly — invalid content that was being published until reads were parsed.
2026-09-02 22:33 | P0-T1 | done (fixture from the report, not the affected account) | shared+backend focused tests, typecheck, test, build | de96af7
  Scope: the fixture reproduces the *reported shape*. The affected project was never read, exported
  or compared — no access to that account — so nothing here shows the real document failed or that it
  now succeeds. Confirming the incident on the owner's site is P0-T3 below and remains owner-only.
  Failing boundary: publication, not saving or rendering. `service.publish` returns `blocked` for the
  legacy fixture with two `responsive-layout` blocking issues — `legacy-nested` (a container's child,
  100px past the right edge at 320-390) and `legacy-shared-text` (a shared section's text, 220px past
  at 320-480). `legacy-top-level` is only a warning, because `migrateDocumentResponsive` reached it
  and not the other two: it visits `document.pages` and, within a section, only `section.elements`.
  Element migration reaches containers but not `sharedSections`; `compilePageCss` emits rules only for
  top-level section elements. Six tests assert the promised behaviour and are marked `it.fails`, so
  they turn red when the fix lands.
```

## 8. Decision Log

Record only material deviations or newly discovered architectural choices.

```text
YYYY-MM-DD | decision | alternatives | reason | compatibility/rollback impact
2026-09-03 | An element's location reports its immediate parent's layout, not the section's | keep passing the section mode down | the responsive migration decides from it whether an element is placed by coordinate; the section's mode says nothing about a flex container's children, and using it wrote phone overrides into documents for elements the browser already reflowed | corrective: only affects elements inside flex/grid containers, which should never have been migrated
2026-09-03 | `UnsupportedDocumentError` extends `ApiProblem` | map it per route | one mapping existed and three routes did not use it, so preflight, preview and publish answered 500; an error that is already a problem cannot be forgotten by a new route | additive: the shared error handler already renders `ApiProblem`
2026-09-02 | Nested free containers are the containing block for their children | measure every child against the canvas | CSS resolves `100%` and `right` against the nearest positioned ancestor, so any other rule would disagree with what the browser does and let a child overflow its own box while looking contained | additive: top-level output is unchanged, so existing published hashes are stable
```

## 9. Completion definition

The plan is complete when the reported legacy document shape survives edit, save, reload, preview, publication, and public rendering; blog templates and posts obey one truthful publication model; only meaningful blocks are offered for each blog layout; the site list and dashboard expose a clear hierarchy with Blog easy to find; and all available automated gates pass. Production remains unchanged until the owner explicitly authorizes deployment and completes the documented smoke test.
