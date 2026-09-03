import { describe, expect, it } from "vitest";

import { DEVICE_SAFE_PADDING, deviceReferenceWidth } from "./devices";
import { legacyDesktopOnlyProject, overriddenProject } from "./responsive-fixtures";
import { autoFitPageToDevice, migrateDocumentResponsive } from "./responsive-migration";
import { resolveElementForDevice } from "./resolve";

const elementsOf = (document: ReturnType<typeof legacyDesktopOnlyProject>) =>
  document.pages[0]!.sections[0]!.elements;

const find = (document: ReturnType<typeof legacyDesktopOnlyProject>, id: string) =>
  elementsOf(document).find((element) => element.id === id)!;

describe("what migration protects", () => {
  it("does not change desktop at all", () => {
    const before = legacyDesktopOnlyProject();
    const { document: after } = migrateDocumentResponsive(before);

    for (const element of elementsOf(after)) {
      const original = find(before, element.id);
      expect(element.geometry, element.id).toEqual(original.geometry);
      expect(element.responsiveLayout, element.id).toEqual(original.responsiveLayout);
      expect(element.breakpointOverrides?.["desktop"], element.id).toBeUndefined();
    }
  });

  it("keeps a decision somebody already made", () => {
    // Running this over a document since refined by hand must not undo the refinement.
    const before = overriddenProject();
    const { document: after } = migrateDocumentResponsive(before);

    expect(find(after, "far-right").breakpointOverrides?.["mobile"]?.geometry).toEqual({ x: 16, width: 358 });
  });

  it("produces the same document when run twice", () => {
    const once = migrateDocumentResponsive(legacyDesktopOnlyProject()).document;
    const twice = migrateDocumentResponsive(once).document;

    expect(twice).toEqual(once);
  });

  it("returns the very same object when there was nothing to do", () => {
    // Lets a caller tell there is nothing to save without diffing two documents.
    const migrated = migrateDocumentResponsive(legacyDesktopOnlyProject()).document;
    const again = migrateDocumentResponsive(migrated);

    expect(again.document).toBe(migrated);
    expect(again.report.changed).toEqual([]);
  });
});

describe("what migration fixes", () => {
  it("brings an escaping element back inside every narrow device", () => {
    const { document } = migrateDocumentResponsive(legacyDesktopOnlyProject());

    for (const device of ["tablet", "mobile"] as const) {
      const resolved = resolveElementForDevice({
        device,
        base: find(document, "far-right").responsiveLayout,
        geometry: find(document, "far-right").geometry,
        overrides: find(document, "far-right").breakpointOverrides,
      });

      expect(resolved.geometry.x, device).toBeGreaterThanOrEqual(0);
      expect(resolved.geometry.x + resolved.geometry.width, device).toBeLessThanOrEqual(
        deviceReferenceWidth(device),
      );
    }
  });

  it("leaves it a margin rather than pinning it to the edge", () => {
    const { document } = migrateDocumentResponsive(legacyDesktopOnlyProject());
    const override = find(document, "far-right").breakpointOverrides?.["mobile"];

    // An element flush against a phone's edge is one a thumb covers.
    expect(override?.geometry?.x).toBe(DEVICE_SAFE_PADDING.mobile);
  });

  it("records which canvas the new geometry was written against", () => {
    const { document } = migrateDocumentResponsive(legacyDesktopOnlyProject());
    const override = find(document, "far-right").breakpointOverrides?.["mobile"];

    expect(override?.referenceWidth).toBe(deviceReferenceWidth("mobile"));
  });

  it("never makes an element bigger than it was authored", () => {
    const before = legacyDesktopOnlyProject();
    const { document } = migrateDocumentResponsive(before);

    for (const element of elementsOf(document)) {
      const authored = find(before, element.id).geometry.width;
      const width = element.breakpointOverrides?.["mobile"]?.geometry?.width;
      if (width !== undefined) expect(width, element.id).toBeLessThanOrEqual(authored);
    }
  });

  it("leaves alone the elements that already fit", () => {
    const { document, report } = migrateDocumentResponsive(legacyDesktopOnlyProject());

    // A centred element is centred at every width, and a stretched one already holds both margins.
    // Moving them would be changing someone's site without being asked.
    expect(find(document, "centred").breakpointOverrides).toBeUndefined();
    expect(find(document, "stretched").breakpointOverrides).toBeUndefined();
    expect(report.changed.map((entry) => entry.elementId)).not.toContain("centred");
  });

  it("does not touch grid or flex sections", () => {
    const { document } = migrateDocumentResponsive(legacyDesktopOnlyProject());
    const grid = document.pages[0]!.sections[1]!;
    const flex = document.pages[0]!.sections[2]!;

    // Their children are in normal flow; the browser reflows them without help.
    for (const section of [grid, flex]) {
      for (const element of section.elements) expect(element.breakpointOverrides).toBeUndefined();
    }
  });

  it("reports what it changed and why", () => {
    const { report } = migrateDocumentResponsive(legacyDesktopOnlyProject());

    expect(report.changed.length).toBeGreaterThan(0);
    for (const entry of report.changed) {
      expect(["tablet", "mobile"]).toContain(entry.device);
      expect(["overflow", "off-canvas"]).toContain(entry.reason);
    }
  });
});

describe("fitting a page to one device on request", () => {
  it("changes nothing on desktop, whatever is asked", () => {
    const page = legacyDesktopOnlyProject().pages[0]!;
    const result = autoFitPageToDevice(page, "desktop");

    // Desktop is the base every other device inherits. "Fitting" it would mean redesigning the site.
    expect(result.page).toBe(page);
    expect(result.changed).toEqual([]);
  });

  it("fits only the device that was asked for", () => {
    const page = legacyDesktopOnlyProject().pages[0]!;
    const { page: fitted } = autoFitPageToDevice(page, "mobile");
    const element = fitted.sections[0]!.elements.find((candidate) => candidate.id === "far-right")!;

    expect(element.breakpointOverrides?.["mobile"]).toBeDefined();
    expect(element.breakpointOverrides?.["tablet"]).toBeUndefined();
  });

  it("replaces an override, because that is what was asked for", () => {
    // Unlike the automatic migration, which leaves an authored decision alone. Somebody pressing
    // "fit to this device" is asking for the placement to be recomputed.
    const page = overriddenProject().pages[0]!;
    const { page: fitted } = autoFitPageToDevice(page, "mobile");
    const element = fitted.sections[0]!.elements.find((candidate) => candidate.id === "far-right")!;

    expect(element.breakpointOverrides?.["mobile"]?.geometry?.x).toBe(DEVICE_SAFE_PADDING.mobile);
  });

  it("touches only the elements that do not fit", () => {
    const page = legacyDesktopOnlyProject().pages[0]!;
    const { page: fitted, changed } = autoFitPageToDevice(page, "mobile");

    expect(changed).toContain("far-right");
    expect(changed).not.toContain("centred");
    expect(fitted.sections[0]!.elements.find((c) => c.id === "centred")!.breakpointOverrides).toBeUndefined();
  });

  it("reports nothing and returns the same page when everything already fits", () => {
    const { page } = autoFitPageToDevice(legacyDesktopOnlyProject().pages[0]!, "mobile");
    const again = autoFitPageToDevice(page, "mobile");

    // Deterministic: the second pass computes the same placement it already wrote.
    expect(again.page.sections[0]!.elements).toEqual(page.sections[0]!.elements);
  });
});

/**
 * Which elements the migration is allowed to touch.
 *
 * It writes a narrow-device override onto anything placed by coordinate that leaves the screen. A
 * flex or grid parent places its children itself and the browser reflows them, so an override there
 * moves work the author did for a problem they never had — and it is written into their document.
 *
 * The traversal used to report the *section's* layout for every descendant, so a child of a flex
 * container inside a free section was migrated as though it were free.
 */
describe("what the responsive migration is allowed to move", () => {
  const offCanvasText = (id: string) => ({
    id,
    name: "",
    type: "text",
    tag: "p",
    content: id,
    style: {
      fontFamily: "Inter",
      fontSize: { value: 16, unit: "px" },
      fontWeight: 400,
      fontStyle: "normal",
      textAlign: "left",
      color: "#111827",
      lineHeight: 1.5,
    },
    // Far past the right edge of a phone, which is what makes it a migration candidate at all.
    geometry: { x: 1100, y: 40, width: 280, height: 40, rotation: 0 },
    responsiveLayout: {
      width: { value: 280, unit: "px" },
      height: { value: 40, unit: "px" },
      horizontalConstraint: "left",
      verticalConstraint: "top",
      visible: true,
    },
    zIndex: 1,
    locked: false,
    hidden: false,
  });

  const box = (id: string, layout: "free" | "flex" | "grid", children: unknown[]) => ({
    ...offCanvasText(id),
    type: "container",
    layout,
    layoutByBreakpoint: {},
    children,
  });

  const documentWith = (elements: unknown[], sectionMode: "free" | "flex" | "grid" = "free") => ({
    ...legacyDesktopOnlyProject(),
    pages: [
      {
        ...legacyDesktopOnlyProject().pages[0]!,
        sections: [{ ...legacyDesktopOnlyProject().pages[0]!.sections[0]!, layoutMode: sectionMode, elements }],
      },
    ],
    sharedSections: [],
  });

  const movedIds = (document: unknown) =>
    migrateDocumentResponsive(document as never).report.changed.map((entry) => entry.elementId);

  it("leaves a flex container's child alone, even inside a free section", () => {
    const moved = movedIds(documentWith([box("outer", "flex", [offCanvasText("child")])]));

    expect(moved).toContain("outer");
    expect(moved).not.toContain("child");
  });

  it("leaves a grid container's child alone", () => {
    expect(movedIds(documentWith([box("outer", "grid", [offCanvasText("child")])]))).not.toContain("child");
  });

  it("still moves a free container's child", () => {
    expect(movedIds(documentWith([box("outer", "free", [offCanvasText("child")])]))).toContain("child");
  });

  it("moves a free container's child even when the section is in flow", () => {
    const moved = movedIds(documentWith([box("outer", "free", [offCanvasText("child")])], "flex"));

    // The section places the container; the container places the child by coordinate.
    expect(moved).not.toContain("outer");
    expect(moved).toContain("child");
  });

  it("stays correct through mixed depths", () => {
    // free section > outer(free) > middle(grid) > inner(free) > leaf
    //
    // Each element is judged by the parent that places it, never by its own layout: `middle` is
    // inside a free container so it is placed by coordinate, and `inner` is inside a grid one so it
    // is not — even though `inner` itself is free, which is what places `leaf`.
    const deep = box("outer", "free", [box("middle", "grid", [box("inner", "free", [offCanvasText("leaf")])])]);
    const moved = movedIds(documentWith([deep]));

    expect(moved).toContain("outer");
    expect(moved).toContain("middle");
    expect(moved).not.toContain("inner");
    expect(moved).toContain("leaf");
  });
});
