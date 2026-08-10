import { describe, expect, it } from "vitest";

import { createId } from "./ids";
import { builderDocumentInputSchema, createPage, createProjectDocument, findPageBySlug, pagePath } from "./project";
import { SCHEMA_VERSION } from "./schema-version";

describe("createProjectDocument", () => {
  it("creates a valid document with exactly one Home page", () => {
    const document = createProjectDocument({ name: "Acme", slug: "acme" });
    const parsed = builderDocumentInputSchema.safeParse(document);
    expect(parsed.success).toBe(true);
    expect(document.pages).toHaveLength(1);
    expect(document.pages[0]?.isHome).toBe(true);
    expect(document.pages[0]?.slug).toBe("/");
    expect(document.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("starts every page with one free section so the canvas is never empty of structure", () => {
    const document = createProjectDocument({ name: "Acme", slug: "acme" });
    expect(document.pages[0]?.sections).toHaveLength(1);
    expect(document.pages[0]?.sections[0]?.layoutMode).toBe("free");
  });

  it("gives each created page a distinct id", () => {
    const a = createPage({ name: "About", slug: "about" });
    const b = createPage({ name: "Contact", slug: "contact" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("builderDocumentInputSchema", () => {
  it("rejects an unknown schema version rather than rendering it", () => {
    const document = { ...createProjectDocument({ name: "Acme", slug: "acme" }), schemaVersion: 99 };
    expect(builderDocumentInputSchema.safeParse(document).success).toBe(false);
  });

  it("rejects unknown top-level properties", () => {
    const document = { ...createProjectDocument({ name: "Acme", slug: "acme" }), revision: 3 };
    expect(builderDocumentInputSchema.safeParse(document).success).toBe(false);
  });

  it("rejects a document with no pages", () => {
    const document = { ...createProjectDocument({ name: "Acme", slug: "acme" }), pages: [] };
    expect(builderDocumentInputSchema.safeParse(document).success).toBe(false);
  });

  it("validates nested element trees", () => {
    const document = createProjectDocument({ name: "Acme", slug: "acme" });
    const section = document.pages[0]?.sections[0];
    if (!section) throw new Error("fixture is missing its section");
    section.elements.push({
      id: createId(),
      type: "text",
      name: "Heading",
      tag: "h1",
      content: "Hello",
      geometry: { x: 0, y: 0, width: 320, height: 64, rotation: 0 },
      responsiveLayout: {
        width: { value: 320, unit: "px" },
        height: { value: 64, unit: "px" },
        horizontalConstraint: "left",
        verticalConstraint: "top",
        visible: true,
      },
      zIndex: 1,
      locked: false,
      hidden: false,
      style: {
        fontFamily: "Inter",
        fontSize: { value: 32, unit: "px" },
        fontWeight: 700,
        fontStyle: "normal",
        textAlign: "left",
        color: "#111111",
        lineHeight: 1.2,
      },
    });
    expect(builderDocumentInputSchema.safeParse(document).success).toBe(true);

    section.elements.push({
      // @ts-expect-error deliberately invalid: proves the schema rejects an unknown element type.
      type: "script",
      id: createId(),
      name: "Bad",
    });
    expect(builderDocumentInputSchema.safeParse(document).success).toBe(false);
  });
});

describe("page resolution", () => {
  const project = { pages: [createPage({ name: "Home", isHome: true }), createPage({ name: "About", slug: "about" })] };

  it("resolves the homepage from an empty path", () => {
    expect(findPageBySlug(project, "")?.isHome).toBe(true);
    expect(findPageBySlug(project, "/")?.isHome).toBe(true);
  });

  it("resolves a page by slug regardless of surrounding slashes", () => {
    expect(findPageBySlug(project, "about")?.name).toBe("About");
    expect(findPageBySlug(project, "/about/")?.name).toBe("About");
  });

  it("returns null for an unknown slug instead of falling back to the homepage", () => {
    expect(findPageBySlug(project, "missing")).toBeNull();
  });

  it("maps pages to their public path", () => {
    expect(pagePath({ slug: "/", isHome: true })).toBe("/");
    expect(pagePath({ slug: "about", isHome: false })).toBe("/about");
  });
});
