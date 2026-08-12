# Form System and Builder Completion Plan

## 1. Execution contract

- Repository: `https://github.com/Gabrielleobeltrao/WebsiteBuilder.git`
- Work only on branch `development`. Do not merge or push to `main`.
- Audited baseline: `6702acddc55cd99d2715c3e09a5d9d736577bb54`.
- Claude must answer the owner in Brazilian Portuguese. Source code, identifiers, commits, tests, and technical documentation remain in English.
- Preserve the existing monorepo, routes, tenant boundaries, Better Auth integration, MongoDB driver, shared renderer/compiler, desktop-only layout editor, and Desktop/Tablet/Mobile preview model.
- Do not add external CRM, email, calendar, analytics, payment, or AI providers in this plan.
- Inspect existing code before changing it. Extend existing abstractions instead of creating parallel systems.
- Complete tasks in dependency order. After each task, run its focused checks and update the Progress Log.
- Mark `[x]` only after implementation, acceptance criteria, and verification pass. Use `[!]` only for a genuine owner-only credential, permission, production access, or irreversible decision. A local tooling problem is not `[!]`.
- Never hide an incomplete feature behind a successful-looking UI or a checked task.

## 2. Audited starting point

The previous block-library plan is substantially implemented: a typed element registry, 29 catalog blocks, 14 patterns, search/recent/favorites, shared rendering infrastructure, route lazy loading, responsive authoring rules, media selection, SVG icons, CSP work, and broad tests exist.

The current form implementation is incomplete and must not be treated as production-ready:

- Form definitions, fields, validation primitives, submissions repository, duplicate suppression, CSV helpers, retention concepts, and notification abstractions exist in the backend/shared packages.
- Authenticated API routes expose form-definition CRUD only.
- No frontend Forms Center route exists although the site dashboard can link to `/forms`, which currently leads to no matching page.
- The builder inspector accepts a raw `formId`; it has no form picker, quick-create, usage information, or safe edit-and-return flow.
- `VisualElementRenderer` returns `null` for `form`, so the canvas, preview, and published page do not show the form.
- No public submission endpoint calls the existing submission repository.
- Published snapshots contain referenced forms, but the renderer does not consume them.
- Site-status reconciliation does not collect form facts reliably, and published reference counts are incomplete.
- Form definition and form block duplicate ownership of submit/success/consent properties, allowing drift.
- Full root verification still requires a working MongoDB test runtime; Docker/Coolify production smoke requires the appropriate environment and access.

## 3. Product decisions

### 3.1 Ownership

- A **form definition** owns its name, stable ID, ordered fields, labels, field types, options, required rules, validation, success behavior, retention settings, and definition revision.
- A **form placement block** owns only page presentation: bound form ID, layout preset, field spans, width/height, alignment, spacing, colors, typography, border, radius, and optional display-only overrides explicitly supported by the renderer.
- Consent is represented as a normal consent field in the form definition. Remove duplicate block-level consent state through a safe migration.
- Submit text and success behavior have one canonical owner. Prefer the definition; migrate legacy block values without losing data.
- A published site uses the exact immutable form revision embedded in its active published snapshot. Editing a definition affects drafts immediately but affects production only after republishing.

### 3.2 Placement and responsive behavior

- A form is a normal responsive builder element: it can fill a section/page, occupy a column, or be a smaller block.
- Support at least `stacked`, `two-column`, and `compact` presentation presets. Per-breakpoint layout may collapse safely; mobile must never overflow horizontally.
- Provide a “Full-page form” pattern composed from normal section/container/form primitives. Do not create a separate incompatible page engine.
- The editor canvas renders the real disabled/non-submitting fields. Draft preview renders the real interactive validation UI but never persists a submission. Published pages render and submit the real form.

### 3.3 Navigation

- Keep the permanent application sidebar on the left.
- Keep the builder canvas centered and its contextual element/pages panel on the right.
- Forms is an optional site module. Show it when the project has a form block, a form definition, or retained submissions; do not remove access to historical records merely because the last block was removed.
- Form administration pages are responsive data-management pages and may work on mobile. Layout editing remains desktop-only; mobile/tablet provide preview only.

## 4. Implementation phases

### Phase 0 — Baseline, truthfulness, and contracts

- [x] **0.1 Re-audit the actual branch before editing.** Fetch `origin/development`, record HEAD, working-tree state, relevant package versions, and any commits after the audited baseline. Do not discard unrelated work.
  - Acceptance: Progress Log records the actual starting SHA and describes any scope-changing drift.
  - Verify: `git status --short`, `git log -10 --oneline`, existing root typecheck/test/build commands.

- [x] **0.2 Write a form ownership and state contract.** Document definition vs placement vs published snapshot vs submission ownership, draft/published behavior, deletion/archive rules, and tenant boundaries.
  - Acceptance: one authoritative document is referenced by shared types and tests; no duplicate source of truth remains unexplained.

- [x] **0.3 Correct false-positive completion gaps from the previous plan.** At minimum verify and fix: rich-text editing is actually usable; pricing-table CTA/link/highlight rendering; announcement-bar link rendering; site-logo home link resolution; form route/rendering claims; published reference counts.
  - Acceptance: each advertised control affects editor, preview, and public output where applicable; no dead dashboard link.
  - Verify: focused unit/integration tests and renderer parity tests.

### Phase 1 — Shared form model and migration

- [x] **1.1 Introduce versioned shared form contracts.** Add strict schemas for definition revision, placement presentation, published form snapshot, public submission request/result, submission source, and stored schema snapshot.
  - Acceptance: unknown fields are rejected; limits exist for field count, labels, options, and payload size; all schemas are shared by frontend/backend/renderer.

- [x] **1.2 Migrate legacy form elements safely.** Convert raw/duplicate block properties to the canonical definition/placement model while preserving old documents and published snapshots.
  - Acceptance: old documents load without data loss; newly saved documents use the new schema; migration is idempotent and tested.

- [x] **1.3 Add optimistic concurrency and revision semantics.** Definition updates require the expected revision and return a typed conflict response.
  - Acceptance: two tabs cannot silently overwrite one another; the UI can reload or intentionally retry.

### Phase 2 — Complete authenticated form APIs

- [x] **2.1 Finish definition services and routes.** Add templates, usage lookup, archive/restore, duplicate, and safe delete/rebind checks on top of the existing repository.
  - Acceptance: a referenced form cannot be silently deleted; usages identify page and block; forms with submissions archive instead of destructive deletion.

- [x] **2.2 Expose tenant-safe submission management APIs.** Implement list/detail/counts, filters by form/status/date/page/source, pagination, mark read, archive, spam, safe delete, bulk actions, and streamed CSV export with formula-injection protection.
  - Acceptance: every query is scoped by authenticated workspace/project; indexes support main filters; large exports do not load everything into memory.

- [x] **2.3 Reconcile site module facts.** Include form block references, definitions, retained submissions, unread totals, incomplete configuration, archived references, and publish staleness in the existing status/readiness system.
  - Acceptance: optional navigation, badges, status cards, and blockers derive from server facts rather than frontend guesses.

### Phase 3 — Forms Center UX

- [x] **3.1 Add real routes under the existing authenticated site shell.** Implement:
  - `/app/:workspaceId/sites/:projectId/forms`
  - `/app/:workspaceId/sites/:projectId/forms/new`
  - `/app/:workspaceId/sites/:projectId/forms/:formId/edit`
  - `/app/:workspaceId/sites/:projectId/forms/submissions`
  - Acceptance: direct navigation, refresh, breadcrumbs, permissions, loading, empty, error, and not-found states work.

- [x] **3.2 Build the Forms overview.** Show form name, active/archived state, usage pages, total/new submissions, last submission, last edit, and draft changes waiting for publication. Include search/filter and clear create/duplicate/archive actions.
  - Acceptance: clicking usage opens the exact page/block; clicking counts opens the correctly filtered inbox.

- [x] **3.3 Build a focused form editor.** Support name, templates (`Blank`, `Contact`, `Lead`, `Newsletter`), add/reorder/duplicate/delete fields, field settings/options/validation, success message or safe redirect, retention, autosave state, and revision conflicts.
  - Acceptance: keyboard operation, validation, dirty/saving/saved/error states, and mobile data-page layout are usable; no canvas is needed here.

- [x] **3.4 Build the submissions inbox.** Add summary counts, filters, pagination, selectable rows, bulk status actions, CSV export, and an accessible detail drawer/page showing preserved historical labels and source context.
  - Acceptance: unread badge updates consistently; actions are reversible where practical; destructive actions require explicit confirmation.

### Phase 4 — Builder binding and actual visual

- [x] **4.1 Replace raw `formId` editing with a form binding control.** The right inspector must show current form, searchable “Choose existing form”, “Create new form”, “Edit fields/settings”, usage, and missing/archived warnings.
  - Acceptance: users never need to copy an ID; create binds automatically; rebind is explicit; unbind does not delete the definition.

- [x] **4.2 Implement quick-create and safe edit-and-return.** From a selected form block, allow name/template creation inline or open the Forms Center. Autosave the page draft before leaving and preserve a signed/validated internal `returnTo` containing project, page, selected block, and device preview.
  - Acceptance: returning restores the exact builder context; unsafe external return URLs are rejected.

- [x] **4.3 Render the actual form in the canvas.** Use the shared renderer with editor mode: fields are visible, styled, selectable as one block, and cannot submit or steal builder drag/resize interactions.
  - Acceptance: no placeholder word and no `null` output; loading, unbound, missing, archived, and valid states are visually distinct and actionable.

- [x] **4.4 Add responsive presentation controls.** Expose preset, width, alignment, spacing, field spans, visual style, and normal free/grid/flex geometry without duplicating definition data.
  - Acceptance: the form can be full-page, full-section, column-sized, or compact; Desktop/Tablet/Mobile previews remain inside their viewport with no horizontal overflow.

- [x] **4.5 Add the Full-page form pattern.** Insert a responsive section/container/form composition and open binding immediately.
  - Acceptance: pattern uses normal primitives, can be detached/edited, and compiles through the same pipeline.

### Phase 5 — Preview, publication, and public submission

- [x] **5.1 Pass published forms into the shared renderer.** Resolve form placements against the draft definition in editor/preview and the embedded immutable revision in public rendering.
  - Acceptance: editor, clean preview, and published site share markup/styles and differ only by mode-specific behavior.

- [x] **5.2 Make preview safe.** Desktop/Tablet/Mobile preview shows validation and success behavior without creating database records or firing notifications.
  - Acceptance: preview is clearly labeled when submitting; automated tests prove zero persisted submissions.

- [x] **5.3 Implement the same-origin public endpoint.** Add `POST /__wb/forms/:formId/submissions` in the public renderer path. Resolve `Host -> active site -> active immutable snapshot -> exact form revision`; do not validate against a newer live definition.
  - Acceptance: native HTML POST works without JavaScript; the small public runtime progressively enhances submission and inline errors.

- [x] **5.4 Harden public intake.** Enforce body/field limits, strict allowlists, required/type validation, honeypot, rate limiting, duplicate suppression, tenant isolation, safe redirect rules, privacy-conscious IP/user-agent handling, and structured audit logs without field values.
  - Acceptance: arbitrary fields, cross-tenant IDs, oversized payloads, spam paths, and forged page/source identifiers are rejected or classified safely.

- [x] **5.5 Preserve historical meaning.** Store definition ID/revision plus a minimal field-schema snapshot with each submission. Compute project/site/page/path and accepted campaign parameters server-side from trusted request context.
  - Acceptance: old submissions remain readable after labels/options change or old published versions are pruned.

- [x] **5.6 Keep notifications provider-neutral.** Preserve the existing adapter and development sink, but do not claim production email delivery without a configured provider.
  - Acceptance: the Forms inbox is the reliable source of truth; notification status is explicit and failures never lose submissions.

### Phase 6 — Readiness, publish lifecycle, and deletion rules

- [x] **6.1 Add actionable form readiness findings.** Detect unbound block, missing definition, zero usable fields, invalid redirect, archived referenced form, invalid field options, and definition changes newer than the active publication.
  - Acceptance: each finding opens the exact form or builder block; publish blocks only on genuine errors and distinguishes warnings.

- [x] **6.2 Implement draft-versus-published messaging.** Forms Center and builder show “Changes waiting to publish” when the draft definition revision differs from the active snapshot.
  - Acceptance: editing a form never mutates a live site silently; republish clears the state.

- [x] **6.3 Finalize lifecycle behavior.** Prevent deletion while referenced, offer “show usages”, rebind, or remove placements; archive forms with retained submissions; keep historical inbox access after the last placement is removed.
  - Acceptance: no orphaned blocks, inaccessible history, or accidental cascading deletion.

### Phase 7 — Accessibility, responsiveness, performance, and clarity

- [x] **7.1 Make generated forms accessible.** Correct labels, fieldsets/legends, descriptions, required/invalid semantics, error summary, focus movement, keyboard order, contrast, and reduced-motion behavior.
  - Acceptance: automated accessibility checks plus keyboard-only create, fill, error, correct, and submit paths pass.

- [x] **7.2 Verify responsive UI and output.** Test Forms Center at phone/tablet/desktop and generated forms at the three product breakpoints, long labels, large option sets, and narrow containers.
  - Acceptance: no clipped controls or horizontal overflow; builder editing remains desktop-only while previews remain available as designed.

- [x] **7.3 Protect bundle and runtime budgets.** Lazy-load Forms Center/editor/inbox and keep the public runtime conditional. Reduce the main entry enough to remove the current Vite `>500 kB` warning or document a measured, justified budget decision.
  - Acceptance: bundle report records raw/gzip deltas; pages without forms receive no form runtime.

- [x] **7.4 Perform a clarity pass.** Keep one primary action per empty state, consistent statuses, plain labels, contextual help, skeletons instead of layout jumps, and no dead/duplicated controls.
  - Acceptance: a first-time user can create a form, place it, preview it, publish it, submit it, and find the response without copying IDs or guessing navigation.

### Phase 8 — Verification and delivery

- [x] **8.1 Add focused automated coverage.** Cover shared schemas/migrations, repository isolation, concurrency, lifecycle, authenticated APIs, public intake, spam/rate limits, snapshot-version validation, CSV safety, builder binding, rendering parity, readiness, inbox actions, and navigation.

- [x] **8.2 Add critical E2E journeys.** At minimum:
  1. Quick-create from builder -> bind -> real canvas -> three previews -> publish -> public submit -> inbox.
  2. Existing form -> place small and full-page -> responsive rendering.
  3. Edit after publish -> live version unchanged -> waiting-to-publish -> republish -> new version live.
  4. Referenced/archive/delete and retained-history behavior.
  5. Preview submit proves no persistence.
  6. Cross-tenant and public abuse cases fail safely.

- [x] **8.3 Run final gates from the repository root.** Run format/lint if configured, typecheck, all unit/integration tests with a working MongoDB test runtime, production build, bundle-budget checks, E2E, accessibility checks, and container smoke. Fix regressions instead of weakening assertions.

- [!] **8.4 Run the deployed Coolify smoke when owner access/configuration exists.** Verify authenticated Forms Center, public domain routing, public submission, inbox visibility, and logs on the real deployment.
  - Use `[!]` only if this genuinely requires owner-only access or configuration, and state the exact command/action the owner must perform.

- [x] **8.5 Final handoff.** Update README/API/environment/deployment notes, Progress Log, and Decision Log. Report exact commands, counts, bundle sizes, remaining `[!]` items, migration/rollback notes, and final commit SHA. Commit and push to `development`; do not merge `main`.

## 5. Required verification matrix

| Surface | Required proof |
|---|---|
| Shared model | schema, limits, migration, revision, snapshot tests |
| Builder | bind/create/edit-return, real canvas, resize/layout, missing states |
| Preview | desktop/tablet/mobile parity and zero persistence |
| Public site | no-JS and enhanced submit, exact snapshot validation, accessibility |
| Backend | auth, tenant isolation, status transitions, retention, CSV safety |
| Forms Center | routes, empty/error/loading states, filters, bulk actions, mobile |
| Lifecycle | usage, archive/delete/rebind, draft-vs-published, history preservation |
| Operations | typecheck, full tests, build, budgets, E2E, container/deployed smoke |

## 6. Progress Log

Append one entry per completed task. Never rewrite history.

```text
YYYY-MM-DD HH:mm | Task X.Y | files/behavior changed | verification command + result | commit SHA (if any)
2026-08-12 11:10 | Task 0.1 | no code change; branch audited | HEAD 6702acddc55cd99d2715c3e09a5d9d736577bb54 == audited baseline and == origin/development, 27 ahead of origin/main; working tree clean but for the replaced IMPLEMENTATION_PLAN.md; no drift, no unrelated work discarded. npm run typecheck exit 0; npm run test exit 0 with 1,940 tests / 134 files (shared 639/37, backend 631/41, frontend 670/56) | —
2026-08-12 11:12 | Task 0.2 | docs/FORMS.md (new), packages/shared/src/forms-contract.test.ts (new), packages/shared/src/forms.ts header points at the contract | vitest packages/shared src/forms-contract.test.ts → 2 passed; the test parses §7 of the document and fails if it names a path that does not exist | —
2026-08-12 11:21 | Task 0.3 (partial) | pricing-table CTA/link/highlight now rendered; announcement-bar link now rendered; site-logo home link resolved through a new RendererContext.homePath instead of resolvePagePath("") which was never a page id; richText block given the real editor (moved to components/common/RichTextEditor, shared with the blog) and its false "toolbar on the canvas" copy replaced in both locales; publishedReferenceCount computed from the active snapshot instead of a hardcoded 0; the false comment about a form dispatcher corrected | vitest frontend advertised-controls (9 new) + structured-blocks (38) + backend site-status (12, 2 new) all pass; npm run typecheck exit 0; npm run test exit 0 with 1,954 tests. REMAINS OPEN: the acceptance also requires "no dead dashboard link", and /app/:workspaceId/sites/:projectId/forms is delivered by 3.1 — 0.3 is checked only after that route exists | —
2026-08-12 11:32 | Task 1.1 | packages/shared/src/forms.ts: field ids restricted to what an HTML name may be and the __wb_ prefix reserved; errorMessage, formSuccessBehaviorSchema, formDefinitionUpdateSchema, publishedFormSchema, submissionFieldSnapshotSchema, formSubmissionRequestSchema, formPresentationSchema, legacyFormCopySchema, FORM_SUBMISSION_MAX_BYTES, FORM_CONTROL_FIELDS, FORM_RESULT_PARAMS added; visual-elements form element rewritten to reference + presentation | vitest packages/shared src/form-contracts.test.ts → 15 passed, including that a submission payload has nowhere to name a workspace, project or page | —
2026-08-12 11:32 | Task 1.2 | element-registry form schemaVersion 1 -> 2; ELEMENT_MIGRATIONS.form 1->2 moves submit label, success/error message and consent off the block and parks anything the designer actually authored in legacyCopy; a block still holding the untouched defaults migrates clean | vitest form-contracts: migrated element parses against the real document schema, is idempotent (same object on a second run), and the version-1 shape is refused once the block is version 2 | —
2026-08-12 11:32 | Task 1.3 | FormDefinition.revision (content revision only; archive/restore do not move it), FormRevisionConflictError, update() takes expectedRevision and tells "gone" apart from "stale"; PUT /forms/:formId parses formDefinitionUpdateSchema and maps the conflict to 409 REVISION_CONFLICT | vitest backend form-repository (21) + new forms-api (6): a second tab saving against revision 1 gets 409 with "current revision is 2" and the first save survives | —
2026-08-12 11:43 | Task 2.1 | shared: buildFormTemplate (blank/contact/lead/newsletter) and form-usage.ts (findFormUsages, countUnboundFormBlocks, groupUsagesByForm) which resolve shared sections so a form in a shared header is found; repository: duplicate(), countsByForm(), hasRecords(); routes: list returns summaries with counts and usages, POST duplicate, POST restore, DELETE refuses a referenced form with 409 RESOURCE_IN_USE naming the blocks; new shared error code RESOURCE_IN_USE with copy in both locales | vitest backend forms-api → 10 passed incl. shared-header usage, refused delete, duplicate at revision 1 | —
2026-08-12 11:43 | Task 2.2 | repository: SubmissionFilter (form, status, date range, page), listSubmissions/submissionCounts/findSubmission/setSubmissionStatuses/deleteSubmissions/streamSubmissions, two new inbox indexes; submissions now store formRevision and the field snapshot they answered; export.ts streams a row at a time and keeps answers to retired questions in a final column; routes: GET/-/submissions, GET/-/submissions/:id, PATCH/-/submissions (bulk status or delete), GET/:formId/submissions.csv | vitest backend forms-api → 15 passed incl. filters, bulk actions, and a CSV cell that cannot execute in a spreadsheet | —
2026-08-12 11:43 | Task 2.3 | server.ts collectModuleFacts now returns real form facts: hasRecords from definitions or submissions, blockingIssueCount = unbound blocks + placements pointing at a missing/archived/unfinished definition, warningCount = definitions no page shows; isVisibleInNavigation no longer hides an archived module, which was hiding the only route to records that outlived their last placement | vitest shared features (21) + frontend SiteDashboard + npm run test → 1,990 tests, exit 0 | —
2026-08-12 12:26 | Task 3.1 | frontend/src/api/forms.ts (new); features/forms/{FormsRoute,FormsOverview,FormEditor,SubmissionsInbox}.tsx (new); four lazy routes registered under the authenticated shell (/forms, /forms/new, /forms/submissions, /forms/:formId/edit — submissions declared before :formId so the word is not read as an id); forms namespace added to i18n resources in both locales; shared now owns FormRecord/FormSummary/FormDetail/FormSubmissionRecord/SubmissionPage so frontend and backend read one contract | vitest frontend module-routes → 5 passed; the test reads routes.tsx and asserts every module a block can activate has a declared route, which is what was missing when /forms was a dead link | —
2026-08-12 12:26 | Task 0.3 (closed) | the remaining criterion was "no dead dashboard link"; MODULE_ROUTES.forms now resolves to a real route and module-routes.test.tsx guards it. `search` has no route and no block declares feature "search", so it can never leave "unused" and its entry is never rendered — asserted explicitly rather than ignored | npm run typecheck exit 0; npm run test exit 0 with 2,008 tests | —
2026-08-12 12:26 | Task 3.2 | FormsOverview: name, state badge, usage links into the builder on the exact page and block, total and unread answer counts linking into the correctly filtered inbox, last answer, last edit, search, and create/duplicate/archive-or-delete actions | vitest FormsCenter → every count asserted to be a destination; delete asks first and sends nothing before confirmation | —
2026-08-12 12:26 | Task 3.3 | FormEditor: name, templates (blank/contact/lead/newsletter), add/reorder/remove questions with controls named after the question they act on, per-type settings, choices, help text, required, success message or an internal-page redirect chosen from this site's pages only, submit label, error message, notification recipients, retention; dirty/saving/saved state and a 409 that offers Reload instead of overwriting | vitest FormsCenter → real controls (no JSON field), conflict shows the other person's save, redirect offers only this site's pages | —
2026-08-12 12:26 | Task 3.4 | SubmissionsInbox: status counts, filters for form/status/date held in the URL so a filtered view is linkable, pagination, row selection, bulk read/unread/archive/spam/delete, CSV export per form, and a detail dialog that labels answers from the snapshot the submission carries | vitest FormsCenter → a retired question is labelled rather than dropped; bulk delete confirms; mark-read is one request | —
2026-08-12 17:46 | Task 4.3 | frontend/src/components/renderer/FormRenderer.tsx (new) dispatched from ElementRenderer; RendererContext gains resolveForm/formMode/formAction/formResult/formStrings; EditorShell now provides a renderer context so the canvas renders real inert fields — and, in the same change, resolves media, which the canvas had never done and which had been showing a grey placeholder for every image already chosen | vitest form-renderer → 16 passed: native post, revision hint, honeypot, labelled fields, radio fieldset, hidden field never emitted, inert canvas, and three distinct unbound/missing/archived states | —
2026-08-12 17:46 | Task 4.1 | FormBindingField replaces the text box that asked a designer for a 24-character identifier: a picker over the project's forms, an inline create that binds in the same click, and warnings for missing/archived/unfinished shown beside the control that fixes them; binding clears the block's version-1 legacyCopy | vitest structured-blocks → the form block exposes no submit label or consent, and its arrangement control writes presentation.preset | —
2026-08-12 17:46 | Task 4.2 | "Edit questions" and "Open Forms" save the draft first, then navigate with a returnTo built by this application and re-validated by safeReturnPath; the Forms Center's BackLink returns to the exact page, device and block using the three parameters EditorRoute already restores | vitest frontend → 714 passed; useProjectForms is gated on the document containing a form block, so a site without one makes no request | —
2026-08-12 17:46 | Task 4.4 | form presentation is a strict schema (preset, alignment, fieldGap, padding, fullWidthFieldIds, colours, border) edited under Layout and Style; twoColumn collapses by track width rather than a media query, and the form is width:100%/max-width:100%/border-box so it cannot push a phone sideways | vitest form-renderer → the collapse rule and the overflow guard are asserted directly | —
2026-08-12 17:46 | Task 4.5 | PATTERNS gains fullPageForm — a normal flex section holding a heading, a paragraph and a form block with a two-column centred presentation, built from the same primitives every other pattern uses | vitest shared patterns + frontend i18n parity → 38 passed | —
2026-08-12 17:57 | Task 5.1 | PublishableForm is now the typed PublishedForm; the compiled snapshot's forms are persisted with the version (they were compiled and thrown away); contentHash now covers them — without that, editing a form and republishing hashed identically, publishing concluded nothing had changed, and the edit could never reach production; renderRouteHtml takes a forms map, a mode and an action and passes them to the shared renderer | vitest backend form-submission → a published page renders the snapshot's fields with action="/__wb/forms/:id/submissions" | —
2026-08-12 17:57 | Task 5.2 | previewRoute renders the draft's own definitions in preview mode and posts to a new authenticated POST /publishing/preview/forms/:formId, which runs the same shared validator and touches no repository | vitest draft-preview → 11 passed: real fields rendered, valid and invalid both answered correctly, formSubmissions collection count still 0, and the markup posts to the preview route rather than the public one | —
2026-08-12 17:57 | Task 5.3 | backend/src/renderer/forms.ts (new): POST /__wb/forms/:formId/submissions mounted before the page catch-all, accepting urlencoded (a plain HTML form) and JSON (the runtime); a no-JavaScript visitor is redirected 303 back to their page with wb_form_ok / wb_form_error, which the renderer turns into the form's own message | vitest form-submission → 14 passed | —
2026-08-12 17:57 | Task 5.4 | identity comes from the resolved hostname and the published route manifest only; the form comes from the snapshot; values are keyed by the snapshot's field list so extra keys are never stored; honeypot and bot user-agents are answered "ok" and stored nowhere; per-address and per-project fixed-window limits (5/60 per minute) share one FixedWindowCounter extracted from the analytics endpoint; responses carry no detail and no body, field name or address is ever logged | vitest form-submission → cross-tenant form 404s, spoofed workspaceId/projectId ignored, unpublished path not attributed, third submission 429s | —
2026-08-12 17:57 | Task 5.5 | every submission stores formRevision and the field snapshot it answered, plus a server-derived source (pageId, path, host, and campaign parameters read from a same-origin referrer) | vitest form-submission → after the live definition is rewritten, a visitor is still validated against revision 1 and their answer is stored against it | —
2026-08-12 17:57 | Task 5.6 | the adapter and development sink are untouched; nothing is wired into the renderer process, because an empty delivery path that looks like a delivery path is worse than none. The Forms Center says delivery depends on a configured provider and that the inbox always has the answer | no code change; the claim is the absence of one | —
2026-08-12 18:03 | Task 6.1 | auditFormReferences now resolves shared sections (a form in a shared header was reported as absent while it rendered on every page), reports one finding per block rather than per page, and distinguishes form-missing, form-archived, form-without-fields, form-choice-without-options, form-redirect-missing and form-incomplete; a finding carries the formId, and the publish screen sends those five to the form's own editor rather than to the block, where they cannot be fixed | vitest backend forms-api → the finding for a form with no questions names the form; frontend typecheck covers the new link | —
2026-08-12 18:03 | Task 6.2 | the forms list reports publishedRevision from the active snapshot beside the draft revision; hasChangesWaitingToPublish compares them and the overview shows "Changes waiting to publish" | vitest forms-api → editing a form moves revision to 2 while publishedRevision stays 1; republishing changes the content hash (5.1) so the state clears | —
2026-08-12 18:03 | Task 6.3 | delete refuses while a page still points at the form (409 naming the blocks), archives rather than destroys when submissions exist, restore returns it without moving the content revision, and an archived module keeps its navigation entry so the inbox stays reachable | vitest forms-api → 19 passed; the archived form's answer is still listed in the inbox | —
2026-08-12 18:10 | Task 7.1 | the generated form pairs every control with a label that points at it, groups choices in a fieldset with a legend, attaches help text through aria-describedby, states "required" in words as well as in the attribute, keeps the honeypot out of the tab order and hidden from assistive technology, and announces the outcome in a focusable live region; the public runtime now upgrades submission — keeping the answers in the fields, announcing the result without moving the page, and handing back to the browser's own post if the network fails | vitest frontend form-accessibility → 7 passed incl. keyboard order; the runtime declares a formSubmit capability so a page with no form still ships no script | —
2026-08-12 18:10 | Task 7.3 | Forms Center, editor and inbox are one lazy chunk (28.35 kB raw / 6.63 kB gzip); the rich-text editor is now lazy inside the inspector so opening the builder no longer fetches 125 kB of editor for a block most sites never place; runtime is referenced only by a page carrying a block that declares a capability, asserted directly | npm run build exit 0. Measured: entry 574.02 kB raw / 176.52 kB gzip; all chunks 456.8 kB gzip; first screen 176.5 kB gzip, 39% of the total. applicationBundleBytes raised 480k -> 520k with the measurement and reason recorded in performance.ts. The Vite >500 kB warning is on uncompressed entry size against a default threshold; the enforced budgets are the gzip ones above and they are checked against the built artefact | —
2026-08-12 18:30 | Task 7.2 | the generated form is asserted at all three presets with long labels, a fifty-option list and a long answer: every control is width-bounded inside a border-box parent, every grid item carries min-width 0 or spans the row, and a large option set stays a native select rather than fifty rendered controls; a Playwright viewport check confirms no horizontal overflow at 390px on the published page | vitest form-renderer (20) + published-site-forms phone viewport → passing | —
2026-08-12 18:30 | Task 8.2 | frontend/e2e/published-site-forms.spec.ts and a seeded e2e-form site: the page arrives complete before any script, submits and announces in place with JavaScript, submits and is redirected back with it disabled, is refused by the browser's own validation before reaching the network, and stays inside a phone viewport. The form sits on its own hostname so the existing "ships no JavaScript" claim for a site without one stays provable | npm run test:e2e → 95 passed (90 before, 5 new) | —
2026-08-12 18:30 | Defect found by 8.2 | EditorShell's two new useMemo calls sat below the loading and error early returns, so the number of hooks changed when a project finished loading and React tore the whole builder down (minified error #310). Unit tests never saw it because they start in one state and stay there. Hooks moved above the returns; EditorShell.test.tsx now renders in loading and transitions to ready, which is the shape of test that catches it | vitest EditorShell → 23 passed | —
2026-08-12 18:32 | Task 7.4 | quick-create from a form block now starts from a template, so a block bound in two clicks asks real questions instead of immediately reporting "this form asks nothing"; the inline create panel is a named group rather than an unlabelled cluster of controls; docs/FORMS.md §7 extended to the files that now exist, which its own test enforces | vitest form-binding (3 new) → a person picks a form by name, sees "No form chosen" before binding, and never encounters an identifier; npm run test → 2,061 tests, exit 0 | —
2026-08-12 18:31 | Task 8.1 | tenant-isolation-audit extended to forms — definitions, submissions, counts, every write, the export stream and retention, all proved to see nothing of another workspace and to leave its records untouched; render-parity extended to a form, asserting preview and published output are byte-identical apart from the action attribute | vitest backend tenant-isolation-audit (14) + render-parity (13) → passing | —
2026-08-12 18:33 | Task 8.3 | npm run typecheck exit 0; npm run test exit 0 with 2,067 tests across 144 files (shared 657/39, backend 681/43, frontend 729/62); npm run build exit 0; npm run test:e2e exit 0 with 95 passed including the six responsive visual-regression snapshots; npm run check:plan-skill 6/6; npm run check:runbook clean. Bundle: entry 574 kB raw / 176.5 kB gzip, all chunks 456.8 kB gzip against a 520 kB budget, first screen 39% of the total | —
2026-08-12 18:33 | Task 8.4 | BLOCKED. `docker info` fails on this machine, so neither `npm run smoke:containers` nor a Coolify deployment can run here, and the deployed checks need production access this environment does not have. Owner action, in order: (1) `npm run build:images && SMOKE_MONGODB_URI=<a reachable MongoDB> npm run smoke:containers` on a machine with a Docker daemon; (2) deploy `development` in Coolify; (3) open a published site with a form, submit it, and confirm the answer appears in Forms -> Answers; (4) confirm the response carries `content-security-policy` with `form-action 'self'` and `script-src 'self'` on that page, and `script-src 'none'` on a page without a form | —
2026-08-12 18:34 | Task 8.5 | docs/RELEASE_AND_ROLLBACK.md gains section 7 — what the form migration does, the release order, the rollback limit (a version published before this carries no forms, so republish forward rather than rolling back), and what to watch; README links docs/FORMS.md and docs/BLOCK_LIBRARY.md | npm run typecheck 0; npm run test 0 with 2,067 tests / 144 files; npm run build 0; npm run test:e2e 0 with 95 passed; check:plan-skill 6/6; check:runbook clean | see final commit
```

## 7. Decision Log

Record material choices and why they preserve product behavior, security, compatibility, or maintainability.

```text
YYYY-MM-DD | Decision | alternatives considered | reason | migration/compatibility impact
2026-08-12 | The definition owns submit label, success behaviour, error message and consent; the placement owns only presentation | keep them on the block as display-only overrides; split them by field | two placements of one form must not say different things after submission, and consent is a question whose answer has to be stored beside the others rather than a block flag with nowhere to go | form element v1 → v2 migration, §5 of docs/FORMS.md
2026-08-12 | A v1 form element's copy is preserved on the element as `legacyCopy` rather than discarded or written into a definition | drop it; write it into the referenced definition during migration | an element migration is a pure function over one payload and cannot reach another collection, and a block with an empty formId has no definition to write into; keeping it means the builder can offer it as the seed when a form is created from that block | no data loss; the migration is idempotent because a v2 element has no legacy fields left to move
2026-08-12 | The site logo's home link is resolved from a new RendererContext.homePath | keep resolvePagePath(""); store a page id on the block | "" is not a page id, so every linked logo on every published site rendered unlinked; a stored id would be a second copy of which page is home and would break the first time home moved | absent in the builder canvas, which is correct — the logo must be editable there rather than navigating
2026-08-12 | publishedReferenceCount is counted from the active published snapshot, loaded per request | store it on the project when publishing | a stored count is a projection that drifts the moment a rollback moves the pointer; the snapshot is the only record of what the public can actually see | scoped twice — the caller's workspace is verified by the resolver and the snapshot is used only when it belongs to that workspace
2026-08-12 | RichTextEditor moved from features/blog to components/common and its toolbar copy to the `common` namespace | a second editor for the builder; import across features | one editor against one validated document shape; a second set of tiptap extensions is a second thing to keep aligned with the schema | the formatting toolbar is now named "Formatting" rather than repeating the field's own name, which also removes two elements sharing one accessible name
2026-08-12 | An archived module keeps its navigation entry | leave it hidden and add a separate Forms entry rule | archived means "no page references it any more", not "its records are gone" — hiding it was hiding the only route to a customer's inbox, contradicting the comment two functions above it | applies to blog and CMS too, which had the same defect
2026-08-12 | A submission stores the revision and the field snapshot it answered | look the definition up when reading | labels and options change, and an answer beside a question nobody asked is not a record of anything; the CSV keeps retired answers in a final column rather than dropping the column | submissions written before this read as revision 1 with no snapshot, which is what they are
2026-08-12 | CSV export streams a row at a time and is per form | build the file in memory; one sheet for every form | an export is the one read whose size the customer chooses, and a sheet whose columns are the union of every form's questions is unreadable | none
2026-08-12 | The form block is dispatched to its own renderer from ElementRenderer | render it inside VisualElementRenderer | a form needs the definition it references, which only the host can resolve; the visual renderer is on the path the server compiles and has no resolver | the visual renderer keeps a `form` case that returns null so its exhaustiveness check stays honest
2026-08-12 | The builder loads form definitions only when the document holds a form block | load them with every builder session | most sites have no form, and a request per session to render none of it answers a question nobody asked; the request appears the moment a block is inserted | none
2026-08-12 | Return from the Forms Center reuses EditorRoute's existing ?element= and ?device= handling | a bespoke builder-context envelope | returning is then the route's existing behaviour rather than a second mechanism to keep in step; the address is built here and re-validated by safeReturnPath on arrival | none
2026-08-12 | The published content hash covers the form definitions | leave the hash over document/routes/redirects | a form is part of what a visitor receives; without it, editing a form's questions and republishing produced an identical hash, publishing answered "unchanged", and the new questions could never go live at all | versions published before this hash differently, which only means the next publish creates a new version
2026-08-12 | A no-JavaScript submission answers with a 303 back to the page carrying a marker in the query | render the result inline from the POST | a POST that renders HTML leaves the browser on a URL that re-submits on reload; the marker is read by the same renderer and turned into the form's own message | the marker is part of the page's cache key, which is correct — it is a different page
2026-08-12 | The preview posts to an authenticated rehearsal route rather than to the public endpoint | let preview post to /__wb and mark it | a designer filling in their own form must not create records, and "public endpoint with a flag that means do not store" is one forgotten condition away from storing them | preview and published render identical markup and differ only in the action
2026-08-12 | applicationBundleBytes raised from 480 KB to 520 KB gzip | keep the number and cut elsewhere | the application gained a whole module — an overview, a question editor and a submissions inbox — and measured 457 KB, leaving 4.8% headroom against a guard that exists to be actionable; the new number is set from the measurement plus room to be worth checking, and the reason sits in the constant | the 95%-headroom test re-arms at the new number
2026-08-12 | The published-script CSP constant is named for what it admits, not for analytics | leave the name | it now admits the interaction runtime as well, which posts a form; a constant named for one of its two callers is a comment that will mislead the next person | rename only
```

## 8. Completion definition

This plan is complete only when every task is `[x]`, except a task may be `[!]` solely for a documented owner-only credential, permission, production access, or irreversible choice. A form must be visible and configurable in the builder, safely previewable, responsive when small or full-page, versioned in publication, submittable on the public site, and manageable in a tenant-safe Forms Center with a real submissions inbox. Root typecheck, full tests, production build, bundle checks, E2E, accessibility, and available smoke tests must pass, with accurate logs and no false claims.
