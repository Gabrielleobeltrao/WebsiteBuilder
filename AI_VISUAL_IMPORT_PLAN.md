# AI visual import — implementation plan

Add a section to a page by pointing at a reference: a URL, or screenshots of it. The reference is
read for **shape only** — position, size, hierarchy, spacing, proportion, colour, approximate
typography — and never for content. What lands in the document is an ordinary `BuilderSection` made
of registered blocks with placeholder copy, indistinguishable from one somebody dragged together by
hand, and editable the same way.

The section is the whole of the first delivery. Page and full-site import reuse the same engine
afterwards, and are planned here so the engine is not built in a shape that cannot carry them.

---

## 1. Execution contract

- Work only on `development`. `main` is promoted by fast-forward, never by a merge from this work.
- One task at a time. Load it with
  `node .claude/skills/execute-plan-task/scripts/extract-plan-task.mjs <TASK-ID> --plan AI_VISUAL_IMPORT_PLAN.md`.
- Read the code a task touches before changing it. Implement the acceptance criteria fully.
- Every task adds tests that fail without its change. Never assert that a button exists as a proxy
  for behaviour.
- Any visible copy updates **both** `pt-BR` and `en-US`.
- Run focused tests, then `npm run typecheck`, `npm test` and `npm run build` before marking `[x]`.
- Append to the Progress Log after every task; append to the Decision Log only when the
  implementation departs from this plan.
- Never weaken validation, tenant isolation, accessibility or tests to make a task smaller.
- Nothing here may break publication, the shared renderer, autosave, blog templates, or documents
  already stored.

---

## 2. Relevant existing architecture

What this feature must fit into, read from the code rather than assumed.

| Piece | Where | Why it matters here |
|---|---|---|
| `BuilderSection` | `packages/shared/src/project.ts` | Strict Zod object: `id`, `name`, `role` (`content`/`header`/`footer`), `layoutMode` (`free`/`grid`/`flex`), `heightByBreakpoint`, `layoutByBreakpoint`, `elements`, `backgroundColor`, `hidden`. This is the import's output type — there is no other. |
| `builderElementSchema` | `packages/shared/src/elements.ts` | A discriminated union over `type`. An element that does not parse cannot enter a document, which is the property the whole import leans on. |
| `ELEMENT_REGISTRY` | `packages/shared/src/element-registry.ts` | Every block, its `defaults()`, its `schemaVersion`, its category and the contexts it may be placed in. The model may only choose from here. |
| Patterns | `packages/shared/src/patterns.ts` | `PatternDefinition.build({ copy, createId }) => BuilderSection` already produces a whole section from registry defaults plus overrides, and `insertPattern` inserts it in one undoable step. The import is the same act with a different author. |
| `MAX_CONTAINER_DEPTH` | `packages/shared/src/elements.ts` | Five. A generated tree deeper than this is refused rather than flattened silently. |
| Responsive values | `packages/shared/src/devices.ts`, `responsiveLayout` on every element | Structured allowlisted units and keywords. There is no raw CSS anywhere in a document, and the import introduces none. |
| Links | `packages/shared/src/links.ts` | A typed union including `{ kind: "none" }`. Every imported button and menu item gets that one. |
| `MediaStorage` | `backend/src/modules/media/storage.ts` | `put`/`openRead`/`delete`/`exists` over GridFS. The temporary screenshot store is another bucket behind the same interface, so nothing new has to be operated. |
| `FixedWindowCounter` | `backend/src/renderer/rate-limit.ts` | In-process rate limiting with no shared store. The import endpoints reuse it. |
| `Entitlement` / `LimitCheck` | `backend/src/modules/workspaces/entitlements.ts` | Where per-plan limits already live. Import quotas belong here, not in a new parallel notion of a plan. |
| `API_ERROR_CODES` | `packages/shared/src/api.ts` | `VALIDATION_ERROR`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `UNSUPPORTED_MEDIA_TYPE`, `UNKNOWN_HOST`, `SERVICE_UNAVAILABLE`, `REVISION_CONFLICT`. The import needs no new code except where a genuinely new condition exists. |
| Editor store | `frontend/src/features/editor/store/editorStore.ts` | `update()` for one undoable change, `save()` returning `ok`/`conflict`/`error`, a session generation that retires stale responses, autosave. Insertion goes through these and nothing else. |
| Feature switch precedent | `ANALYTICS_INGESTION_ENABLED` plus a per-site setting | Two switches, both of which must be open. Import copies that shape. |
| Browser automation | `@playwright/test`, a **frontend devDependency** | There is no browser in the backend image today. Capture is therefore a deployment decision, taken explicitly in D-4 rather than by `npm install`. |

Two existing rules constrain every line of this feature, from `CLAUDE.md`: never
`dangerouslySetInnerHTML` and no arbitrary HTML, CSS or JavaScript from users; and every business
query is scoped by a server-verified `workspaceId` before any resource id.

---

## 3. Product decisions

### D-1 The reference is read for shape, never for content

Nothing from the reference reaches the document: no text, image, video, logo, brand, contact detail
or link. This is not a filter applied at the end — it is what the pipeline produces. The model is
asked for a layout, and the sanitiser is a total function over its output, so a field that could
carry content either has no place in the schema or is replaced before validation.

The reason is not only legal. A layout somebody can edit is a starting point; a copy of a page they
do not own is a liability they did not ask for, and one they would have to find and remove.

### D-2 Two options, and the honest difference between them

- **Structure only** — geometry, hierarchy, spacing, proportion. Colours are the site's own theme
  defaults; typography is the site's own.
- **Structure and style** — the above plus background, colour, border, radius, shadow and an
  approximate typographic scale taken from the reference.

Both produce the same kind of section. The difference is how much of the reference's appearance is
carried, and the option is chosen before the job runs because it changes what the model is asked for.

### D-3 Output is a draft that a person confirms

An import never writes to the document on its own. It produces a draft the person previews at three
widths, and confirms into a chosen position. A refused or abandoned draft leaves the document
untouched, and the temporary inputs are deleted with it.

### D-4 Capture runs in an isolated browser, outside the API process

Rendering a stranger's URL is the most dangerous thing this product will do. It happens in a
dedicated process with no application credentials, no access to the database, and a network policy
that can reach the public internet and nothing else. The API talks to it over a narrow internal
contract and never forwards a user's session.

If the deployment cannot host that process, **the URL source is not shipped** and the screenshot
source is — which is why the phases deliver screenshots first. That is a real fallback, not a
formality.

### D-5 The provider is an adapter, and the domain never names one

`AiLayoutProvider` is an interface with one method. Which company answers it is configuration. The
sanitiser, the validator and the section builder are pure functions that never import a provider,
so the feature can be tested end to end with a fake and the vendor can be replaced without touching
the domain.

### D-6 Geometry is extracted deterministically before the model is asked anything

Where the source is a URL, the capture returns a box tree — element rectangles, computed spacing,
stacking — measured in the browser, not guessed by a model. The model's job is then classification
and grouping over measured boxes, which is a far smaller question than "invent a layout", and one
whose output can be checked against the measurements it was given.

Where the source is screenshots, there are no measurements, and the model's geometry is accepted
only after the sanitiser has clamped every value into the document's own units.

---

## 4. New contracts

All of it in `packages/shared` unless stated, because the frontend and the backend must agree.

```
ai-import.ts
  ImportSource       = { kind: "url"; url: string; crop?: Rect } | { kind: "screenshots"; assetIds: string[] }
  ImportFidelity     = "structure" | "structure-and-style"
  ImportViewport     = { device: DeviceMode; width: number; screenshotAssetId: string; boxes?: MeasuredBox[] }
  MeasuredBox        = { id, parentId, rect, role, textLines, aspectRatio, background?, border?, radius?, shadow?, fontSize?, fontWeight? }
  ImportRequest      = { source, fidelity, viewports, target: { pageId, position } }
  ImportJob          = { id, workspaceId, projectId, state, progress, error?, createdAt, expiresAt }
  ImportJobState     = "queued" | "capturing" | "extracting" | "generating" | "validating" | "ready" | "failed" | "cancelled"
  ImportedDraft      = { jobId, section: BuilderSection, warnings: ImportWarning[] }
  ImportWarning      = { code: "unsupported-block" | "depth-clamped" | "font-substituted" | "geometry-approximated"; detail: string }
```

`ImportedDraft.section` is a `BuilderSection` and nothing looser. It is produced by a pure
`buildSectionFromLayout(layout, { createId, copy })` that mirrors `PatternDefinition.build`, and it
parses through `builderSectionSchema` before it leaves the backend.

The model's own reply is a separate, deliberately narrow type — `AiLayoutProposal` — which carries
node kinds, rectangles and style hints and **has no field that can hold text, a URL or an asset**.
Anything the model says outside that shape is dropped at the parse boundary.

### Sanitisation, as a total function

`sanitizeLayout(proposal, options) => SanitizedLayout` runs before the section is built, and every
rule below is one of its branches:

| From the reference | What is produced |
|---|---|
| Text of any kind | A placeholder chosen by the node's role and its measured line count — a heading of one line, a paragraph of four — from the locale resources, never from the reference |
| Image, logo, background image | An empty `image` block with no `mediaId`, keeping the measured aspect ratio |
| Button, menu item | Generic label from the locale resources and `link: { kind: "none" }` |
| Video | An empty `video` block with no source, or a placeholder box when the block cannot exist without one |
| Form, embed, integration | A supported block with no external data; when there is none, an empty container of the same footprint |
| Icon | A registry icon chosen by shape, never fetched |
| Paid or unavailable font | The nearest permitted family, and a `font-substituted` warning |
| Anything unrecognised | An empty container of the same footprint, and an `unsupported-block` warning |

Two properties are tested directly rather than assumed: the sanitiser is **total** — every proposal
node maps to exactly one branch — and its output contains no string that appeared in its input.

---

## 5. Implementation phases

### Phase 0 — Contracts and sanitisation, with no capture and no model

- [ ] **P0-T1 Add the import contracts to the shared package.** Define `ImportSource`,
  `ImportFidelity`, `ImportViewport`, `MeasuredBox`, `ImportJob`, `ImportJobState`, `ImportedDraft`,
  `ImportWarning` and `AiLayoutProposal` with Zod schemas beside them. `AiLayoutProposal` must have
  no field capable of carrying text, a URL, a media id or arbitrary style.
  - Acceptance: a proposal containing extra keys is rejected by the schema rather than passed
    through; the types are exported from the package index; nothing in `packages/shared` imports a
    provider or a browser.
  - Verify: schema tests for acceptance and rejection, including a proposal that tries to smuggle a
    `text`, `href` or `src` field.

- [ ] **P0-T2 Implement sanitisation as a pure total function.** `sanitizeLayout` maps every
  proposal node to a permitted outcome using the table in Section 4, resolving copy through a
  caller-supplied `copy(key)` exactly as `PatternDefinition` does.
  - Acceptance: every node kind has a branch; a proposal carrying a brand name, a phone number, an
    email, a URL or an image reference produces a section containing none of those strings; a paid
    font maps to a permitted family with a warning.
  - Verify: a property test over generated proposals asserting no input string survives to the
    output, plus explicit cases for each row of the table.

- [ ] **P0-T3 Build a section from a sanitised layout.** `buildSectionFromLayout` produces a
  `BuilderSection` from registry defaults, clamping depth to `MAX_CONTAINER_DEPTH`, mapping
  rectangles to the document's structured responsive values, and choosing `layoutMode` from the
  measured arrangement.
  - Acceptance: the result parses through `builderSectionSchema`; every element type appears in
    `ELEMENT_REGISTRY` and is valid in the `page` context; a layout nested deeper than five levels is
    clamped with a `depth-clamped` warning rather than refused or silently flattened.
  - Verify: unit tests asserting schema validity, registry membership, depth clamping, and that a
    free/grid/flex arrangement each produce the matching `layoutMode`.

- [ ] **P0-T4 Add the feature switch and the per-workspace limits.** An environment switch
  (`AI_IMPORT_ENABLED`, default false) and an entitlement field for imports per day and per month,
  in `Entitlement` beside the limits that already exist.
  - Acceptance: with the switch off, every import route answers `404` and no collection is created;
    the limit is checked through `LimitCheck`, and exceeding it answers `RATE_LIMITED` with the limit
    and the current count.
  - Verify: route tests for both switch states, and a limit test that exhausts the allowance.

**Checkpoint 0:** the sanitiser and the section builder are complete, tested, and reachable by
nothing — no endpoint exists yet.

### Phase 1 — Screenshot import, end to end

- [ ] **P1-T1 Store uploaded screenshots temporarily.** A separate GridFS bucket behind the existing
  `MediaStorage` interface, with a TTL index and an `expiresAt`, scoped by workspace and project.
  - Acceptance: an upload is accepted only as PNG/JPEG/WebP within a size limit and answers
    `UNSUPPORTED_MEDIA_TYPE` or `PAYLOAD_TOO_LARGE` otherwise; the asset is invisible to the media
    library; a record past `expiresAt` is deleted and its bytes with it; another workspace cannot
    read it by id.
  - Verify: integration tests over the real storage for accept, refuse, expiry and cross-tenant read.

- [ ] **P1-T2 Add the job model and its endpoints.** `POST` to start, `GET` for state and progress,
  `DELETE` to cancel. States as in Section 4, workspace-scoped throughout, with an audit record of
  who started what and against which project.
  - Acceptance: a job belongs to one workspace and is invisible to another; cancelling a running job
    stops the work and deletes its temporary inputs; progress only moves forward; a failed job
    carries a reason the interface can render.
  - Verify: HTTP tests for the lifecycle, cancellation, cross-tenant refusal, and the audit record.

- [ ] **P1-T3 Define the provider adapter and a deterministic fake.** `AiLayoutProvider` with one
  method, a fake that returns a fixed proposal for a fixed input, and a real adapter behind
  configuration.
  - Acceptance: nothing outside the adapter module names a vendor; the pipeline runs end to end
    against the fake with no network; a provider failure or timeout surfaces as a failed job, never
    as a half-written draft.
  - Verify: pipeline tests against the fake, and a provider that throws, times out and returns
    malformed output.

- [ ] **P1-T4 Run the pipeline and produce a draft.** Screenshots in, proposal out, sanitised,
  built, validated, stored as an `ImportedDraft` against the job.
  - Acceptance: the stored draft's section parses through `builderSectionSchema`; a proposal that
    fails validation fails the job with a reason and writes no draft; the temporary screenshots are
    deleted once the draft exists.
  - Verify: integration tests for the happy path, for a proposal that fails validation, and for the
    deletion of inputs.

- [ ] **P1-T5 Preview and insert in the editor.** A dialog that shows the draft at desktop, tablet
  and mobile, lists its warnings, and inserts it before, after, or at the end of the current page in
  one undoable step through the store's `update()`.
  - Acceptance: nothing is written to the document until confirmation; the inserted section is
    editable, movable and deletable like any other; one undo removes the whole insertion; a save that
    conflicts is reported as a conflict and the draft is not lost; a discarded draft deletes its job
    and inputs.
  - Verify: component tests for preview, insert positions, undo and conflict; a store test asserting
    a single history entry.

**Checkpoint 1:** a person uploads screenshots of a section, watches the job, previews the result at
three widths, and inserts it — with no URL fetching anywhere in the product.

### Phase 2 — URL import, behind a hard security boundary

- [ ] **P2-T1 Implement the URL safety gate as a pure, tested resolver.** Before any request:
  scheme allowlist (`https` only, `http` refused), hostname resolution with every resolved address
  checked against private, loopback, link-local, multicast, unique-local and cloud-metadata ranges,
  in both IPv4 and IPv6.
  - Acceptance: a URL whose DNS answer includes a forbidden address is refused whatever else it
    resolves to; each redirect hop is re-resolved and re-checked, so a public host that redirects
    inward is refused; the address that passed the check is the address that is connected to, so a
    second lookup cannot return a different one; a refusal answers `UNKNOWN_HOST` and never reveals
    what was resolved.
  - Verify: unit tests over an injected resolver covering each forbidden range, IPv4 and IPv6, a
    redirect chain ending inward, and a resolver that answers differently on a second call.

- [ ] **P2-T2 Capture in an isolated browser.** A separate process with no application credentials
  and no database access, which loads the URL with JavaScript enabled but cookies, storage and
  authentication headers empty, under a total time limit and a total download limit, and returns
  screenshots plus a measured box tree.
  - Acceptance: the capture carries none of the caller's headers, cookies or session; exceeding the
    time or download limit fails the job rather than returning a partial page; no script from the
    page reaches the API process or the editor; the process cannot reach the database or the internal
    network.
  - Verify: integration tests over a local fixture site for limits and for header and cookie
    absence; a test asserting the capture contract carries no executable content.

- [ ] **P2-T3 Select a section visually.** The captured page is shown as an image with a crop
  interface: hover highlights the measured boxes, a click selects one, and the selection can be
  adjusted by hand.
  - Acceptance: the selection is expressed as a rectangle in the captured image's coordinates; only
    the selected region reaches the model; the interface is operable with the keyboard alone and
    announces the selected region.
  - Verify: component tests for pointer and keyboard selection, and a test asserting the crop reaches
    the request.

- [ ] **P2-T4 Feed measured geometry to the model.** The box tree from P2-T2 is passed with the
  screenshots, and the model is asked to classify and group boxes rather than to invent geometry.
  - Acceptance: every node in the proposal refers to a measured box or is refused; the produced
    section's rectangles are within a stated tolerance of the measurements; a proposal that invents a
    box fails validation.
  - Verify: pipeline tests over a fixture capture, asserting tolerance and the refusal of invented
    nodes.

**Checkpoint 2:** a person pastes a URL, picks a section on the captured page, and gets the same
draft and preview as the screenshot path — with the safety gate proven by tests rather than by
inspection.

### Phase 3 — Fidelity, responsiveness and typography

- [ ] **P3-T1 Implement the two fidelity options.** "Structure only" produces theme-default
  appearance; "structure and style" carries background, colour, border, radius and shadow.
  - Acceptance: the same reference produces two visibly different sections; structure-only output
    contains no colour taken from the reference; both parse and render identically to a hand-built
    section.
  - Verify: unit tests comparing the two outputs for the same proposal.

- [ ] **P3-T2 Carry responsive behaviour where there is evidence for it.** Where more than one
  viewport was supplied or captured, per-breakpoint overrides are written only for the widths that
  were actually observed.
  - Acceptance: a single-viewport import writes no override for widths nobody saw; a three-viewport
    import writes overrides only where the arrangement genuinely differs; the result passes the
    responsive diagnostics the editor already runs.
  - Verify: unit tests for one and three viewports, and a diagnostics test asserting no new finding.

- [ ] **P3-T3 Map typography to permitted families.** Approximate size, weight and line height from
  the reference onto the site's scale, substituting any family that is not permitted.
  - Acceptance: no font file is fetched from the reference; a substitution produces a warning naming
    both families; sizes land on the document's own scale rather than arbitrary pixel values.
  - Verify: unit tests for substitution and for scale snapping.

**Checkpoint 3:** the section import is complete for its two options, honest about responsiveness,
and never carries a font or a colour it was not asked to.

### Phase 4 — Page and full site

- [ ] **P4-T1 Import a whole page as several sections.** The same pipeline segments a capture into
  sections and produces a `BuilderPage`.
  - Acceptance: the page parses through the page schema; sections keep their order and their roles;
    a page that exceeds the section limit fails with a reason rather than truncating silently.
  - Verify: integration tests over a multi-section fixture, including the limit.

- [ ] **P4-T2 Import a site as a new project.** Several pages, their slugs derived from structure
  rather than from the reference's own words, into a new `BuilderProject`.
  - Acceptance: the project parses and opens in the builder; no slug, page name or SEO field carries
    text from the reference; nothing is published; an existing project is never modified.
  - Verify: integration tests asserting the created project's shape and that no reference string
    appears anywhere in it.

- [ ] **P4-T3 Hold site-scale imports inside their limits.** Per-job page and section caps, a cost
  ceiling per workspace, and retries with a bound.
  - Acceptance: exceeding a cap fails the job with the cap named; a retried job never doubles a
    charge; a job cancelled mid-site leaves no partial project.
  - Verify: tests for each cap, for retry accounting, and for cancellation.

**Checkpoint 4:** page and site import run on the same engine as the section, under limits that are
enforced rather than documented.

### Phase 5 — Proof, rollout and handoff

- [ ] **P5-T1 Add the journeys.** Integration and browser journeys for: screenshots to inserted
  section; URL to inserted section; a refused URL; a cancelled job; a conflicting save; expiry
  deleting temporary data; and cross-tenant refusal on every endpoint.
  - Acceptance: each journey asserts stored data and rendered output, not button presence; each fails
    when its production boundary is broken.
  - Verify: focused suites, then `npm test` and `npm run test:e2e` with recorded counts.

- [ ] **P5-T2 Ship behind the flag, document, and hand off.** Rollout notes, the operator document,
  the privacy statement about what is and is not retained, and the final gates.
  - Acceptance: no known regression is hidden by a weakened assertion; the Progress Log records exact
    commands and counts; every task is `[x]` except genuinely blocked ones marked `[!]`.
  - Verify: `npm run check:plan-skill`, `npm run check:runbook`, `npm run typecheck`, `npm test`,
    `npm run build`, `npm run test:e2e`, and `git diff --check`.

**Checkpoint 5:** the feature is complete behind a switch that is off, with its journeys green and
its operational behaviour written down.

---

## 6. Accessibility and responsiveness

- Every control the feature adds has an accessible name, is reachable by keyboard alone, and
  announces state changes through a live region — job progress included.
- The section selector is operable without a pointer: boxes are focusable in document order, and the
  selected region is announced.
- The preview shows the draft at desktop, tablet and mobile at their real widths, the way the
  existing preview does, rather than a scaled approximation.
- The dialog traps focus, closes on Escape, and returns focus to the control that opened it.
- Generated sections are checked by the accessibility audit the editor already runs, and a generated
  heading order that would fail it is corrected before the draft is offered.

---

## 7. Rollout

Two switches, both of which must be open, following the analytics precedent:
`AI_IMPORT_ENABLED` in the environment, and a per-workspace entitlement. With either closed the
routes answer `404` and the editor shows no entry point — not a disabled one.

Order: screenshots first, to a small number of workspaces; URL capture only once D-4's isolated
process exists in the target deployment. If it never does, the screenshot path is the whole feature
and the plan is complete without Phase 2.

---

## 8. Risks, limits and what is out of scope

**Risks.** A model that returns confident nonsense is the normal case, not the exception — which is
why nothing it says reaches a document unvalidated, and why the person confirms. Capture is the
largest attack surface this product has ever had; it is isolated, credential-free and limited, and it
ships last. Cost is unbounded by nature and is bounded here by per-workspace caps.

**Limits, stated plainly.** The result approximates a layout; it does not reproduce one. Animation,
scroll-driven behaviour, video, embeds and anything interactive beyond the registry are not imported.
A reference that is mostly an image will import as mostly empty boxes, which is the honest outcome.

**Out of scope.** Importing content of any kind. Importing to match a reference pixel for pixel.
Cloning a site for someone who does not own it — the interface says what is taken and what is not,
and nothing in the pipeline can be configured to take more.

---

## 9. Progress Log

Append-only. One row per completed task: date, task, outcome, commands and counts, commit.

```text
YYYY-MM-DD HH:MM | TASK | done|blocked | tests/commands and counts | commit
```

## 10. Decision Log

Append-only, and only for material departures from this plan.

```text
YYYY-MM-DD | decision | alternatives | reason | compatibility/rollback impact
```
