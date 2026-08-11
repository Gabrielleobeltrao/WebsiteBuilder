# WebsiteBuilder — Builder UX and True Responsive Rendering Plan

Plan version: 1.0.0  
Repository: `https://github.com/Gabrielleobeltrao/WebsiteBuilder.git`  
Audited baseline: `development@2afd9559761c48564965c8d54cbfbbc370d8efc1` (same commit as `main` at audit time)  
Primary working branch: `development`  
Created: 2026-08-11

## 1. Mission

Rebuild the builder interaction model, responsive authoring, clean preview, and published renderer so that:

- creating a page is visually clear and fast;
- elements can be clicked or dragged from the right-side library into an explicit destination;
- selecting an element immediately opens its contextual settings in the same right sidebar;
- desktop, tablet, and mobile are the only device modes exposed in the builder and preview;
- a layout authored on desktop receives safe tablet/mobile behavior and can be refined per device;
- preview and published output use the same responsive rendering contract;
- no builder-generated element can silently leave the visible page on narrow screens;
- the clean preview contains only Back, the three device buttons, and the rendered site;
- mobile access remains preview-only; page editing remains desktop-only;
- existing sites keep their desktop appearance while receiving a deterministic responsive migration.

This plan is a focused builder/renderer refactor. Do not add A/B testing, AI generation, third-party integrations, new analytics work, new domains, or new Coolify services.

## 2. Execution rules

1. Respond to the user in Brazilian Portuguese.
2. Keep source code, identifiers, comments, tests, documentation, commits, and UI translation keys in English.
3. Preserve both `pt-BR` and `en-US` UI parity.
4. Work on `development`. Do not commit directly to `main`.
5. Fetch before starting and confirm that the local branch contains the remote audited baseline or a newer commit.
6. Never reset, overwrite, or discard unrelated user changes.
7. Inspect the current implementation before each task because this repository is actively changing.
8. Reuse the existing React, Zustand, shared package, renderer, Express, MongoDB, Vitest, and Playwright architecture.
9. A new dependency is allowed only when it removes substantial custom interaction code. Prefer `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities` for accessible drag/drop and sorting.
10. Do not use `overflow-x: hidden` as a responsive fix. It only hides broken content.
11. Do not use a client-side resize script to repair the published layout after paint. Responsive behavior must be present in the initial HTML/CSS.
12. Keep published versions immutable. A responsive migration updates the editable draft, never an already published snapshot.
13. Keep the current Coolify topology. This work adds no container, domain, public hostname, or environment variable unless a genuinely necessary existing-service variable is documented and justified.
14. After every completed task, update the task checkbox, Progress Log, Decision Log, and verification evidence.
15. Mark `[!]` only for a genuine user-only decision, credentials, permission, or production operation. A difficult engineering task is not blocked.

## 3. Current-state audit

The following findings were verified at the audited commit and are the reasons for this plan.

### 3.1 Responsive data exists but is not connected end to end

- `packages/shared/src/responsive.ts` defines desktop/tablet/mobile breakpoints, constraints, geometry overrides, and `resolveLayoutAt`.
- `EditableCanvas.tsx` resolves responsive geometry for its visual wrapper.
- `ElementRenderer.tsx` still positions published free-layout elements with `freeGeometryStyle(element.geometry)`, using only base geometry.
- `ProjectPageRenderer.tsx` passes a width to section layout but not to element layout.
- `backend/src/renderer/html.ts` renders `ProjectPageRenderer` without a viewport-specific or responsive element compilation path.
- Therefore editor, preview, and published output are not actually equivalent for free-positioned elements.

### 3.2 The mobile escape is expected from the current implementation

- New elements default to `horizontalConstraint: "left"` and desktop pixel geometry.
- A desktop element at a large `x` coordinate keeps that coordinate on mobile unless an override exists.
- `applyConstraints` intentionally leaves `left` geometry unchanged.
- The preview renderer does not apply `applyConstraints` or breakpoint geometry to published-style element wrappers.
- Diagnostics can report overflow, but reporting does not repair or prevent the broken output.

### 3.3 Responsive editing controls do not edit responsive values consistently

- `WidthControl.tsx` exposes desktop/tablet/mobile presets plus a continuous slider, numeric width input, and breakpoint label.
- `ElementInspector.tsx` edits base geometry through `moveElement`, regardless of the active device.
- `EditableCanvas.tsx` also commits drag/resize through `moveElement`, even while a narrow width is selected.
- `SectionInspector.tsx` hardcodes `const BREAKPOINT = "desktop"`.
- The store supports `setBreakpointOverride`, but the visible inspector and Moveable interaction do not use it as their main editing path.

### 3.4 Preview is not the requested clean preview

- `PreviewRoute.tsx` exposes only desktop/mobile at the first level, then adds a separate multi-preset width toolbar, range slider, numeric pixel input, and diagnostics.
- Desktop width can be wider than the host screen without a complete scale-to-fit device-frame model.
- The result mixes preview, diagnostics, and testing tools in one surface.

### 3.5 Builder navigation is crowded and mode-driven

- The right sidebar has five peer tabs: Pages, Elements, Layers, Page settings, and SEO.
- Selecting an element replaces the panel, but returning depends on the previous panel mode.
- The top bar contains a back link, title, three width presets, slider, numeric width, breakpoint label, save state, undo, redo, two preview links, and Save.
- The information hierarchy is unclear even though the individual features exist.

### 3.6 Core creation actions are incomplete in the UI

- `ElementsPanel.tsx` adds by click only and always targets the first section.
- There is no actual library-to-canvas drag/drop destination flow.
- The store has `addSection` and `reorderSections`, but the main builder UI does not expose a complete add/reorder section workflow.
- Layers can select hidden/locked elements, but cannot reorder the complete tree through drag/drop.
- Canvas elements can be dragged/resized after insertion, and eight resize handles already exist.

## 4. Product decisions

### 4.1 Builder frame

Desktop authoring uses three stable regions:

1. **Compact top bar** — navigation and document-level actions.
2. **Centered canvas** — the page being authored.
3. **Fixed right sidebar** — library, pages, structure, settings, and contextual inspector.

There is no builder-specific left sidebar. The user's previously chosen right-side control model remains authoritative.

### 4.2 Compact top bar

The builder top bar contains only:

- Back to site/dashboard;
- site name and current page selector;
- Undo and Redo;
- save-state indicator;
- Desktop, Tablet, and Mobile device buttons;
- Preview;
- Publish or a link to the existing publish flow.

Manual Save may remain only if autosave failure/retry semantics require it. Do not show a second preview button per device. Do not show a width range slider, pixel field, current-width text, or diagnostics in the top bar.

### 4.3 Right sidebar information architecture

Use a narrow vertical icon rail on the far right and one content panel beside it. The rail contains:

- Add elements;
- Pages;
- Structure;
- Page settings;
- Site settings.

Rules:

- labels appear as accessible tooltips and in the content heading;
- only one rail destination is active;
- no row of five compressed text tabs;
- the panel width stays stable so the canvas does not jump;
- Page SEO belongs inside Page settings, not as another top-level builder mode;
- optional feature settings appear only when the feature is used, preserving the existing feature-lifecycle rule.

### 4.4 Contextual element inspector

Selecting an element or section automatically replaces the sidebar content with its inspector.

The inspector contains three tabs:

- Content;
- Style;
- Advanced.

Layout controls live in the appropriate tab instead of being a fourth global navigation mode. The active device button controls which responsive values are being viewed and edited. Each responsive field shows one of:

- inherited from Desktop;
- inherited from Tablet;
- overridden on this device.

An overridden field has a Reset control that removes only that device override. The inspector header shows the element name/type, breadcrumb, and Back. Changing selection updates the inspector without requiring the user to choose another sidebar tab.

### 4.5 Device modes

Expose exactly three modes:

| Device | Authoring reference width | Breakpoint behavior |
| --- | ---: | --- |
| Desktop | 1440 px | base values |
| Tablet | 768 px | inherits Desktop, then Tablet overrides |
| Mobile | 390 px | inherits Desktop, Tablet, then Mobile overrides |

The implementation may continue testing additional widths internally. Internal diagnostics are not an excuse to expose a continuous-width toolbar in the primary UX.

### 4.6 Responsive inheritance

Responsive editing is top-down:

- Desktop base values apply everywhere unless overridden.
- Tablet overrides apply to Tablet and Mobile unless Mobile overrides them.
- Mobile overrides apply only to Mobile.
- Editing Desktop must not erase narrower overrides.
- Editing Tablet must not mutate Desktop.
- Editing Mobile must not mutate Desktop or Tablet.

### 4.7 Free versus structured layout

Both remain supported:

- **Free section** — elements can be placed and resized visually.
- **Grid/Flex section** — elements participate in normal document flow and reflow automatically.

Structured sections are the recommended default for ordinary responsive site sections. Free sections remain available for hero artboards and intentionally layered designs.

Free layout must still be safe:

- new elements receive deterministic Tablet and Mobile geometry where necessary;
- device-specific drag/resize writes that device's geometry override;
- constraints are compiled into responsive CSS rather than ignored;
- a severe unresolved overflow blocks publishing and links directly to the affected device/element;
- an explicit **Auto-fix this device** action can create safe overrides, but the system must never silently move existing authored content on every render.

### 4.8 Clean preview

The preview route contains only:

- Back;
- Desktop, Tablet, and Mobile buttons;
- the site preview.

It contains no diagnostics panel, width presets beyond the three devices, range slider, numeric width, save controls, editor sidebar, selection outlines, or explanatory cards.

The preview uses an isolated same-origin iframe/device viewport:

- the iframe's internal layout viewport is exactly 1440, 768, or 390 pixels;
- when the host screen is narrower than the selected device, the frame scales down visually to fit while retaining its internal width;
- switching devices changes the iframe viewport, not the page's stored data;
- the toolbar remains outside the rendered site;
- internal site links navigate inside the preview;
- preview uses the latest saved draft revision;
- narrow/mobile access defaults to Mobile preview and remains preview-only.

### 4.9 Published responsive output

The published site must not depend on the builder application to calculate layout.

Create one shared, pure responsive compilation layer that produces validated markup attributes and CSS from the builder document. It is used by:

- the editable canvas presentation;
- the authenticated draft preview document;
- the immutable published renderer.

Required output characteristics:

- semantic SSR content remains present before JavaScript;
- element wrappers have stable scoped layout selectors such as `data-wb-layout-id`;
- Desktop base rules and Tablet/Mobile media rules are emitted from typed document values;
- Grid/Flex rules use natural reflow and `min-width: 0` protections;
- free-layout constraints are expressed relative to the correct device reference width;
- responsive visibility and responsive style values are reflected in CSS;
- no arbitrary CSS string from a stored document is accepted;
- no layout flash or after-paint repositioning script is introduced;
- tracker failure cannot affect layout;
- preview and published renderers consume the same compiler.

### 4.10 Existing projects

Create a schema migration for existing editable drafts:

- preserve Desktop geometry exactly;
- generate Tablet/Mobile overrides only where the inherited result would overflow or become unreachable;
- use deterministic safe padding and ordering rules;
- do not mutate immutable publication snapshots;
- migration is idempotent;
- save the upgraded schema only through the existing revision-safe persistence path;
- provide tests using documents created before this plan.

## 5. Responsive model requirements

### 5.1 Shared device constants

Define one exported device configuration used everywhere:

```ts
type DeviceMode = "desktop" | "tablet" | "mobile";

const DEVICE_MODES = {
  desktop: { referenceWidth: 1440 },
  tablet: { referenceWidth: 768 },
  mobile: { referenceWidth: 390 },
} as const;
```

Do not duplicate these widths in builder, preview, renderer, diagnostics, or tests.

### 5.2 Element overrides

Extend the typed responsive model so an override can safely represent:

- geometry;
- responsive width/height/min/max/aspect ratio/visibility;
- the supported responsive subset of element style;
- the reference width against which free geometry was authored when necessary.

Style override types must remain discriminated by element type. Do not create a generic `Record<string, any>` style bag.

Minimum responsive style subset:

- Text: font size, line height, alignment;
- Button: font size, alignment, width behavior;
- Image: object fit and focal/art-direction selection where already supported;
- Container: direction, wrap, gap, padding, alignment;
- Section: height, grid/flex columns/direction/gap/padding/alignment.

### 5.3 Geometry rules

For free elements, implement and test these behaviors:

- Left: preserves the authored left gap when it fits; an explicit safe override is required when it cannot fit.
- Right: preserves the authored right gap.
- Center: remains centered.
- Stretch: preserves left and right gaps and never resolves below minimum width.
- Scale: scales `x` and width from the device reference width.
- Width never becomes negative or zero.
- A selected element always retains a reachable portion during authoring.
- Final output never relies on clipping to claim success.

### 5.4 Automatic safe initial behavior

When an element is inserted into a Free section:

- Desktop geometry is based on the actual drop point.
- Tablet and Mobile geometry is derived immediately if Desktop inheritance would overflow.
- use 16 px minimum safe side padding on Mobile and 24 px on Tablet unless the user explicitly overrides it;
- buttons and images may shrink to the available width but must retain usable height/aspect ratio;
- text boxes may widen to the available content width and preserve readable typography;
- insertion must not place a new element on top of an existing element unless the drop target explicitly indicates layering.

When an element is inserted into Grid/Flex:

- it joins normal flow at the indicated insertion marker;
- click insertion targets the selected container/section;
- if nothing is selected, click insertion creates a new structured section at the bottom and inserts there.

## 6. Interaction requirements

### 6.1 Element library

- Keep Text, Image, Button, and Container as the primary visible block set for this phase.
- Preserve search/category extension points without adding fake categories.
- Every library item supports click and drag.
- Dragging shows valid drop targets only.
- Free sections show a coordinate drop target.
- Grid/Flex sections and containers show before/after insertion markers.
- Invalid nested-container depth is visibly rejected.
- Dropping creates one undoable transaction and selects the new element.
- Pressing Escape cancels drag without modifying the document.
- Click insertion has an accessible, deterministic destination.

### 6.2 Canvas selection and manipulation

- Selected element has a clear outline and name label.
- Hover outline is lower emphasis than selection.
- Exactly eight resize handles remain: four corners and four sides.
- Drag and resize commit once per gesture to history.
- Desktop gestures write base geometry.
- Tablet/Mobile gestures write the active breakpoint override.
- Section selection is possible without fighting child selection.
- Clicking empty canvas clears selection and returns to the previously chosen sidebar destination.
- Add a compact selected-element toolbar for Duplicate and Delete; do not duplicate the entire inspector.
- Locked elements remain selectable through Structure.

### 6.3 Sections and structure

- Add section is visible from the canvas between sections and at the page bottom.
- The user can choose Free, Flex, or Grid when adding a section.
- Sections can be reordered by drag/drop on canvas and in Structure.
- Structure displays Page → Sections → Containers → Elements.
- Structure supports select, rename, collapse/expand, show/hide, lock status, and drag reorder.
- Reordering is keyboard-accessible and produces one history entry.
- Hidden or layered elements remain recoverable through Structure.

### 6.4 Inspector behavior

- Content, Style, and Advanced tabs are stable for all element types.
- Show only controls that affect the selected type.
- The current device context is visible in responsive fields.
- Inherited values are readable but do not become overrides until changed.
- Reset removes only the selected device/property override.
- Numeric fields allow temporary empty drafts and commit on blur/Enter.
- Text input remains debounced/transactional and does not create one history entry per key.
- Page settings include name, slug, canvas, and SEO in organized subsections.

## 7. Clean preview implementation contract

Create an authenticated draft-preview HTML endpoint in the existing backend/renderer service, or an equivalent same-origin route that satisfies all conditions below:

- verifies workspace membership and project authorization;
- loads the editable draft, not the published snapshot;
- accepts a page route/slug and revision-safe cache key;
- returns a full HTML document using the exact shared responsive compiler used for publication;
- disables analytics collection in preview;
- keeps preview internal navigation inside preview context;
- cannot mutate project state;
- sends a restrictive CSP compatible with the rendered page;
- does not expose draft preview to unauthenticated visitors.

The React preview shell embeds this document in an iframe and owns only Back/device controls and frame scaling.

Frame scaling formula must be based on available host width and selected reference width:

```ts
scale = Math.min(1, availableWidth / referenceWidth)
```

The iframe retains the unscaled reference width. Its visual wrapper reserves scaled height so surrounding layout does not overlap it. Recalculate on host resize with `ResizeObserver`; do not change the iframe's internal device width.

## 8. Published renderer contract

- `renderRouteHtml` includes one normalized global reset for `box-sizing`, body margin, media max width, and safe word wrapping.
- It emits scoped responsive CSS for sections/elements from the immutable version document.
- The same compiler can render draft and publication inputs.
- Every element type receives responsive layout, not only sections.
- Page background/minimum height does not create horizontal overflow.
- Long words and URLs wrap safely without clipping ordinary content.
- Images remain responsive and retain existing `srcset`, sizes, focal point, and WebP behavior.
- Buttons remain usable and keep minimum touch-target validation.
- Grid/Flex children can shrink below intrinsic content width.
- Free elements honor constraints and device overrides.
- Existing SEO, forms, blog, CMS, analytics, and navigation behavior remains intact.
- Published pages still render meaningful content without JavaScript.

## 9. Publishing readiness

Move detailed responsive diagnostics out of the clean preview and integrate them with existing readiness/publish flow.

Required checks:

- horizontal overflow at 320, 390, 640, 768, 1024, 1280, and 1440;
- completely off-canvas elements;
- same-depth unintended overlaps in Free sections;
- impossible min/max constraints;
- unreadable text minimums;
- undersized interactive targets;
- fixed Grid columns that cannot fit;
- unconfigured element links where applicable.

Errors block publication. Warnings do not. Each finding includes:

- page;
- section;
- element;
- affected device/width range;
- Open in builder action;
- Auto-fix action only when deterministic and reversible.

Opening a finding sets the current page, device, selection, and inspector context.

## 10. Implementation phases and tasks

### Phase 0 — Baseline and protection

- [x] **0.1 Confirm repository and branch state.**
  - Acceptance: `development` is checked out, includes remote `development`, and no unrelated working-tree changes are lost.
  - Verify: record commit and `git status --short` in Progress Log.
  - Done. `development` = `origin/development` = `4bb5148`, one commit ahead of the audited
    baseline `2afd955` (that commit made publishing create the site's public address and moved
    Rename/Delete off the site card). Working tree clean before starting. Verification at that
    commit: 1,609 unit tests and 47 E2E green, typecheck and build clean.

- [x] **0.2 Create focused regression fixtures.**
  - Acceptance: fixtures cover a desktop free element at large `x`, a centered element, a stretched element, a Grid section, a Flex section, and legacy documents without device overrides.
  - Verify: fixtures reproduce the current mobile escape before the fix.
  - `packages/shared/src/responsive-fixtures.ts`, exported through a package subpath rather than
    the index so nothing ships them. Covers a far-right free element at x=1100, a centred one, a
    stretched one, a right-anchored one, a scaled one, a Grid section, a Flex section with an
    unbreakable word, a legacy desktop-only document, and the same document with a mobile
    override. One definition shared by the frontend and backend suites, because the thing being
    proven is that those two agree.

- [x] **0.3 Capture current behavior with failing tests.**
  - Acceptance: tests demonstrate preview/published disagreement and SectionInspector's desktop-only write behavior.
  - Verify: failures are specific and become green only after relevant implementation.
  - 10 failing tests, each naming one defect. `responsive-parity.test.tsx`: the far-right element
    escapes at 320/390/768/1024, the renderer disagrees with `applyConstraints`, a centred element
    is not centred, a stretched one overflows, a right-anchored one loses its gap, and a mobile
    override is ignored entirely. `device-aware-editing.test.tsx`: editing a section while Mobile
    is selected writes the Desktop value. They pass only when Phase 2 and Phase 3.4 land.

### Phase 1 — Responsive domain model and migration

- [ ] **1.1 Centralize the three device modes.**
  - Acceptance: builder, preview, renderer, inspector, and tests import one shared device definition.
  - Verify: repository search finds no duplicate 1440/768/390 device configuration.

- [ ] **1.2 Extend typed breakpoint overrides.**
  - Acceptance: geometry, layout, supported style, visibility, and reference-width metadata are type-safe and schema-validated.
  - Verify: valid/invalid schema tests for every element type.

- [ ] **1.3 Implement pure responsive resolution.**
  - Acceptance: one resolver returns the effective section/element values and value origins for any width.
  - Verify: inheritance tests cover Desktop → Tablet → Mobile and reset behavior.

- [ ] **1.4 Implement schema migration for existing drafts.**
  - Acceptance: desktop is byte-equivalent in rendered geometry; unsafe narrow layouts receive deterministic overrides; migration is idempotent.
  - Verify: migration snapshots and repeated-migration test.

- [ ] **1.5 Preserve immutable published versions.**
  - Acceptance: draft migration cannot rewrite old published snapshots.
  - Verify: publishing repository test compares existing snapshot before/after draft migration.

### Phase 2 — Shared responsive compiler

- [ ] **2.1 Create the pure responsive CSS compiler.**
  - Acceptance: compiler accepts only parsed typed values and emits deterministic scoped CSS for base, Tablet, and Mobile.
  - Verify: unit snapshots, CSS escaping/security tests, and stable output hashing.

- [ ] **2.2 Connect every section and element to compiled layout selectors.**
  - Acceptance: Text, Image, Button, Container, and existing visual elements receive responsive wrappers in all layout modes.
  - Verify: renderer component tests at all three devices.

- [ ] **2.3 Implement free-layout constraints in CSS output.**
  - Acceptance: left/right/center/stretch/scale behavior matches the shared resolver across intermediate widths.
  - Verify: property tests or table-driven tests from 320 through 1920.

- [ ] **2.4 Connect responsive section Grid/Flex rules.**
  - Acceptance: active device layout and child shrink/reflow behavior are applied consistently.
  - Verify: Grid/Flex tests include long content and narrow containers.

- [ ] **2.5 Use the compiler in published SSR.**
  - Acceptance: `renderRouteHtml` includes responsive CSS and no after-paint layout repair.
  - Verify: backend renderer tests inspect CSS and render output at representative widths.

- [ ] **2.6 Add safe global published defaults.**
  - Acceptance: box sizing, body margin, media sizing, and word wrapping are normalized without masking authored overflow.
  - Verify: published Playwright pages have no unexpected body overflow.

### Phase 3 — Device-aware editor state

- [ ] **3.1 Replace continuous WidthControl with DeviceSwitcher.**
  - Acceptance: exactly Desktop, Tablet, and Mobile controls are visible; slider, numeric width, and breakpoint badge are removed.
  - Verify: component tests query exactly three device buttons.

- [ ] **3.2 Make Moveable writes device-aware.**
  - Acceptance: Desktop drag/resize updates base; Tablet/Mobile update only their override.
  - Verify: store and interaction tests prove cross-device isolation.

- [ ] **3.3 Make ElementInspector device-aware.**
  - Acceptance: geometry and supported style fields display origin and write/reset the correct device value.
  - Verify: inspector tests for inherited, overridden, and reset states.

- [ ] **3.4 Remove SectionInspector's desktop constant.**
  - Acceptance: Grid/Flex/height/padding/gap/direction edits follow the active device.
  - Verify: Tablet and Mobile section edits leave Desktop unchanged.

- [ ] **3.5 Add explicit responsive auto-fix.**
  - Acceptance: auto-fix is user-triggered, undoable, deterministic, and creates only necessary overrides.
  - Verify: overflow fixture is fixed without changing Desktop.

### Phase 4 — Builder shell and right sidebar UX

- [ ] **4.1 Simplify the top bar.**
  - Acceptance: only the actions in Section 4.2 remain; duplicate preview buttons and width tools are gone.
  - Verify: UI test asserts action inventory and keyboard labels.

- [ ] **4.2 Replace peer text tabs with right icon rail plus content panel.**
  - Acceptance: Add, Pages, Structure, Page settings, and Site settings are stable destinations; canvas width does not jump.
  - Verify: component tests switch destinations and measure stable sidebar class/width contract.

- [ ] **4.3 Build the contextual three-tab inspector.**
  - Acceptance: selection opens Content/Style/Advanced automatically; Back returns to last explicit destination.
  - Verify: selection state-machine tests and element-type coverage.

- [ ] **4.4 Consolidate Page settings and SEO.**
  - Acceptance: page identity, slug, canvas, and SEO are organized in one destination without losing existing validation/preview.
  - Verify: existing Page SEO tests remain green and new navigation tests pass.

- [ ] **4.5 Preserve conditional feature navigation.**
  - Acceptance: optional configuration appears only after related content is used.
  - Verify: unused/used feature lifecycle component tests.

### Phase 5 — Real drag/drop authoring

- [ ] **5.1 Implement library-to-canvas drag/drop.**
  - Acceptance: Text, Image, Button, and Container can be dragged to valid destinations with clear markers.
  - Verify: pointer and keyboard drag/drop tests.

- [ ] **5.2 Fix click insertion destination.**
  - Acceptance: selected container/section receives the element; otherwise a new structured section is created at page bottom.
  - Verify: click insertion tests for each destination state.

- [ ] **5.3 Add section creation controls.**
  - Acceptance: between-section and page-bottom add controls let user choose Free/Grid/Flex.
  - Verify: add/undo/redo tests.

- [ ] **5.4 Implement Structure tree reordering.**
  - Acceptance: sections/elements can be reordered, nested where valid, selected, renamed, hidden, and recovered.
  - Verify: depth guard, reorder, hidden, locked, and keyboard tests.

- [ ] **5.5 Add compact canvas actions.**
  - Acceptance: selected element exposes Duplicate/Delete without obscuring resize handles.
  - Verify: canvas action tests and focus order.

### Phase 6 — Clean isolated preview

- [ ] **6.1 Create authorized draft-preview document route.**
  - Acceptance: same responsive compiler, saved draft, no analytics, no mutations, tenant authorization.
  - Verify: API authorization, tenant isolation, CSP, and read-only tests.

- [ ] **6.2 Replace PreviewRoute content with the clean shell.**
  - Acceptance: only Back, Desktop, Tablet, Mobile, and iframe preview are present.
  - Verify: UI test rejects diagnostics, sliders, numeric widths, save, and editor chrome.

- [ ] **6.3 Implement exact iframe viewport and scale-to-fit.**
  - Acceptance: internal width stays 1440/768/390 while visual frame fits host width.
  - Verify: Playwright inspects iframe `innerWidth` and bounding-box scale on desktop and phone hosts.

- [ ] **6.4 Keep preview navigation inside preview.**
  - Acceptance: page links change the iframe route and Back returns to the builder/site dashboard.
  - Verify: multi-page E2E test.

- [ ] **6.5 Keep mobile access preview-only.**
  - Acceptance: narrow devices cannot mount editor mutation paths but can use all three preview modes.
  - Verify: mobile viewport E2E and network assertion for no write request.

### Phase 7 — Readiness and parity

- [ ] **7.1 Move diagnostics to readiness/publish flow.**
  - Acceptance: clean preview has none; publish flow lists actionable findings.
  - Verify: route/component tests.

- [ ] **7.2 Block severe responsive failures.**
  - Acceptance: off-canvas/overflow errors block publish; warnings remain non-blocking.
  - Verify: publishing service tests.

- [ ] **7.3 Implement Open in builder context.**
  - Acceptance: finding opens correct page/device/element/inspector.
  - Verify: end-to-end readiness navigation.

- [ ] **7.4 Prove draft-preview-published parity.**
  - Acceptance: same document produces equivalent scoped responsive rules and visible geometry.
  - Verify: parity snapshots plus browser measurements.

### Phase 8 — Regression, accessibility, and release

- [ ] **8.1 Add viewport matrix E2E coverage.**
  - Acceptance: 320, 390, 768, 1024, and 1440 pages contain no builder-caused horizontal overflow.
  - Verify: Playwright checks `scrollWidth <= clientWidth` and key element bounds.

- [ ] **8.2 Add visual regression screenshots.**
  - Acceptance: builder and clean preview screenshots exist for all three device modes.
  - Verify: screenshots have reviewed stable masks only for timestamps/volatile data.

- [ ] **8.3 Complete accessibility verification.**
  - Acceptance: device buttons, icon rail, inspector tabs, drag/drop fallback, dialogs, and iframe title are keyboard/screen-reader usable.
  - Verify: Testing Library plus manual keyboard checklist recorded in Progress Log.

- [ ] **8.4 Verify bilingual parity.**
  - Acceptance: no hardcoded user-facing copy and `pt-BR`/`en-US` keys match.
  - Verify: existing i18n parity and no-hardcoded-copy tests.

- [ ] **8.5 Run full repository verification.**
  - Acceptance: root typecheck, tests, build, E2E, container smoke, and runbook checks pass.
  - Verify: record exact commands and results.

- [ ] **8.6 Document release and rollback.**
  - Acceptance: migration behavior, release order, rollback limits, and no-new-Coolify-resource statement are documented.
  - Verify: runbook review and clean production container smoke.

## 11. Required test scenarios

At minimum, automate these scenarios:

1. Drop a Button near the right side of Desktop Free layout; switch to Mobile; it remains fully inside the frame.
2. Resize that Button on Mobile; Desktop geometry does not change.
3. Reset the Mobile override; inherited state returns and is labeled.
4. Add Text by click with a selected Grid section; it enters that section.
5. Add Image by click with no selection; a new structured section is created at the page bottom.
6. Drag a Container into another Container until the maximum depth; the invalid next drop is rejected.
7. Reorder sections in Structure; canvas, preview, save/reload, and published order match.
8. A hidden element is recoverable from Structure.
9. Preview Mobile iframe reports 390 px internal width even when opened on a 320 px host and is visually scaled to fit.
10. Preview Desktop iframe reports 1440 px internal width on a phone host and does not redefine the site as mobile.
11. Published renderer responds naturally at 320/390/768/1024/1440 without layout JavaScript.
12. Draft preview and published snapshot render equivalent geometry for the same document/version.
13. A legacy desktop-only document migrates without changing Desktop.
14. Migration twice produces the same document.
15. Severe overflow blocks publish and Open in builder selects the responsible element/device.
16. Existing blog, form, CMS, navigation, SEO, media, analytics tracker, and domain tests remain green.

## 12. Non-goals

Do not add in this plan:

- AI site generation;
- A/B tests;
- session replay;
- Google Calendar or other third-party integrations;
- new widget families beyond exposing the four core creation blocks cleanly;
- arbitrary custom CSS input;
- mobile authoring;
- custom user-created breakpoint UI;
- continuous-width slider in builder or clean preview;
- a new deploy service, renderer service, domain, or Coolify application.

## 13. Definition of done

This plan is complete only when all statements are true:

- A user can create sections and add core elements by click or drag.
- The right sidebar is clear, stable, and contextual.
- Selecting an element immediately exposes Content/Style/Advanced settings.
- Desktop/Tablet/Mobile edits are isolated and inherited correctly.
- Mobile layouts do not send elements outside the visible page.
- Preview contains only Back, three devices, and the site.
- Preview uses an exact iframe viewport and scale-to-fit shell.
- Preview and published output use the same responsive compilation layer.
- Published SSR is responsive without after-paint layout repair.
- Existing desktop designs are preserved through migration.
- Publishing blocks genuine responsive errors.
- Editing remains desktop-only and preview works on mobile.
- No new Coolify resource or domain is required.
- All required automated and manual verification passes.

## 14. Final verification commands

Run from repository root and record results:

```bash
npm ci
npm run check:plan-skill
npm run check:runbook
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run smoke:containers
```

Also run the focused builder/responsive suites during development instead of waiting for the final pass.

## 15. `/goal` command

```text
/goal Every task in BUILDER_UX_RESPONSIVE_PLAN.md is [x] with its acceptance criteria and verification completed, or [!] only when it genuinely requires user-only credentials, permissions, an irreversible product decision, or a production operation. Complete every remaining unblocked task, keep the Progress Log and Decision Log accurate, and finish with passing root plan-skill and runbook checks, typecheck, tests, build, E2E, container smoke tests, responsive viewport matrix, renderer parity tests, migration tests, tenant-isolation tests, and accessibility checks. Completing only one task or phase does not satisfy this goal. Respond to the user in Brazilian Portuguese; keep all project artifacts in English.
```

## 16. Progress Log

Add entries in chronological order. Do not replace previous entries.

| Date | Task | Commit | Verification | Result |
| --- | --- | --- | --- | --- |
| 2026-08-11 | 0.1 baseline | n/a | `git status --short` empty; `development`/`origin/development`/`origin/main` all at `4bb5148` | Audited baseline `2afd955` is an ancestor. Suite green at the starting commit: 1,609 unit, 47 E2E |
| 2026-08-11 | 0.2 fixtures | n/a | `npm run typecheck` | Shared fixtures compile and are reachable from both workspaces through `@websitebuilder/shared/responsive-fixtures` |
| 2026-08-11 | 0.3 failing capture | n/a | `npx vitest run src/components/renderer/responsive-parity.test.tsx src/features/editor/inspector/device-aware-editing.test.tsx` | 10 failures, all specific: 9 renderer/parity, 1 device-aware write. The unit suite is deliberately red until Phase 2 and Phase 3.4 |

| Date/time | Task | Result | Verification | Commit |
| --- | --- | --- | --- | --- |
| 2026-08-11 | Plan created | Pending execution | Audited `development@2afd955` | — |

## 17. Decision Log

Add material implementation decisions here before or while making them.

| ID | Decision | Reason | Consequences |
| --- | --- | --- | --- |
| D-001 | Keep builder controls on the right | Explicit product requirement | Elementor interaction logic is adapted, not copied spatially |
| D-002 | Expose exactly three device modes | Clearer UX requested | Internal tests may still sweep intermediate widths |
| D-003 | Use isolated iframe preview | Accurate internal viewport and CSS media behavior | Requires authorized draft-preview HTML route |
| D-004 | Compile responsive CSS server-side/shared | Preview/published parity and no layout flash | Renderer refactor is required |
| D-005 | Preserve Desktop and migrate only unsafe narrow states | Protect existing work | Narrow layouts may receive explicit deterministic overrides |
| D-006 | Keep mobile preview-only | Editing space is insufficient on phones | Mobile route must never mount mutation paths |
| D-007 | No new deployment resource | Existing frontend/backend/renderer topology is sufficient | Coolify domains and services remain unchanged |

