import { builderDocumentInputSchema, createProjectDocument, HOME_PAGE_SLUG } from "@websitebuilder/shared";
import { describe, expect, it } from "vitest";

import {
  addPage,
  deletePage,
  duplicatePage,
  renamePage,
  reorderPages,
  setHomePage,
  setPageSlug,
  uniquePageSlug,
} from "./pages";

const base = () => createProjectDocument({ name: "Acme", slug: "acme" });

describe("addPage", () => {
  it("appends a page with a normalised unique slug and stays schema-valid", () => {
    const document = addPage(base(), "Sobre Nós");
    expect(document.pages).toHaveLength(2);
    expect(document.pages[1]?.slug).toBe("sobre-nos");
    expect(builderDocumentInputSchema.safeParse(document).success).toBe(true);
  });

  it("gives colliding names distinct slugs", () => {
    let document = addPage(base(), "About");
    document = addPage(document, "About");
    document = addPage(document, "About");
    expect(document.pages.map((page) => page.slug)).toEqual(["/", "about", "about-2", "about-3"]);
  });

  it("keeps order contiguous", () => {
    let document = addPage(base(), "A");
    document = addPage(document, "B");
    expect(document.pages.map((page) => page.order)).toEqual([0, 1, 2]);
  });
});

describe("uniquePageSlug", () => {
  it("never renames the homepage slug", () => {
    expect(uniquePageSlug([], HOME_PAGE_SLUG)).toBe(HOME_PAGE_SLUG);
  });

  it("ignores the page being edited when checking collisions", () => {
    const document = addPage(base(), "About");
    const about = document.pages[1];
    if (!about) throw new Error("fixture is missing the About page");
    expect(uniquePageSlug(document.pages, "about", about.id)).toBe("about");
  });

  it("falls back to a usable slug when nothing survives normalisation", () => {
    expect(uniquePageSlug([], "!!!")).toBe("page");
  });
});

describe("deletePage", () => {
  it("refuses to remove the last page", () => {
    const document = base();
    expect(deletePage(document, document.pages[0]!.id)).toEqual(document);
  });

  it("promotes another page to home when the homepage is deleted", () => {
    const document = addPage(base(), "About");
    const result = deletePage(document, document.pages[0]!.id);

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.isHome).toBe(true);
    expect(result.pages[0]?.slug).toBe(HOME_PAGE_SLUG);
    expect(result.pages[0]?.name).toBe("About");
  });

  it("keeps exactly one homepage after any deletion", () => {
    let document = addPage(base(), "About");
    document = addPage(document, "Contact");
    const result = deletePage(document, document.pages[1]!.id);
    expect(result.pages.filter((page) => page.isHome)).toHaveLength(1);
  });
});

describe("setHomePage", () => {
  it("moves the reserved slug to the new homepage and gives the old one a normal slug", () => {
    const document = addPage(base(), "About");
    const about = document.pages[1]!;
    const result = setHomePage(document, about.id);

    expect(result.pages.filter((page) => page.isHome)).toHaveLength(1);
    expect(result.pages.find((page) => page.id === about.id)?.slug).toBe(HOME_PAGE_SLUG);

    const demoted = result.pages.find((page) => page.id !== about.id);
    expect(demoted?.isHome).toBe(false);
    expect(demoted?.slug).toBe("home");
  });

  it("ignores an unknown page id", () => {
    const document = base();
    expect(setHomePage(document, "missing")).toEqual(document);
  });
});

describe("duplicatePage", () => {
  it("regenerates every id so nothing is shared with the source", () => {
    const source = base();
    const document = duplicatePage(source, source.pages[0]!.id);
    const original = document.pages[0]!;
    const copy = document.pages[1];

    expect(copy).toBeDefined();
    expect(copy?.id).not.toBe(original.id);
    expect(copy?.sections[0]?.id).not.toBe(original.sections[0]?.id);
    expect(copy?.isHome).toBe(false);
    expect(copy?.slug).not.toBe(HOME_PAGE_SLUG);
  });

  it("produces a schema-valid document", () => {
    const source = base();
    const document = duplicatePage(source, source.pages[0]!.id);
    expect(document.pages).toHaveLength(2);
    expect(builderDocumentInputSchema.safeParse(document).success).toBe(true);
  });

  it("ignores an unknown page id", () => {
    const source = base();
    expect(duplicatePage(source, "missing")).toEqual(source);
  });
});

describe("renamePage, setPageSlug and reorderPages", () => {
  it("renames without touching the slug", () => {
    const document = addPage(base(), "About");
    const result = renamePage(document, document.pages[1]!.id, "About us");
    expect(result.pages[1]?.name).toBe("About us");
    expect(result.pages[1]?.slug).toBe("about");
  });

  it("normalises an edited slug and refuses to change the homepage slug", () => {
    let document = addPage(base(), "About");
    document = setPageSlug(document, document.pages[1]!.id, "Sobre Nós");
    expect(document.pages[1]?.slug).toBe("sobre-nos");

    document = setPageSlug(document, document.pages[0]!.id, "not-home");
    expect(document.pages[0]?.slug).toBe(HOME_PAGE_SLUG);
  });

  it("reorders and reindexes", () => {
    let document = addPage(base(), "A");
    document = addPage(document, "B");
    const result = reorderPages(document, 2, 0);
    expect(result.pages.map((page) => page.name)).toEqual(["B", "Home", "A"]);
    expect(result.pages.map((page) => page.order)).toEqual([0, 1, 2]);
  });
});
