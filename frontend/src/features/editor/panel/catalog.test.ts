import { ELEMENT_DEFINITIONS, elementDefinition } from "@websitebuilder/shared";
import { describe, expect, it } from "vitest";

import {
  catalogEntries,
  groupEntries,
  matchesQuery,
  normalizeTerm,
  pruneTypes,
  RECENT_LIMIT,
  rememberRecent,
  toggleFavorite,
  type CatalogEntry,
} from "./catalog";

/**
 * Finding a block among nineteen.
 *
 * The searching rules are the ones people actually rely on and never state: accents are optional,
 * case is irrelevant, and the word they know the block by is not always the word on it.
 */

const entry = (type: Parameters<typeof elementDefinition>[0], label: string, keywords: string[] = []): CatalogEntry => ({
  definition: elementDefinition(type),
  label,
  terms: [label, type, ...elementDefinition(type).keywords, ...keywords],
});

describe("searching", () => {
  it("ignores accents, so a hurried search still finds the block", () => {
    expect(normalizeTerm("Botão")).toBe("botao");
    expect(matchesQuery(entry("button", "Botão"), "botao")).toBe(true);
    expect(matchesQuery(entry("icon", "Ícone"), "icone")).toBe(true);
  });

  it("ignores case and matches part of a word", () => {
    expect(matchesQuery(entry("gallery", "Gallery"), "GALL")).toBe(true);
  });

  it("finds a block by a word that is not its name", () => {
    // Nobody looks for "accordion" when what they want is an FAQ.
    expect(matchesQuery(entry("accordion", "Accordion", ["perguntas", "faq"]), "faq")).toBe(true);
    expect(matchesQuery(entry("video", "Vídeo", ["youtube"]), "youtube")).toBe(true);
  });

  it("matches nothing that has nothing to do with the query", () => {
    expect(matchesQuery(entry("text", "Text"), "carousel")).toBe(false);
  });

  it("returns everything for an empty query", () => {
    expect(matchesQuery(entry("text", "Text"), "   ")).toBe(true);
  });
});

describe("the catalog for a context", () => {
  const build = (context: Parameters<typeof catalogEntries>[0]["context"]) =>
    catalogEntries({
      context,
      label: (definition) => definition.type,
      keywords: () => [],
    });

  it("offers a page every block that is not template-only", () => {
    const types = build("page").map((candidate) => candidate.definition.type);

    expect(types).toContain("text");
    expect(types).toContain("form");
    expect(types).toContain("announcementBar");
  });

  it("hides a block its context cannot hold, rather than disabling it", () => {
    // A page-wide bar inside a blog article template is not a permission somebody can obtain, so a
    // greyed-out row would be a promise the product cannot keep.
    const types = build("blogArticleTemplate").map((candidate) => candidate.definition.type);

    expect(types).not.toContain("announcementBar");
    expect(types).not.toContain("form");
    expect(types).toContain("text");
  });

  it("offers each blog layout the data it actually has", () => {
    // An article draws one post and an index draws a list. Under one shared context the panel
    // offered both to both, so an article layout listed a post feed with nothing to feed it.
    const article = build("blogArticleTemplate").map((candidate) => candidate.definition.type);
    const index = build("blogIndexTemplate").map((candidate) => candidate.definition.type);

    expect(article).toContain("dynamicField");
    expect(article).not.toContain("postCollection");
    expect(index).toContain("postCollection");
    expect(index).not.toContain("dynamicField");
  });

  it("explains a block that cannot be inserted right now", () => {
    const entries = catalogEntries({
      context: "page",
      label: (definition) => definition.type,
      keywords: () => [],
      unavailable: (definition) => (definition.type === "container" ? "Too deep" : undefined),
    });

    expect(entries.find((candidate) => candidate.definition.type === "container")?.unavailable).toBe("Too deep");
    expect(entries.find((candidate) => candidate.definition.type === "text")?.unavailable).toBeUndefined();
  });
});

describe("grouping", () => {
  it("keeps categories in a stable order and drops empty ones", () => {
    const groups = groupEntries([entry("text", "Text"), entry("gallery", "Gallery")]);

    expect(groups.map((group) => group.category)).toEqual(["basic", "media"]);
  });

  it("covers every block in the registry exactly once", () => {
    const entries = catalogEntries({ context: "page", label: (d) => d.type, keywords: () => [] });
    const grouped = groupEntries(entries).flatMap((group) => group.entries);

    expect(grouped).toHaveLength(entries.length);
    expect(new Set(grouped.map((candidate) => candidate.definition.type)).size).toBe(entries.length);
  });
});

describe("recent and favourites", () => {
  it("puts the most recent first and never repeats one", () => {
    const recent = rememberRecent(rememberRecent(["image"], "text"), "image");
    expect(recent).toEqual(["image", "text"]);
  });

  it("stops being recent past the limit", () => {
    const types = ELEMENT_DEFINITIONS.slice(0, RECENT_LIMIT + 3).map((definition) => definition.type);
    const recent = types.reduce<ReturnType<typeof rememberRecent>>((list, type) => rememberRecent(list, type), []);

    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(recent[0]).toBe(types[types.length - 1]);
  });

  it("adds and removes a favourite", () => {
    expect(toggleFavorite([], "text")).toEqual(["text"]);
    expect(toggleFavorite(["text", "image"], "text")).toEqual(["image"]);
  });

  it("drops a stored block that no longer exists", () => {
    // A preference must not resurrect a removed block as a row that inserts nothing.
    expect(pruneTypes(["text", "widgetFromAnotherVersion", "gallery"])).toEqual(["text", "gallery"]);
  });
});
