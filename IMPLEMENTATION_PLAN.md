# Builder Block Library — Implementation Plan

## Execution contract

- Repository: `https://github.com/Gabrielleobeltrao/WebsiteBuilder.git`
- Audited baseline: `development@472925bcb3afc0f523b6816d8228805355f09902`
- At the audit date, `origin/main` and `origin/development` point to the same commit. Perform all work on `development`; merge into `main` only after every required verification is green.
- Claude must answer the user in Brazilian Portuguese. Source code, identifiers, commits, technical documentation, UI translation keys, and this plan remain in English.
- Preserve the monorepo layout, one root `npm run dev`, the current Docker Compose/Coolify deployment, workspace isolation, Better Auth, MongoDB, publishing, analytics, blog, CMS, SEO, i18n, and media behavior.
- Do not replace the responsive architecture delivered by `BUILDER_UX_RESPONSIVE_PLAN.md`.
- Do not mark a task `[x]` until its acceptance criteria and verification are complete.
- Use `[!]` only for a genuine user-only credential, permission, unavailable external service, or irreversible decision. A failing test, design uncertainty, or implementation difficulty is not a blocker.
- Keep `Progress Log` and `Decision Log` current after each task. Record commands and concise outcomes, not vague statements.
- Never hide a failing test by skipping it, weakening assertions, or deleting coverage.

## Goal

Deliver a coherent, searchable, responsive block library for the page builder. Every block must be creatable from the right panel, editable through the contextual `Content / Style / Advanced` inspector, usable in free/flex/grid sections, rendered identically in authoring, preview, and the published site, accessible by keyboard, and safe for public output.

The implementation must first activate and complete block schemas that already exist in the repository, then add the genuinely missing blocks. Composite website sections must be reusable patterns made from blocks, not unnecessary new element types.

## Audited current state

### Confirmed strengths

- The builder exposes fixed Desktop, Tablet, and Mobile modes.
- Responsive values compile through shared code and are used by the editor, draft preview, SSR/public renderer, and diagnostics.
- Draft preview is isolated in an iframe at the selected reference viewport.
- The canvas is centered, builder destinations live in the right rail, and selecting an element opens its contextual inspector.
- The current authoring library exposes `text`, `image`, `button`, and `container`.
- Drag/drop, click insertion, nested containers, structure tree, keyboard alternatives, undo/redo, copy/paste, and publishing readiness already have meaningful automated coverage.
- Root typecheck and production build pass at the audited commit.
- Shared tests passed: 601. Frontend tests passed: 585.

### Gaps that must be corrected

- Fourteen visual element schemas already exist in `packages/shared/src/visual-elements.ts`, but they are not wired into the editor catalog, creation defaults, or complete inspectors: icon, icon list, divider, spacer, accordion, tabs, gallery, video, social links, download button, breadcrumbs, table, pricing table, and announcement bar.
- Some progressive interactive implementations exist only as frontend components/tests and are not connected to the published output. Tabs, gallery lightbox, video upgrades, carousel behavior, and dismissible UI need one explicit public runtime strategy.
- The current icon renderer outputs a placeholder dot instead of a real safe icon.
- Button data supports an icon, but public rendering does not consistently render it.
- Forms have shared contracts, repositories, APIs, fields, and notification code, but there is no valid page-builder form element connecting them.
- Feature detection mentions form/CMS/search-related element names that are not all valid elements in the normal project document. The contract and detector must agree.
- A drag/drop authoring test emits a React warning because `left` receives `NaN`. Fix the coordinate fallback and make the test fail on console errors.
- Blog editor tests report a duplicate Tiptap `link` extension. Remove the duplicate registration.
- One locale hook test reports an update outside React `act(...)`. Fix the test or lifecycle, preserving the behavior.
- The production frontend bundle reports a roughly 1.35 MB main JavaScript chunk before gzip. Add route-level and editor-level code splitting and enforce a documented budget.
- Backend tests requiring `mongodb-memory-server` could not start in the audit environment, and some `afterAll` hooks then dereference an unavailable server. Make test teardown null-safe, document prerequisites, and ensure the full suite runs in CI with MongoDB binary caching or a service container.
- Production container smoke verification from the previous plan still requires a Docker runner and a smoke MongoDB URI.

## Product rules

1. The right rail remains the only builder control rail. Selecting a block replaces the destination panel with that block's inspector; Back restores the previous destination.
2. Editing remains desktop-only. Phone-sized access may preview Desktop/Tablet/Mobile but cannot author layouts.
3. Each responsive-capable property uses base Desktop plus explicit Tablet/Mobile overrides. No arbitrary viewport slider returns.
4. Free sections retain side/corner resize handles. Flex/grid sections retain structured sizing and insertion behavior.
5. A block type is justified only when it owns semantic data, rendering behavior, or configuration. A visual composition such as Hero or Feature Card is a pattern composed of existing blocks.
6. No arbitrary HTML, arbitrary JavaScript, unsanitized SVG, social-feed API, calendar integration, payment integration, chat integration, or third-party plugin marketplace in this plan.
7. Use native HTML behavior first. Load the self-hosted public interaction runtime only on pages that contain blocks requiring it.
8. User-facing UI is fully translated in Portuguese and English and follows the account language selector.
9. All external, email, phone, WhatsApp, download, page, and anchor links use the existing typed/safe link contract. Do not store raw executable URLs.
10. Every image has an accessible alt-text decision: meaningful alt text or explicit decorative status.

## Target catalog

### Layout

- Container (existing; complete responsive controls)
- Divider
- Spacer

### Basic content

- Heading preset (uses the text contract; no duplicate renderer type)
- Text (existing)
- Rich Text
- Icon
- Icon List
- Button (existing; complete icon and state support)
- Table

### Media

- Image (existing)
- Gallery
- Carousel
- Video (safe YouTube/Vimeo identifiers in this release)
- Download Button

### Interactive and conversion

- Form
- Accordion
- Tabs
- Announcement Bar
- Countdown

### Marketing and trust

- Testimonial
- Pricing Table
- Counter
- Progress Bar
- Contact Information

### Navigation and site data

- Site Logo
- Navigation Menu
- Breadcrumbs
- Social Links
- Table of Contents (available for blog article templates and long-form rich text)

## Delivery phases

### Phase 0 — Stabilize the audited baseline

- [x] **0.1 Reproduce the baseline on `development`.** Confirm branch, clean worktree, commit SHA, Node/npm versions, and the documented environment-file setup. Do not copy secrets into logs.
  - Acceptance: audit metadata is recorded in the Progress Log and no work is performed on `main`.
- [x] **0.2 Fix the drag coordinate `NaN` warning.** Provide a deterministic pointer/rectangle fallback and add a regression assertion that computed placement values are finite.
  - Acceptance: the authoring test emits no console error and a malformed pointer cannot write non-finite geometry into the document.
- [x] **0.3 Remove the duplicate Tiptap link extension.** Keep one configured link extension with the existing URL policy.
  - Acceptance: blog editor tests emit no duplicate-extension warning and link editing still works.
- [x] **0.4 Fix the locale test's unwrapped state update.** Determine whether the issue belongs to test orchestration or the hook lifecycle.
  - Acceptance: no React `act(...)` warning and the race-condition assertion remains intact.
- [x] **0.5 Harden Mongo-backed test setup and teardown.** Teardown must tolerate setup failure while preserving the original error. Add CI caching/service configuration so these tests execute instead of silently skipping.
  - Acceptance: local failure explains the missing Mongo prerequisite without secondary `undefined.stop()` errors; CI runs the full Mongo-backed suite.
- [x] **0.6 Add bundle measurement.** Record initial and lazy-loaded chunk sizes; introduce a non-arbitrary documented budget and route/editor lazy loading.
  - Acceptance: dashboard/public/auth routes do not eagerly download the complete editor, blog editor, analytics charts, and CMS editor.

### Phase 1 — One source of truth for blocks

- [x] **1.1 Create a typed `ElementDefinition` registry in shared/editor code.** Each definition owns type, schema/version, category, translated label key, icon identifier, default factory, allowed contexts, nesting rules, responsive capabilities, feature dependency, inspector adapter, renderer adapter, and optional public-runtime capability.
  - Acceptance: catalog, create-element logic, inspector routing, feature detection, renderer routing, and readiness rules derive from or validate against the same registry.
- [x] **1.2 Remove duplicated element-name switch statements where the registry is authoritative.** Exhaustive TypeScript checks must fail when a new valid block lacks required integration.
  - Acceptance: adding a temporary fixture element without a renderer/default/inspector causes typecheck or a contract test to fail.
- [x] **1.3 Version element payloads and add pure migrations.** Existing saved projects must open without mutation until saved; published snapshots remain immutable.
  - Acceptance: fixtures for legacy and current documents parse and render deterministically.
- [x] **1.4 Reconcile feature detection with valid project contracts.** Normal page, blog-template, and CMS-template elements must have explicit contexts rather than impossible string comparisons.
  - Acceptance: every detected feature can be represented in its declared document context and unused optional features stay absent from navigation.

### Phase 2 — Rebuild the Elements destination

- [x] **2.1 Add catalog search.** Search localized block names and keywords without changing the canvas selection.
- [x] **2.2 Add collapsible categories:** Layout, Basic, Media, Interactive, Marketing, and Navigation.
- [x] **2.3 Add Recent and Favorites.** Recent is bounded; favorites are a user preference and do not modify project content.
- [x] **2.4 Keep both drag and click insertion.** Drag shows valid targets; click inserts into the selected container/section or creates a safe section at the end.
- [x] **2.5 Explain unavailable blocks in context.** Blog/CMS-only blocks are hidden outside their builders; entitlement or setup requirements use a disabled state with an actionable explanation where appropriate.
  - Acceptance for Phase 2: the catalog remains usable by keyboard, provides translated accessible names, and does not exceed the existing right-panel width at either supported locale.

### Phase 3 — Complete existing core blocks

- [ ] **3.1 Text and Heading preset.** Keep one text element contract; expose semantic heading/paragraph tags, typography, alignment, wrapping, max width, and responsive values. Prevent invalid heading hierarchy through readiness guidance, not destructive rewriting.
- [x] **3.2 Image.** Integrate the media library picker, focal point/object fit, responsive sizing, link, lazy/eager priority, alt/decorative choice, caption, and intrinsic dimensions.
- [x] **3.3 Button.** Render leading/trailing icons, typed links, target behavior, accessible label, loading-safe states, hover/focus/active styles, width/alignment, and responsive sizing.
- [ ] **3.4 Container.** Verify nested free/flex/grid behavior, min/max dimensions, gap, alignment, wrapping, overflow, background, border, radius, and breakpoint overrides.
  - Acceptance: each block has Content/Style/Advanced controls and authoring/preview/public parity across all three devices.

### Phase 4 — Activate the fourteen existing visual schemas

- [x] **4.1 Icon.** Replace placeholder glyphs with an allowlisted, tree-shakeable SVG icon catalog. Support size, color, accessible/decorative mode, and typed link.
- [ ] **4.2 Icon List.** Editable item order, icon choice, label, typed link, spacing, alignment, wrapping, and keyboard-safe controls.
- [x] **4.3 Divider and Spacer.** Responsive thickness/length/style/color and responsive space; never create horizontal overflow.
- [ ] **4.4 Accordion.** Editable items, single/multiple-open behavior, native semantics where possible, keyboard behavior, initial state, icons, and FAQ schema option.
- [ ] **4.5 Tabs.** Editable labels/panels, selected state, arrow-key navigation, orientation, mobile overflow/stack behavior, and no-JavaScript readable fallback.
- [ ] **4.6 Gallery.** Media-library selection, order, columns/gap, aspect ratio, captions, responsive layout, and accessible lightbox.
- [ ] **4.7 Video.** Validate YouTube/Vimeo identifiers, privacy-conscious loading, poster/consent placeholder, caption, aspect ratio, and no arbitrary iframe URL.
- [ ] **4.8 Social Links.** Allowlisted networks plus website/email, editable labels, icon style, spacing, and secure external links. No API-fed social content.
- [ ] **4.9 Download Button.** Select an owned media/file record, show label and optional metadata, and enforce tenant-safe/public access. Do not accept filesystem paths.
- [ ] **4.10 Breadcrumbs.** Resolve from the current page/navigation context, include accessible navigation markup and optional structured data, and avoid manually duplicated paths.
- [ ] **4.11 Table.** Header/caption semantics, row/column editing, responsive scroll or stacked strategy, alignment, borders, and safe plain/rich cell content.
- [ ] **4.12 Pricing Table.** Plans/features/price/period/CTA, highlighted plan, responsive stacking, typed CTA links, and readable semantic markup.
- [ ] **4.13 Announcement Bar.** Text, optional icon/link, dismissibility, storage scope, sticky behavior, and correct reserved layout space.
  - Acceptance: all fourteen types can be inserted, saved, reloaded, copied, pasted, undone, resized where appropriate, previewed, published, and migrated.

### Phase 5 — Add the missing essential blocks

- [ ] **5.1 Rich Text.** Store validated editor JSON, not raw HTML. Support paragraphs, headings, emphasis, links, lists, quotes, and horizontal rules; sanitize public output and preserve typography responsiveness.
- [ ] **5.2 Form block.** Bind a page element to the existing form definition/API. Support the existing field types, labels, help text, placeholders, required state, success/error messages, submit button, consent, notification configuration, and spam/rate-limit protections.
  - First insertion creates or selects a draft form definition.
  - The local block inspector edits presentation and selects the definition.
  - The site-level Forms destination appears only after a form is referenced.
  - Publishing is blocked with an actionable status when a referenced form is incomplete.
  - Removing the last reference hides the destination but never silently deletes submissions or the saved definition.
- [ ] **5.3 Navigation Menu.** Bind to the project's page/navigation tree, support nested items, current-page state, desktop orientation, responsive hamburger/drawer, keyboard focus management, and no duplicated manual URLs.
- [ ] **5.4 Site Logo.** Bind to site identity with optional local override, correct home link, image alt handling, and responsive dimensions.
- [ ] **5.5 Testimonial.** Quote, person, role/company, avatar, optional rating, semantic quotation, and responsive alignment.
- [ ] **5.6 Carousel.** Slides may contain an image, text, and typed CTA; provide arrows/dots, swipe, keyboard support, reduced-motion support, pause controls, and readable no-JavaScript fallback.
- [ ] **5.7 Contact Information.** Structured phone, email, address, hours, and optional social items with typed actions; no mapping API in this release.
- [ ] **5.8 Counter and Progress Bar.** Static public value by default, optional intersection animation through the shared runtime, reduced-motion fallback, accessible text, min/max validation, and locale-aware formatting.
- [ ] **5.9 Countdown.** Absolute target time with timezone, expired behavior, server/client clock-safe display, reduced motion, and no forced redirects.
- [ ] **5.10 Table of Contents.** Generate from eligible headings, create collision-safe anchors, highlight only when the runtime is present, and restrict availability to long-form/page or blog-template contexts.
  - Acceptance: every new block follows the registry, migration, inspector, responsive, security, accessibility, and parity contracts established earlier.

### Phase 6 — Patterns, not widget explosion

- [ ] **6.1 Add a Patterns mode beside Blocks in the Elements destination.** A pattern inserts a normal editable element tree in one undo transaction.
- [ ] **6.2 Ship responsive starter patterns:** Header, Footer, Hero, Split Hero, Feature Grid, Logo/Trust Row, Gallery, Testimonials, Pricing, FAQ, Lead Form, Contact, CTA, and Blog Article Header.
- [ ] **6.3 Make patterns theme-aware and bilingual.** Inserted copy uses the current account language, but remains ordinary editable content.
- [ ] **6.4 Support replace-safe placeholder media and links.** Readiness must identify unresolved placeholders before publishing.
  - Acceptance: deleting the pattern catalog later would not break an already inserted page because published documents contain ordinary blocks, not opaque template references.

### Phase 7 — Public interaction runtime and parity

- [ ] **7.1 Create one small self-hosted progressive-enhancement runtime.** It upgrades only blocks present on the page and is loaded with `defer` only when required.
- [ ] **7.2 Implement capabilities, not per-page scripts:** tabs, gallery lightbox, carousel, dismissible announcement, responsive navigation, countdown, optional counter/progress animation, and table-of-contents active state.
- [ ] **7.3 Preserve strict CSP.** No inline executable script, `eval`, arbitrary event attributes, or third-party runtime dependency.
- [ ] **7.4 Guarantee fallback content.** Critical text, links, form labels, prices, and navigation are readable/usable before JavaScript and in SSR.
- [ ] **7.5 Add renderer parity snapshots/contract tests.** The same normalized document and viewport must produce equivalent authoring, draft preview, and public structure/styles.

### Phase 8 — Inspector and responsive authoring quality

- [ ] **8.1 Give every block focused Content controls.** Repeatable items use reorder, duplicate, and delete controls with stable IDs; never edit JSON directly.
- [ ] **8.2 Reuse Style groups.** Typography, color, background, border, radius, shadow, spacing, sizing, alignment, and states share typed controls instead of block-specific copies.
- [ ] **8.3 Reuse Advanced controls.** Name, visibility, lock, z-order, accessibility, anchor ID, CSS-safe class token if already supported, and responsive overrides remain consistent.
- [ ] **8.4 Preserve selection UX.** Selected block has a clear outline and handles; overlays never cover its editable content or public preview.
- [ ] **8.5 Test overflow at reference and boundary widths.** Cover 320, 390, 767, 768, 1023, 1024, and 1440 px, long Portuguese/English content, nested containers, tables, menus, galleries, pricing, and forms.
- [ ] **8.6 Keep mobile authoring blocked.** Mobile device mode inside desktop authoring remains editable; opening the application from a phone remains preview-only for builders.

### Phase 9 — Publishing, performance, accessibility, and security

- [ ] **9.1 Extend readiness findings.** Detect incomplete forms, unresolved media/files, unsafe/empty links, missing alt decisions, empty menu, invalid video, countdown without timezone, duplicate anchors, invalid table headers, layout overflow, and interactive blocks missing runtime support.
- [ ] **9.2 Make findings actionable.** Each finding opens the correct page, device, block, inspector tab, and field when possible.
- [ ] **9.3 Enforce media performance.** Responsive `srcset/sizes`, intrinsic dimensions, WebP variants, sensible lazy loading, and priority only for likely above-the-fold media.
- [ ] **9.4 Enforce code splitting and runtime budgets.** Document the budgets and fail CI only on meaningful regressions. Keep the public runtime substantially smaller than the application editor bundle.
- [ ] **9.5 Audit accessibility.** Keyboard-only insertion/editing, focus restoration, tab/accordion/carousel/menu behavior, visible focus, reduced motion, contrast guidance, semantics, and screen-reader names.
- [ ] **9.6 Audit security.** Strict schema parsing, tenant ownership for media/forms/files, URL allowlists, iframe source allowlists, safe SVG strategy, CSP, rate limits, and no raw user HTML/JS.
- [ ] **9.7 Preserve analytics compatibility.** Click and section tracking must use stable element/section IDs without sending form values or personal content.

### Phase 10 — Verification and delivery

- [ ] **10.1 Unit and contract tests.** Cover registry exhaustiveness, defaults, schemas, migrations, inspectors, feature detection, safe links, runtime capability selection, and public rendering.
- [ ] **10.2 Integration tests.** For every block family: insert, configure, save, reload, copy/paste, undo/redo, delete, publish preflight, publish, and public fetch.
- [ ] **10.3 Browser E2E.** Build representative landing page, multi-page navigation, blog article template, gallery, pricing, FAQ, and form flows; verify Desktop/Tablet/Mobile screenshots and keyboard paths.
- [ ] **10.4 No-warning test gate.** Fail relevant suites on unexpected `console.error`/`console.warn`; allow only explicitly asserted messages.
- [ ] **10.5 Run the root gates:** `npm run typecheck`, `npm test`, `npm run build`, lint if configured, complete E2E, responsive visual regression, and container smoke.
- [ ] **10.6 Manual deployed smoke.** In the Coolify deployment, verify authenticated authoring, iframe preview, public subdomain/custom-domain rendering, runtime assets, form submission, media, CSP, caching, and rollback.
- [ ] **10.7 Documentation.** Update architecture, block-authoring guide, element registry contract, migration guide, runtime capability guide, accessibility checklist, and operator/deployment notes.
- [ ] **10.8 Final branch discipline.** Commit coherent phases to `development`, push, confirm CI, and prepare a merge summary. Do not merge/push `main` until the full gate is green and the user authorizes release.

## Explicitly deferred

- Google Calendar and scheduling integrations
- Google Maps or other mapping APIs
- Payment/e-commerce/checkout blocks
- Chat widgets and CRM integrations
- API-fed social feeds and reviews
- Arbitrary HTML/JavaScript/embed widgets
- Third-party block/plugin marketplace
- A/B testing
- Uploaded/self-hosted video pipeline
- Per-block custom code

These items must not shape the first release into premature external integrations. The registry may expose capabilities cleanly enough for later additions without reserving fake or unused UI today.

## Suggested implementation order within the catalog

1. Stabilization and registry
2. Icon, Divider, Spacer, Rich Text
3. Gallery, Video, Social Links
4. Accordion, Tabs, Announcement Bar
5. Form and conditional Forms destination
6. Site Logo, Navigation Menu, Breadcrumbs
7. Testimonial, Pricing Table, Carousel
8. Contact Information, Counter, Progress, Countdown, Table, Download Button, Table of Contents
9. Patterns
10. Public runtime, readiness hardening, performance, and complete verification

## Definition of done for one block

A block is not done merely because it renders. It is done only when:

- its schema is strict, versioned, and migrated;
- it has a default factory and appears in the correct localized catalog context;
- drag and click insertion work;
- Content, Style, and Advanced editing work without raw JSON;
- undo/redo, copy/paste, delete, save/reload, and nested placement work;
- Desktop/Tablet/Mobile overrides work without overflow;
- authoring, preview, SSR, and published output agree;
- keyboard and screen-reader behavior are verified;
- unsafe input and tenant-crossing references are rejected;
- readiness catches incomplete configuration;
- unit, integration, and E2E coverage pass;
- documentation includes its data contract and public-runtime needs.

## Research basis

- Elementor's official widget catalog confirms the value of content, media, layout, navigation, conversion, and marketing categories: `https://elementor.com/widgets/`
- Elementor's official widget workflow uses a searchable widget panel and contextual Content/Style/Advanced editing: `https://elementor.com/help/simple-widgets/`
- Wix's official editor groups elements such as forms/contact, menus, galleries, social, and embeds: `https://support.wix.com/en/article/wix-harmony-editor-adding-elements`
- Webflow's official Quick Find supports searching and adding elements, assets, and pages: `https://help.webflow.com/hc/en-us/articles/33961382093587-Quick-find`

The plan adopts the proven discoverability and contextual-editing patterns, while keeping the product's existing right-side rail and avoiding unsafe arbitrary-code blocks.

## Progress Log

- 2026-08-12 — Repository audited at `development@472925bcb3afc0f523b6816d8228805355f09902`; `main` and `development` currently reference the same commit.
- 2026-08-12 — Root typecheck passed.
- 2026-08-12 — Root production build passed. Vite reported a large main chunk (~1.35 MB before gzip), captured as task 0.6/9.4.
- 2026-08-12 — Shared suite passed 601 tests; frontend suite passed 585 tests.
- 2026-08-12 — Mongo-backed backend tests could not start `mongodb-memory-server` in the audit environment and exposed unsafe teardown; captured as task 0.5. Non-Mongo backend tests did run, so this is not recorded as a product pass.
- 2026-08-12 — Existing dormant visual schemas, disconnected interaction layer, form integration gap, placeholder icon rendering, and feature-contract mismatch identified and incorporated into Phases 1, 4, 5, and 7.

### Execution log

- 2026-08-12 — 0.1 Baseline reproduced on `development@472925b`, worktree clean apart from this plan file, Node v22.17.1, npm 10.9.2, `.env` present and untouched. No work performed on `main`.
- 2026-08-12 — 0.2 `constrainGeometry` and `pointToLogical` now coerce non-finite input; `EditableCanvas` uses the shared converter instead of inline arithmetic. Regression tests: every geometry field stays finite for `NaN`/`Infinity`/`undefined` input, and a drop carrying no pointer coordinates writes a usable position.
- 2026-08-12 — 0.3 `StarterKit.configure({ link: false })`; the configured link extension with the `https/mailto/tel` allowlist is now the only one registered.
- 2026-08-12 — 0.4 Test orchestration: the i18next language change and the released read are wrapped in `act(...)`. The race assertion is unchanged.
- 2026-08-12 — 0.5 All 24 Mongo-backed suites use `await database?.stop()`; `startTestDatabase` wraps a failed `MongoMemoryServer.create()` with the prerequisite and the original cause. CI caches `node_modules/.cache/mongodb-binaries`. Documented in the runbook commands reference. `npm run test -w backend`: 38 files pass.
- 2026-08-12 — 0.6 Ten routes are lazily loaded behind one Suspense boundary. Entry chunk gzip fell from 386 KB to 163 KB; the builder (99 KB), blog editor (126 KB), analytics (7 KB) and CMS (4 KB) are separate chunks. New budget `applicationInitialBundleBytes` = 200 KB with a test that also fails if the entry ever exceeds 60% of the total.
- 2026-08-12 — 1.1 `packages/shared/src/element-registry.ts`: one `ElementDefinition` per block — schema version, category, label key, search keywords, icon, default size, contexts, nesting, free-positionability, feature dependency, runtime capability and a pure defaults factory. `ELEMENT_TYPES` grew from 4 to 19 (the 14 dormant visual schemas plus `form`); `createElement` builds every block from the registry instead of a switch.
- 2026-08-12 — 1.2 The registry is a `Record` over the union and `VisualElementRenderer` ends in a `never` check, so a block added without a definition or a renderer fails `npm run typecheck`. A contract test parses every block's defaults with the real document schema.
- 2026-08-12 — 1.3 `element-migrations.ts`: elements carry an optional `version` (absent = 1), migration is pure and runs on read in both the editor and publishing, returns the same object when nothing changed, and refuses an element written by a newer deployment rather than half-reading it.
- 2026-08-12 — 1.4 `countReferences` derives its element types from the registry. The list it replaced named `form`, `postCollection`, `blogDynamic`, `cmsCollection`, `cmsDynamic` and `search` — none a valid element type, so every count was zero and no optional feature could leave "unused". The `form` block now declares `feature: "forms"`.
- 2026-08-12 — 2.1-2.5 The Elements destination is a searchable catalog over the registry: search matches label, type and localized keywords with accents and case folded (`botao` finds Botão); six collapsible categories; Recent (bounded at 6) and Favourites stored in `localStorage` and pruned against the registry, never in the document; drag and click both retained, with the click destination stated; a block whose context excludes it is absent, and one that cannot be inserted right now — a container at the nesting limit — is disabled with the reason as its accessible description. 14 catalog unit tests and 11 panel tests.
- 2026-08-12 — E2E: one preview journey was flaky under parallel workers, clicking a card link during the list's own render. It now waits for the card and the builder's own control before acting. 73 E2E pass.
- 2026-08-12 — 4.1-4.13 (editing) Every structured block now has a working inspector: `VisualElementInspector` covers icon, icon list, divider, spacer, FAQ, tabs, gallery, video, social links, download button, breadcrumbs, table, pricing table, announcement bar and form. Repeatable items share one `ItemsEditor` — add, reorder, duplicate, remove, each with the row's own name in its control label. A social row whose address does not belong to the network it claims warns in place; a table's rows follow its columns so no unreachable cell can be stored; consent text appears only when consent is required. 22 tests, and every field is translated in both locales.
- 2026-08-12 — 4.1/3.3/4.7 (rendering) Icons are real SVG drawn from a closed vocabulary in `BlockIcon.tsx`, replacing the bullet that was the same mark for every icon in the set. A button's stored icon is finally rendered, decorative, before or after its label. A video renders its player from provider + id — never a stored URL — and shows a labelled placeholder while unconfigured. Five renderer tests.
- 2026-08-12 — 4.1 Icon complete: allowlisted SVG set, size, colour, decorative by default, and a typed link that gives the icon an accessible name when it becomes the only thing announced. 4.3 Divider and Spacer complete: divider is capped at the width of what holds it so a rule cannot push a phone sideways; spacer height is geometry and is edited once, in Layout, with its own value per device.
- 2026-08-12 — 3.2 Image complete: the workspace media library is the picker — typing a database id by hand was the only way to fill a media field, and a tenant-crossing reference was a typo away. Added caption (as `figure`/`figcaption`), typed link through the same safe-link contract, loading priority with `fetchPriority`, and stored intrinsic dimensions so the browser reserves the slot. The gallery and download button pick from the same library. 3.3 Button complete: its stored icon renders before or after the label, decorative, spaced by the shared style.
- 2026-08-12 — **Next**: 3.1-3.4 (media picker for image, container responsive controls), 4.2/4.4-4.6/4.8-4.13 (per-block rendering upgrades: icon-list links need a schema v2 + migration, accordion/tabs/gallery/table/pricing/announcement behaviour), then Phases 5-10. Every phase so far is committed on `development`; `main` untouched.
- 2026-08-12 — 10.4 (frontend) An unexpected `console.error`/`console.warn` now fails the test that produced it; a test that means to provoke one declares it with `allowConsole(/pattern/)`. All 53 frontend files pass under the gate.

## Decision Log

- 2026-08-12 — Reuse and finish existing visual schemas before adding duplicate element types.
- 2026-08-12 — Treat Hero, Feature Grid, FAQ, CTA, Header, and Footer as editable patterns, not opaque block types.
- 2026-08-12 — Add semantic element types only for distinct data/behavior: rich text, form, navigation menu, site logo, testimonial, carousel, contact information, counter/progress, countdown, and table of contents.
- 2026-08-12 — Keep external integrations and arbitrary embeds out of this release.
- 2026-08-12 — Use one conditional self-hosted progressive-enhancement runtime for interactive public blocks.
- 2026-08-12 — Preserve the right rail, fixed three-device model, desktop-only authoring, and conditional feature navigation.
- 2026-08-12 — Non-finite coordinates are corrected in `coordinates.ts` rather than at each call site: every drag, resize and insertion already funnels through it, and a guard per caller would have to be repeated for each new one.
- 2026-08-12 — The console gate restores only its own two spies. `vi.restoreAllMocks()` also resets every `vi.fn()` a module mock declared, which empties a file's stubs after its first test.
- 2026-08-12 — Unconfigured is a representable state. A freshly inserted video, download button or form stores an empty id: a block has to be insertable before it can be filled in, and readiness reports the gap rather than the schema refusing to save the page.
- 2026-08-12 — The registry holds data only. Inspector and renderer adapters stay in the frontend, because `packages/shared` carries no React; exhaustiveness is enforced there by a total record and a `never` check.
- 2026-08-12 — No entitlement state in the catalog. Every workspace resolves to the same plan today, so a disabled row explaining a limit nobody has would be invented UI — which this plan explicitly rules out. The mechanism exists (`unavailable`) and is used for a restriction that is real: nesting depth.
- 2026-08-12 — Recent and Favourites are browser preferences. They are per person, not per site; storing them in the document would put one editor's habits into another's saved revision.
- 2026-08-12 — Budget the first screen separately from the total. Summing every chunk hides the regression that matters: a route that stops being lazily loaded moves the first screen and leaves the total unchanged.

## Continuous Claude Code goal

Run this from the repository root after placing this file there:

```text
/goal Every task in BUILDER_BLOCK_LIBRARY_PLAN.md is either [x] with its acceptance criteria and verification completed, or [!] only when it genuinely requires user-only credentials, permissions, an unavailable external service, or an irreversible decision. Continue through all unblocked phases without stopping after a single task. Keep the Progress Log and Decision Log accurate, answer the user in Brazilian Portuguese, keep code and artifacts in English, work only on development, and do not merge main. The final root typecheck, tests, build, E2E, responsive visual regression, and container/deployed smoke checks must pass, except checks explicitly marked [!] with concrete evidence and exact user action required.
```
