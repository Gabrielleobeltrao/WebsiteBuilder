import { builderDocumentInputSchema, createProjectDocument, walkElements } from "@websitebuilder/shared";
import { describe, expect, it } from "vitest";

import { collectIds, copyElement, cutElement, pasteElement } from "./clipboard";
import { addElement, findElement } from "./elements";
import {
  addSection,
  convertSectionLayout,
  deleteSection,
  describeConversion,
  duplicateSection,
  renameSection,
  reorderSections,
  sectionOfElement,
  setSectionBackground,
} from "./sections";

function fixture() {
  const document = createProjectDocument({ name: "Acme", slug: "acme" });
  const page = document.pages[0];
  const section = page?.sections[0];
  if (!page || !section) throw new Error("fixture is missing its page or section");
  return { document, pageId: page.id, sectionId: section.id };
}

function withElements(count: number) {
  const { document, pageId, sectionId } = fixture();
  let current = document;
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const result = addElement(current, { pageId, sectionId }, "text");
    current = result.document;
    if (result.elementId) ids.push(result.elementId);
  }
  return { document: current, ids, pageId, sectionId };
}

describe("section operations", () => {
  it("adds a section with the chosen layout mode", () => {
    const { document, pageId } = fixture();
    const result = addSection(document, pageId, "grid");
    const page = result.document.pages.find((candidate) => candidate.id === pageId);

    expect(page?.sections).toHaveLength(2);
    expect(page?.sections[1]?.layoutMode).toBe("grid");
    expect(builderDocumentInputSchema.safeParse(result.document).success).toBe(true);
  });

  it("keeps layout mode scoped to its own section", () => {
    const { document, pageId, sectionId } = fixture();
    const withGrid = addSection(document, pageId, "grid").document;
    const page = withGrid.pages.find((candidate) => candidate.id === pageId);

    expect(page?.sections.find((section) => section.id === sectionId)?.layoutMode).toBe("free");
    expect(page?.sections[1]?.layoutMode).toBe("grid");
  });

  it("renames and recolours without touching anything else", () => {
    const { document, sectionId } = fixture();
    const renamed = renameSection(document, sectionId, "Hero");
    const recoloured = setSectionBackground(renamed, sectionId, "#101010");

    expect(recoloured.pages[0]?.sections[0]).toMatchObject({ name: "Hero", backgroundColor: "#101010" });
  });

  it("duplicates a section with fresh ids throughout", () => {
    const { document, sectionId } = withElements(2);
    const result = duplicateSection(document, sectionId);
    const sections = result.pages[0]?.sections ?? [];

    expect(sections).toHaveLength(2);
    expect(sections[1]?.id).not.toBe(sections[0]?.id);

    const allIds = sections.flatMap((section) => [...walkElements(section.elements)].map((element) => element.id));
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("refuses to delete the last section, so a page always has somewhere to place an element", () => {
    const { document, sectionId } = fixture();
    expect(deleteSection(document, sectionId)).toEqual(document);
  });

  it("deletes a section when another remains", () => {
    const { document, pageId, sectionId } = fixture();
    const withTwo = addSection(document, pageId, "flex").document;
    const result = deleteSection(withTwo, sectionId);
    expect(result.pages[0]?.sections).toHaveLength(1);
  });

  it("reorders sections", () => {
    const { document, pageId, sectionId } = fixture();
    const withTwo = addSection(document, pageId, "grid").document;
    const reordered = reorderSections(withTwo, pageId, 1, 0);
    expect(reordered.pages[0]?.sections[1]?.id).toBe(sectionId);
  });
});

describe("layout conversion", () => {
  it("describes the impact so the warning can be specific", () => {
    const { document, sectionId } = withElements(3);
    const section = document.pages[0]?.sections.find((candidate) => candidate.id === sectionId);
    if (!section) throw new Error("fixture is missing its section");

    expect(describeConversion(section, "grid")).toEqual({ elementCount: 3, losesFreePositioning: true });
    expect(describeConversion(section, "free")).toEqual({ elementCount: 3, losesFreePositioning: false });
  });

  it("never discards elements when converting", () => {
    const { document, sectionId } = withElements(3);
    const toGrid = convertSectionLayout(document, sectionId, "grid");
    expect(toGrid.pages[0]?.sections[0]?.elements).toHaveLength(3);

    const backToFree = convertSectionLayout(toGrid, sectionId, "free");
    expect(backToFree.pages[0]?.sections[0]?.elements).toHaveLength(3);
  });

  it("preserves geometry through a round trip, so undo restores the exact layout", () => {
    const { document, ids, sectionId } = withElements(2);
    const before = ids.map((id) => findElement(document, id)?.geometry);

    const toGrid = convertSectionLayout(document, sectionId, "grid");
    expect(ids.map((id) => findElement(toGrid, id)?.geometry)).toEqual(before);
  });

  it("lays structured children out readably rather than stacking them at the origin", () => {
    const { document, sectionId } = withElements(3);
    const toGrid = convertSectionLayout(document, sectionId, "grid");
    const toFree = convertSectionLayout(toGrid, sectionId, "free");

    const ys = toFree.pages[0]?.sections[0]?.elements.map((element) => element.geometry.y) ?? [];
    expect(new Set(ys).size).toBe(ys.length);
  });

  it("does nothing when the target mode is already active", () => {
    const { document, sectionId } = withElements(1);
    expect(convertSectionLayout(document, sectionId, "free")).toEqual(document);
  });
});

describe("clipboard", () => {
  it("copies and pastes with entirely new ids", () => {
    const { document, ids, pageId, sectionId } = withElements(1);
    const clipboard = copyElement(document, ids[0]!);
    const result = pasteElement(document, clipboard, { pageId, sectionId });

    expect(result.elementId).not.toBe(ids[0]);
    const section = result.document.pages[0]?.sections[0];
    expect(section?.elements).toHaveLength(2);

    const allIds = (section?.elements ?? []).flatMap(collectIds);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("offsets the pasted copy so it does not hide the original", () => {
    const { document, ids, pageId, sectionId } = withElements(1);
    const original = findElement(document, ids[0]!);
    const result = pasteElement(document, copyElement(document, ids[0]!), { pageId, sectionId });
    const pasted = findElement(result.document, result.elementId!);

    expect(pasted?.geometry.x).toBe((original?.geometry.x ?? 0) + 16);
  });

  it("cuts by removing the source and keeping it on the clipboard", () => {
    const { document, ids } = withElements(2);
    const result = cutElement(document, ids[0]!);

    expect(findElement(result.document, ids[0]!)).toBeNull();
    expect(result.clipboard?.element.id).toBe(ids[0]);
  });

  it("pastes into a different page's section", () => {
    const { document, ids, sectionId } = withElements(1);
    const clipboard = copyElement(document, ids[0]!);

    const second = addSection(document, document.pages[0]!.id, "free");
    const target = second.document.pages[0]?.sections[1];
    if (!target) throw new Error("fixture is missing the second section");

    const result = pasteElement(second.document, clipboard, {
      pageId: second.document.pages[0]!.id,
      sectionId: target.id,
    });

    expect(result.document.pages[0]?.sections[1]?.elements).toHaveLength(1);
    expect(result.document.pages[0]?.sections[0]?.elements[0]?.id).toBe(ids[0]);
    expect(sectionId).not.toBe(target.id);
  });

  it("does nothing with an empty clipboard or an unknown target", () => {
    const { document, ids, pageId } = withElements(1);
    expect(pasteElement(document, null, { pageId, sectionId: "x" }).elementId).toBeNull();
    expect(pasteElement(document, copyElement(document, ids[0]!), { pageId, sectionId: "missing" }).document).toEqual(
      document,
    );
  });

  it("keeps the document schema-valid after a paste", () => {
    const { document, ids, pageId, sectionId } = withElements(1);
    const result = pasteElement(document, copyElement(document, ids[0]!), { pageId, sectionId });
    expect(builderDocumentInputSchema.safeParse(result.document).success).toBe(true);
  });
});

describe("addSection at a position", () => {
  it("inserts between existing sections instead of only appending", () => {
    const { document, pageId, sectionId } = withElements(0);
    const { document: next, sectionId: created } = addSection(document, pageId, "grid", 0);

    const sections = next.pages.find((page) => page.id === pageId)?.sections;
    expect(sections?.map((section) => section.id)).toEqual([created, sectionId]);
    expect(sections?.[0]?.layoutMode).toBe("grid");
  });

  it("clamps a position past the end to the end", () => {
    const { document, pageId } = withElements(0);
    const { document: next, sectionId: created } = addSection(document, pageId, "flex", 99);
    const sections = next.pages.find((page) => page.id === pageId)?.sections ?? [];
    expect(sections[sections.length - 1]?.id).toBe(created);
  });
});

describe("sectionOfElement", () => {
  it("finds the section that owns a nested element", () => {
    const { document, ids, pageId } = withElements(1);
    const page = document.pages.find((candidate) => candidate.id === pageId)!;
    expect(sectionOfElement(page, ids[0]!)?.id).toBe(page.sections[0]?.id);
  });

  it("returns null for an element that is not on the page", () => {
    const { document, pageId } = withElements(0);
    const page = document.pages.find((candidate) => candidate.id === pageId)!;
    expect(sectionOfElement(page, "missing")).toBeNull();
  });
});
