import { builderDocumentInputSchema, createProjectDocument, walkElements } from "@websitebuilder/shared";
import { describe, expect, it } from "vitest";

import {
  addElement,
  changeZOrder,
  deleteElement,
  duplicateElement,
  findElement,
  moveElement,
  normalizeZOrder,
  requiredPageHeight,
  setElementFlag,
} from "./elements";

function fixture() {
  const document = createProjectDocument({ name: "Acme", slug: "acme" });
  const page = document.pages[0];
  const section = page?.sections[0];
  if (!page || !section) throw new Error("fixture is missing its page or section");
  return { document, pageId: page.id, sectionId: section.id };
}

function withElements(types: Array<"text" | "image" | "button" | "container">) {
  const { document, pageId, sectionId } = fixture();
  let current = document;
  const ids: string[] = [];
  for (const type of types) {
    const result = addElement(current, { pageId, sectionId }, type);
    current = result.document;
    if (result.elementId) ids.push(result.elementId);
  }
  return { document: current, ids, pageId, sectionId };
}

describe("addElement", () => {
  it("adds an element with the documented default size", () => {
    const { document, ids } = withElements(["button"]);
    const button = findElement(document, ids[0]!);
    expect(button?.geometry.width).toBe(180);
    expect(button?.geometry.height).toBe(48);
  });

  it("does not force a full-width size on a button", () => {
    const { document, ids } = withElements(["button"]);
    expect(findElement(document, ids[0]!)?.geometry.width).toBeLessThan(400);
  });

  it("gives every element a unique id and the topmost z-index", () => {
    const { document, ids } = withElements(["text", "image", "button"]);
    expect(new Set(ids).size).toBe(3);

    const zIndexes = ids.map((id) => findElement(document, id)?.zIndex);
    expect(zIndexes).toEqual([1, 2, 3]);
  });

  it("creates a button with an unconfigured link rather than a wrong destination", () => {
    const { document, ids } = withElements(["button"]);
    const button = findElement(document, ids[0]!);
    expect(button?.type === "button" && button.link).toEqual({ kind: "none" });
  });

  it("keeps the document schema-valid", () => {
    const { document } = withElements(["text", "image", "button", "container"]);
    expect(builderDocumentInputSchema.safeParse(document).success).toBe(true);
  });
});

describe("duplicateElement", () => {
  it("offsets the copy and gives it a new id", () => {
    const { document, ids } = withElements(["text"]);
    const original = findElement(document, ids[0]!);
    const result = duplicateElement(document, ids[0]!);

    expect(result.elementId).not.toBe(ids[0]);
    const copy = findElement(result.document, result.elementId!);
    expect(copy?.geometry.x).toBe((original?.geometry.x ?? 0) + 16);
  });

  it("regenerates ids recursively so a nested copy shares nothing", () => {
    const { document, ids, pageId, sectionId } = withElements(["container"]);
    const withChild = addElement(document, { pageId, sectionId }, "text");
    // Place a child inside the container to exercise recursive id regeneration.
    const container = findElement(withChild.document, ids[0]!);
    const child = findElement(withChild.document, withChild.elementId!);
    if (container?.type !== "container" || !child) throw new Error("fixture setup failed");

    const nested = deleteElement(withChild.document, child.id);
    const withNested = {
      ...nested,
      pages: nested.pages.map((page) => ({
        ...page,
        sections: page.sections.map((section) => ({
          ...section,
          elements: section.elements.map((element) =>
            element.id === container.id && element.type === "container"
              ? { ...element, children: [child] }
              : element,
          ),
        })),
      })),
    };

    const result = duplicateElement(withNested, container.id);
    const allIds = [...walkElements(result.document.pages[0]!.sections[0]!.elements)].map((e) => e.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("ignores an unknown element id", () => {
    const { document } = withElements(["text"]);
    expect(duplicateElement(document, "missing").elementId).toBeNull();
  });
});

describe("deleteElement", () => {
  it("removes only the addressed element", () => {
    const { document, ids } = withElements(["text", "image"]);
    const result = deleteElement(document, ids[0]!);
    expect(findElement(result, ids[0]!)).toBeNull();
    expect(findElement(result, ids[1]!)).not.toBeNull();
  });
});

describe("moveElement", () => {
  it("applies constrained geometry", () => {
    const { document, ids } = withElements(["text"]);
    const result = moveElement(document, ids[0]!, { x: -9999, y: -50, width: 100, height: 40, rotation: 0 });
    const moved = findElement(result, ids[0]!);
    expect(moved?.geometry.y).toBe(0);
    expect(moved?.geometry.x).toBeGreaterThan(-100);
  });

  it("refuses to move a locked element", () => {
    const { document, ids } = withElements(["text"]);
    const locked = setElementFlag(document, ids[0]!, "locked", true);
    const before = findElement(locked, ids[0]!)?.geometry;

    const result = moveElement(locked, ids[0]!, { x: 500, y: 500, width: 100, height: 40, rotation: 0 });
    expect(findElement(result, ids[0]!)?.geometry).toEqual(before);
  });
});

describe("z-order", () => {
  it("brings an element forward and sends it backward one step at a time", () => {
    const { document, ids } = withElements(["text", "image", "button"]);
    const order = (doc: typeof document) =>
      ids.map((id) => findElement(doc, id)?.zIndex).map((z) => z ?? 0);

    expect(order(document)).toEqual([1, 2, 3]);

    const forward = changeZOrder(document, ids[0]!, "forward");
    expect(order(forward)).toEqual([2, 1, 3]);

    const backward = changeZOrder(forward, ids[0]!, "backward");
    expect(order(backward)).toEqual([1, 2, 3]);
  });

  it("moves to front and back", () => {
    const { document, ids } = withElements(["text", "image", "button"]);
    const front = changeZOrder(document, ids[0]!, "front");
    expect(findElement(front, ids[0]!)?.zIndex).toBe(3);

    const back = changeZOrder(front, ids[0]!, "back");
    expect(findElement(back, ids[0]!)?.zIndex).toBe(1);
  });

  it("does nothing at the boundaries instead of producing a gap", () => {
    const { document, ids } = withElements(["text", "image"]);
    const stillBack = changeZOrder(document, ids[0]!, "backward");
    expect(findElement(stillBack, ids[0]!)?.zIndex).toBe(1);
  });

  it("normalises to a contiguous sequence so stacking survives save and reload", () => {
    const { document, ids } = withElements(["text", "image"]);
    const scattered = document.pages.map((page) => ({
      ...page,
      sections: page.sections.map((section) => ({
        ...section,
        elements: section.elements.map((element, index) => ({ ...element, zIndex: index === 0 ? 900 : 12 })),
      })),
    }));

    const normalized = normalizeZOrder({ ...document, pages: scattered });
    expect(findElement(normalized, ids[1]!)?.zIndex).toBe(1);
    expect(findElement(normalized, ids[0]!)?.zIndex).toBe(2);
  });
});

describe("requiredPageHeight", () => {
  it("grows to fit the lowest element", () => {
    const { document, ids, pageId } = withElements(["text"]);
    const moved = moveElement(document, ids[0]!, { x: 0, y: 1200, width: 320, height: 64, rotation: 0 });
    const page = moved.pages.find((candidate) => candidate.id === pageId);
    expect(requiredPageHeight(page!)).toBe(1264);
  });

  it("never drops below the minimum", () => {
    const { document, pageId } = withElements([]);
    const page = document.pages.find((candidate) => candidate.id === pageId);
    expect(requiredPageHeight(page!, 400)).toBe(400);
  });
});
