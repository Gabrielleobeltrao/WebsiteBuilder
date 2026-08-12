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

- [ ] **0.3 Correct false-positive completion gaps from the previous plan.** At minimum verify and fix: rich-text editing is actually usable; pricing-table CTA/link/highlight rendering; announcement-bar link rendering; site-logo home link resolution; form route/rendering claims; published reference counts.
  - Acceptance: each advertised control affects editor, preview, and public output where applicable; no dead dashboard link.
  - Verify: focused unit/integration tests and renderer parity tests.

### Phase 1 — Shared form model and migration

- [ ] **1.1 Introduce versioned shared form contracts.** Add strict schemas for definition revision, placement presentation, published form snapshot, public submission request/result, submission source, and stored schema snapshot.
  - Acceptance: unknown fields are rejected; limits exist for field count, labels, options, and payload size; all schemas are shared by frontend/backend/renderer.

- [ ] **1.2 Migrate legacy form elements safely.** Convert raw/duplicate block properties to the canonical definition/placement model while preserving old documents and published snapshots.
  - Acceptance: old documents load without data loss; newly saved documents use the new schema; migration is idempotent and tested.

- [ ] **1.3 Add optimistic concurrency and revision semantics.** Definition updates require the expected revision and return a typed conflict response.
  - Acceptance: two tabs cannot silently overwrite one another; the UI can reload or intentionally retry.

### Phase 2 — Complete authenticated form APIs

- [ ] **2.1 Finish definition services and routes.** Add templates, usage lookup, archive/restore, duplicate, and safe delete/rebind checks on top of the existing repository.
  - Acceptance: a referenced form cannot be silently deleted; usages identify page and block; forms with submissions archive instead of destructive deletion.

- [ ] **2.2 Expose tenant-safe submission management APIs.** Implement list/detail/counts, filters by form/status/date/page/source, pagination, mark read, archive, spam, safe delete, bulk actions, and streamed CSV export with formula-injection protection.
  - Acceptance: every query is scoped by authenticated workspace/project; indexes support main filters; large exports do not load everything into memory.

- [ ] **2.3 Reconcile site module facts.** Include form block references, definitions, retained submissions, unread totals, incomplete configuration, archived references, and publish staleness in the existing status/readiness system.
  - Acceptance: optional navigation, badges, status cards, and blockers derive from server facts rather than frontend guesses.

### Phase 3 — Forms Center UX

- [ ] **3.1 Add real routes under the existing authenticated site shell.** Implement:
  - `/app/:workspaceId/sites/:projectId/forms`
  - `/app/:workspaceId/sites/:projectId/forms/new`
  - `/app/:workspaceId/sites/:projectId/forms/:formId/edit`
  - `/app/:workspaceId/sites/:projectId/forms/submissions`
  - Acceptance: direct navigation, refresh, breadcrumbs, permissions, loading, empty, error, and not-found states work.

- [ ] **3.2 Build the Forms overview.** Show form name, active/archived state, usage pages, total/new submissions, last submission, last edit, and draft changes waiting for publication. Include search/filter and clear create/duplicate/archive actions.
  - Acceptance: clicking usage opens the exact page/block; clicking counts opens the correctly filtered inbox.

- [ ] **3.3 Build a focused form editor.** Support name, templates (`Blank`, `Contact`, `Lead`, `Newsletter`), add/reorder/duplicate/delete fields, field settings/options/validation, success message or safe redirect, retention, autosave state, and revision conflicts.
  - Acceptance: keyboard operation, validation, dirty/saving/saved/error states, and mobile data-page layout are usable; no canvas is needed here.

- [ ] **3.4 Build the submissions inbox.** Add summary counts, filters, pagination, selectable rows, bulk status actions, CSV export, and an accessible detail drawer/page showing preserved historical labels and source context.
  - Acceptance: unread badge updates consistently; actions are reversible where practical; destructive actions require explicit confirmation.

### Phase 4 — Builder binding and actual visual

- [ ] **4.1 Replace raw `formId` editing with a form binding control.** The right inspector must show current form, searchable “Choose existing form”, “Create new form”, “Edit fields/settings”, usage, and missing/archived warnings.
  - Acceptance: users never need to copy an ID; create binds automatically; rebind is explicit; unbind does not delete the definition.

- [ ] **4.2 Implement quick-create and safe edit-and-return.** From a selected form block, allow name/template creation inline or open the Forms Center. Autosave the page draft before leaving and preserve a signed/validated internal `returnTo` containing project, page, selected block, and device preview.
  - Acceptance: returning restores the exact builder context; unsafe external return URLs are rejected.

- [ ] **4.3 Render the actual form in the canvas.** Use the shared renderer with editor mode: fields are visible, styled, selectable as one block, and cannot submit or steal builder drag/resize interactions.
  - Acceptance: no placeholder word and no `null` output; loading, unbound, missing, archived, and valid states are visually distinct and actionable.

- [ ] **4.4 Add responsive presentation controls.** Expose preset, width, alignment, spacing, field spans, visual style, and normal free/grid/flex geometry without duplicating definition data.
  - Acceptance: the form can be full-page, full-section, column-sized, or compact; Desktop/Tablet/Mobile previews remain inside their viewport with no horizontal overflow.

- [ ] **4.5 Add the Full-page form pattern.** Insert a responsive section/container/form composition and open binding immediately.
  - Acceptance: pattern uses normal primitives, can be detached/edited, and compiles through the same pipeline.

### Phase 5 — Preview, publication, and public submission

- [ ] **5.1 Pass published forms into the shared renderer.** Resolve form placements against the draft definition in editor/preview and the embedded immutable revision in public rendering.
  - Acceptance: editor, clean preview, and published site share markup/styles and differ only by mode-specific behavior.

- [ ] **5.2 Make preview safe.** Desktop/Tablet/Mobile preview shows validation and success behavior without creating database records or firing notifications.
  - Acceptance: preview is clearly labeled when submitting; automated tests prove zero persisted submissions.

- [ ] **5.3 Implement the same-origin public endpoint.** Add `POST /__wb/forms/:formId/submissions` in the public renderer path. Resolve `Host -> active site -> active immutable snapshot -> exact form revision`; do not validate against a newer live definition.
  - Acceptance: native HTML POST works without JavaScript; the small public runtime progressively enhances submission and inline errors.

- [ ] **5.4 Harden public intake.** Enforce body/field limits, strict allowlists, required/type validation, honeypot, rate limiting, duplicate suppression, tenant isolation, safe redirect rules, privacy-conscious IP/user-agent handling, and structured audit logs without field values.
  - Acceptance: arbitrary fields, cross-tenant IDs, oversized payloads, spam paths, and forged page/source identifiers are rejected or classified safely.

- [ ] **5.5 Preserve historical meaning.** Store definition ID/revision plus a minimal field-schema snapshot with each submission. Compute project/site/page/path and accepted campaign parameters server-side from trusted request context.
  - Acceptance: old submissions remain readable after labels/options change or old published versions are pruned.

- [ ] **5.6 Keep notifications provider-neutral.** Preserve the existing adapter and development sink, but do not claim production email delivery without a configured provider.
  - Acceptance: the Forms inbox is the reliable source of truth; notification status is explicit and failures never lose submissions.

### Phase 6 — Readiness, publish lifecycle, and deletion rules

- [ ] **6.1 Add actionable form readiness findings.** Detect unbound block, missing definition, zero usable fields, invalid redirect, archived referenced form, invalid field options, and definition changes newer than the active publication.
  - Acceptance: each finding opens the exact form or builder block; publish blocks only on genuine errors and distinguishes warnings.

- [ ] **6.2 Implement draft-versus-published messaging.** Forms Center and builder show “Changes waiting to publish” when the draft definition revision differs from the active snapshot.
  - Acceptance: editing a form never mutates a live site silently; republish clears the state.

- [ ] **6.3 Finalize lifecycle behavior.** Prevent deletion while referenced, offer “show usages”, rebind, or remove placements; archive forms with retained submissions; keep historical inbox access after the last placement is removed.
  - Acceptance: no orphaned blocks, inaccessible history, or accidental cascading deletion.

### Phase 7 — Accessibility, responsiveness, performance, and clarity

- [ ] **7.1 Make generated forms accessible.** Correct labels, fieldsets/legends, descriptions, required/invalid semantics, error summary, focus movement, keyboard order, contrast, and reduced-motion behavior.
  - Acceptance: automated accessibility checks plus keyboard-only create, fill, error, correct, and submit paths pass.

- [ ] **7.2 Verify responsive UI and output.** Test Forms Center at phone/tablet/desktop and generated forms at the three product breakpoints, long labels, large option sets, and narrow containers.
  - Acceptance: no clipped controls or horizontal overflow; builder editing remains desktop-only while previews remain available as designed.

- [ ] **7.3 Protect bundle and runtime budgets.** Lazy-load Forms Center/editor/inbox and keep the public runtime conditional. Reduce the main entry enough to remove the current Vite `>500 kB` warning or document a measured, justified budget decision.
  - Acceptance: bundle report records raw/gzip deltas; pages without forms receive no form runtime.

- [ ] **7.4 Perform a clarity pass.** Keep one primary action per empty state, consistent statuses, plain labels, contextual help, skeletons instead of layout jumps, and no dead/duplicated controls.
  - Acceptance: a first-time user can create a form, place it, preview it, publish it, submit it, and find the response without copying IDs or guessing navigation.

### Phase 8 — Verification and delivery

- [ ] **8.1 Add focused automated coverage.** Cover shared schemas/migrations, repository isolation, concurrency, lifecycle, authenticated APIs, public intake, spam/rate limits, snapshot-version validation, CSV safety, builder binding, rendering parity, readiness, inbox actions, and navigation.

- [ ] **8.2 Add critical E2E journeys.** At minimum:
  1. Quick-create from builder -> bind -> real canvas -> three previews -> publish -> public submit -> inbox.
  2. Existing form -> place small and full-page -> responsive rendering.
  3. Edit after publish -> live version unchanged -> waiting-to-publish -> republish -> new version live.
  4. Referenced/archive/delete and retained-history behavior.
  5. Preview submit proves no persistence.
  6. Cross-tenant and public abuse cases fail safely.

- [ ] **8.3 Run final gates from the repository root.** Run format/lint if configured, typecheck, all unit/integration tests with a working MongoDB test runtime, production build, bundle-budget checks, E2E, accessibility checks, and container smoke. Fix regressions instead of weakening assertions.

- [ ] **8.4 Run the deployed Coolify smoke when owner access/configuration exists.** Verify authenticated Forms Center, public domain routing, public submission, inbox visibility, and logs on the real deployment.
  - Use `[!]` only if this genuinely requires owner-only access or configuration, and state the exact command/action the owner must perform.

- [ ] **8.5 Final handoff.** Update README/API/environment/deployment notes, Progress Log, and Decision Log. Report exact commands, counts, bundle sizes, remaining `[!]` items, migration/rollback notes, and final commit SHA. Commit and push to `development`; do not merge `main`.

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
```

## 8. Completion definition

This plan is complete only when every task is `[x]`, except a task may be `[!]` solely for a documented owner-only credential, permission, production access, or irreversible choice. A form must be visible and configurable in the builder, safely previewable, responsive when small or full-page, versioned in publication, submittable on the public site, and manageable in a tenant-safe Forms Center with a real submissions inbox. Root typecheck, full tests, production build, bundle checks, E2E, accessibility, and available smoke tests must pass, with accurate logs and no false claims.
