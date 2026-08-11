import { describe, expect, it } from "vitest";

import { DEVICE_SAFE_PADDING, deviceReferenceWidth } from "./devices";
import { legacyDesktopOnlyProject, overriddenProject } from "./responsive-fixtures";
import { migrateDocumentResponsive } from "./responsive-migration";
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
