import { describe, expect, it } from "vitest";

import { mapDocumentElements, walkDocumentElements, type DocumentLike } from "./document-traversal";
import type { BuilderElement } from "./elements";
import { createEmptySection, createPage, createProjectDocument } from "./project";
import type { BuilderSection } from "./project";

/**
 * What the traversal tells a transform about where an element is.
 *
 * The location is not decoration: the responsive migration uses it to decide whether an element is
 * placed by coordinate, and getting it wrong writes phone overrides onto elements the browser was
 * already laying out — moving somebody's work for a problem they did not have.
 *
 * The layout that matters is the immediate parent's. A flex container inside a free section puts its
 * own children in flow, and the section's mode says nothing about them.
 */

const element = (id: string): BuilderElement =>
  ({
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
    geometry: { x: 0, y: 0, width: 200, height: 40, rotation: 0 },
    responsiveLayout: {
      width: { value: 200, unit: "px" },
      height: { value: 40, unit: "px" },
      horizontalConstraint: "left",
      verticalConstraint: "top",
      visible: true,
    },
    zIndex: 1,
    locked: false,
    hidden: false,
  }) as unknown as BuilderElement;

const container = (id: string, layout: "free" | "flex" | "grid", children: BuilderElement[]): BuilderElement =>
  ({
    ...(element(id) as object),
    type: "container",
    layout,
    layoutByBreakpoint: {},
    children,
  }) as unknown as BuilderElement;

const section = (id: string, layoutMode: "free" | "flex" | "grid", elements: BuilderElement[]): BuilderSection => ({
  ...createEmptySection(),
  id,
  layoutMode,
  elements,
});

const documentWith = (sections: BuilderSection[], shared: BuilderSection[] = []): DocumentLike => {
  const base = createProjectDocument({ name: "Traversal", slug: "traversal" });
  return { ...base, pages: [{ ...createPage({ name: "Home", isHome: true }), sections }], sharedSections: shared };
};

/** The layout each element was told about, by id. */
function layoutsFor(document: DocumentLike): Record<string, string> {
  const seen: Record<string, string> = {};
  for (const { element: current, location } of walkDocumentElements(document)) {
    seen[current.id] = location.layoutMode;
  }
  return seen;
}

describe("the layout an element is told about", () => {
  it("is the section's for a direct child of the section", () => {
    const layouts = layoutsFor(documentWith([section("s", "free", [element("top")])]));
    expect(layouts["top"]).toBe("free");
  });

  it("is the container's, not the section's, for a child of a flex container", () => {
    // The section places the container by coordinate. The container places its own children in flow,
    // and treating them as free would write a phone override onto an element the browser already
    // reflows — moving somebody's work for a problem they do not have.
    const layouts = layoutsFor(documentWith([section("s", "free", [container("box", "flex", [element("child")])])]));

    expect(layouts["box"]).toBe("free");
    expect(layouts["child"]).toBe("flex");
  });

  it("is the container's for a child of a grid container", () => {
    const layouts = layoutsFor(documentWith([section("s", "free", [container("box", "grid", [element("child")])])]));
    expect(layouts["child"]).toBe("grid");
  });

  it("is free for a child of a free container inside a flow section", () => {
    const layouts = layoutsFor(documentWith([section("s", "flex", [container("box", "free", [element("child")])])]));

    expect(layouts["box"]).toBe("flex");
    expect(layouts["child"]).toBe("free");
  });

  it("stays correct through mixed depths", () => {
    const deep = container("outer", "free", [container("middle", "grid", [container("inner", "free", [element("leaf")])])]);
    const layouts = layoutsFor(documentWith([section("s", "flex", [deep])]));

    expect(layouts["outer"]).toBe("flex");
    expect(layouts["middle"]).toBe("free");
    expect(layouts["inner"]).toBe("grid");
    expect(layouts["leaf"]).toBe("free");
  });

  it("reports the same locations to a rewrite as to a read", () => {
    const document = documentWith([section("s", "free", [container("box", "flex", [element("child")])])]);
    const seen: Record<string, string> = {};

    mapDocumentElements(document, (current, location) => {
      seen[current.id] = location.layoutMode;
      return current;
    });

    expect(seen).toEqual(layoutsFor(document));
  });
});

describe("shared sections", () => {
  it("reports their own layout, and no page id", () => {
    const document = documentWith([], [section("shared", "grid", [element("in-shared")])]);
    const locations = [...walkDocumentElements(document)];

    const entry = locations.find(({ element: current }) => current.id === "in-shared");
    expect(entry?.location.layoutMode).toBe("grid");
    expect(entry?.location.pageId).toBeNull();
  });
});
