import { builderDocumentInputSchema, createPage, createProjectDocument } from "@websitebuilder/shared";
import { describe, expect, it } from "vitest";

import { addElement } from "./elements";
import {
  attachSharedSection,
  deleteSharedSection,
  detachSharedSection,
  findSharedSection,
  pagesReferencing,
  resolvePageSections,
  updateSharedSection,
} from "./sharedSections";

function twoPages() {
  const document = createProjectDocument({ name: "Acme", slug: "acme" });
  document.pages.push(createPage({ name: "About", slug: "about", order: 1 }));
  return document;
}

describe("attachSharedSection", () => {
  it("creates the shared section once and references it from the page", () => {
    const base = twoPages();
    const attached = attachSharedSection(base, base.pages[0]!.id, "header");

    expect(attached.sharedSections).toHaveLength(1);
    expect(attached.pages[0]?.sections[0]?.sharedSectionId).toBe(attached.sharedSections[0]?.id);
  });

  it("creates nothing when the page id is stale, leaving no orphan behind", () => {
    const document = attachSharedSection(twoPages(), "missing-page", "header");
    expect(document.sharedSections).toHaveLength(0);
  });

  it("reuses the same shared section across pages rather than copying it", () => {
    const base = twoPages();
    let document = attachSharedSection(base, base.pages[0]!.id, "header");
    document = attachSharedSection(document, document.pages[1]!.id, "header");

    expect(document.sharedSections).toHaveLength(1);
    const id = document.sharedSections[0]?.id;
    expect(document.pages[0]?.sections[0]?.sharedSectionId).toBe(id);
    expect(document.pages[1]?.sections[0]?.sharedSectionId).toBe(id);
  });

  it("places a header first and a footer last", () => {
    const base = twoPages();
    let document = attachSharedSection(base, base.pages[0]!.id, "header");
    document = attachSharedSection(document, document.pages[0]!.id, "footer");

    const sections = document.pages[0]?.sections ?? [];
    expect(sections[0]?.role).toBe("header");
    expect(sections[sections.length - 1]?.role).toBe("footer");
  });

  it("does not attach the same shared section twice to one page", () => {
    const base = twoPages();
    let document = attachSharedSection(base, base.pages[0]!.id, "header");
    document = attachSharedSection(document, document.pages[0]!.id, "header");

    expect(document.pages[0]?.sections.filter((section) => section.sharedSectionId !== undefined)).toHaveLength(1);
  });

  it("keeps the document schema-valid", () => {
    const base = twoPages();
    const document = attachSharedSection(base, base.pages[0]!.id, "header");
    expect(builderDocumentInputSchema.safeParse(document).success).toBe(true);
  });
});

describe("resolvePageSections", () => {
  it("renders the shared content on every referencing page", () => {
    const base = twoPages();
    let document = attachSharedSection(base, base.pages[0]!.id, "header");
    document = attachSharedSection(document, document.pages[1]!.id, "header");

    const sharedId = document.sharedSections[0]!.id;
    const withElement = addElement(
      { ...document, pages: [{ ...document.pages[0]!, sections: document.sharedSections }] },
      { pageId: document.pages[0]!.id, sectionId: sharedId },
      "text",
    );
    document = updateSharedSection(document, sharedId, () => withElement.document.pages[0]!.sections[0]!);

    for (const page of document.pages) {
      const resolved = resolvePageSections(document, page);
      expect(resolved[0]?.elements).toHaveLength(1);
    }
  });

  it("edits reach every page because pages hold a reference, not a copy", () => {
    const base = twoPages();
    let document = attachSharedSection(base, base.pages[0]!.id, "footer");
    document = attachSharedSection(document, document.pages[1]!.id, "footer");

    const sharedId = document.sharedSections[0]!.id;
    document = updateSharedSection(document, sharedId, (section) => ({ ...section, backgroundColor: "#101010" }));

    for (const page of document.pages) {
      const resolved = resolvePageSections(document, page);
      expect(resolved[resolved.length - 1]?.backgroundColor).toBe("#101010");
    }
  });

  it("lets a page hide the shared section without affecting the others", () => {
    const base = twoPages();
    let document = attachSharedSection(base, base.pages[0]!.id, "header");
    document = attachSharedSection(document, document.pages[1]!.id, "header");

    document = {
      ...document,
      pages: document.pages.map((page, index) =>
        index === 0
          ? { ...page, sections: page.sections.map((section) => ({ ...section, hidden: true })) }
          : page,
      ),
    };

    expect(resolvePageSections(document, document.pages[0]!)[0]?.hidden).toBe(true);
    expect(resolvePageSections(document, document.pages[1]!)[0]?.hidden).toBe(false);
  });

  it("resolves a dangling reference to nothing rather than an empty box", () => {
    const base = twoPages();
    let document = attachSharedSection(base, base.pages[0]!.id, "header");
    const sharedId = document.sharedSections[0]!.id;

    // Simulate a shared section removed without cleaning up references.
    document = { ...document, sharedSections: [] };

    const resolved = resolvePageSections(document, document.pages[0]!);
    expect(resolved.every((section) => section.sharedSectionId === undefined)).toBe(true);
    expect(findSharedSection(document, sharedId)).toBeNull();
  });
});

describe("detach and delete", () => {
  it("detaching removes the reference from one page only", () => {
    const base = twoPages();
    let document = attachSharedSection(base, base.pages[0]!.id, "header");
    document = attachSharedSection(document, document.pages[1]!.id, "header");
    const sharedId = document.sharedSections[0]!.id;

    document = detachSharedSection(document, document.pages[0]!.id, sharedId);

    expect(pagesReferencing(document, sharedId).map((page) => page.name)).toEqual(["About"]);
    expect(document.sharedSections).toHaveLength(1);
  });

  it("deleting removes the section and every reference to it", () => {
    const base = twoPages();
    let document = attachSharedSection(base, base.pages[0]!.id, "header");
    document = attachSharedSection(document, document.pages[1]!.id, "header");
    const sharedId = document.sharedSections[0]!.id;

    document = deleteSharedSection(document, sharedId);

    expect(document.sharedSections).toHaveLength(0);
    expect(pagesReferencing(document, sharedId)).toHaveLength(0);
    expect(builderDocumentInputSchema.safeParse(document).success).toBe(true);
  });

  it("reports which pages use a shared section, so an edit can state its reach", () => {
    const base = twoPages();
    let document = attachSharedSection(base, base.pages[0]!.id, "header");
    document = attachSharedSection(document, document.pages[1]!.id, "header");

    expect(pagesReferencing(document, document.sharedSections[0]!.id)).toHaveLength(2);
  });
});
