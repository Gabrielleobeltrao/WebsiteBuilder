import {
  createId,
  createPage,
  HOME_PAGE_SLUG,
  normalizePageSlug,
  type BuilderDocumentInput,
  type BuilderPage,
  type BuilderSection,
} from "@websitebuilder/shared";

/**
 * Pure page operations over a builder document. They are separated from the store so the rules
 * that must never break — one homepage, unique slugs, never zero pages — are testable without
 * mounting React, and so the same functions can serve a future server-side migration.
 */

/** Makes a slug unique within the document by appending a numeric suffix. */
export function uniquePageSlug(pages: readonly BuilderPage[], desired: string, ignorePageId?: string): string {
  const normalized = normalizePageSlug(desired) || "page";
  if (normalized === HOME_PAGE_SLUG) return HOME_PAGE_SLUG;

  const taken = new Set(pages.filter((page) => page.id !== ignorePageId).map((page) => page.slug));
  if (!taken.has(normalized)) return normalized;

  for (let suffix = 2; suffix < 500; suffix += 1) {
    const candidate = `${normalized}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${normalized}-${createId().slice(0, 8)}`;
}

function reindex(pages: BuilderPage[]): BuilderPage[] {
  return pages.map((page, index) => ({ ...page, order: index }));
}

export function addPage(document: BuilderDocumentInput, name: string): BuilderDocumentInput {
  const page = createPage({
    name,
    slug: uniquePageSlug(document.pages, name),
    order: document.pages.length,
  });
  return { ...document, pages: reindex([...document.pages, page]) };
}

export function renamePage(document: BuilderDocumentInput, pageId: string, name: string): BuilderDocumentInput {
  return {
    ...document,
    pages: document.pages.map((page) => (page.id === pageId ? { ...page, name } : page)),
  };
}

export function setPageSlug(document: BuilderDocumentInput, pageId: string, slug: string): BuilderDocumentInput {
  return {
    ...document,
    pages: document.pages.map((page) =>
      page.id === pageId && !page.isHome ? { ...page, slug: uniquePageSlug(document.pages, slug, pageId) } : page,
    ),
  };
}

/** Duplicates a page with fresh IDs throughout, so no two nodes ever share an identifier. */
export function duplicatePage(document: BuilderDocumentInput, pageId: string): BuilderDocumentInput {
  const source = document.pages.find((page) => page.id === pageId);
  if (source === undefined) return document;

  const copy: BuilderPage = {
    ...structuredClone(source),
    id: createId(),
    name: `${source.name} copy`,
    slug: uniquePageSlug(document.pages, `${source.name} copy`),
    isHome: false,
    order: document.pages.length,
    sections: structuredClone(source.sections).map(regenerateSectionIds),
  };
  return { ...document, pages: reindex([...document.pages, copy]) };
}

function regenerateSectionIds(section: BuilderSection): BuilderSection {
  return {
    ...section,
    id: createId(),
    elements: section.elements.map(regenerateElementIds),
  };
}

function regenerateElementIds<T extends { id: string; type: string }>(element: T): T {
  const next = { ...element, id: createId() };
  if ("children" in next && Array.isArray((next as { children: unknown[] }).children)) {
    return {
      ...next,
      children: (next as unknown as { children: Array<{ id: string; type: string }> }).children.map(
        regenerateElementIds,
      ),
    };
  }
  return next;
}

/**
 * Deletes a page. The last page is never removed, and deleting the homepage promotes the next one
 * — a document with no home has no entry point and no valid route manifest.
 */
export function deletePage(document: BuilderDocumentInput, pageId: string): BuilderDocumentInput {
  if (document.pages.length <= 1) return document;
  const target = document.pages.find((page) => page.id === pageId);
  if (target === undefined) return document;

  const remaining = document.pages.filter((page) => page.id !== pageId);
  if (target.isHome) {
    const first = remaining[0];
    if (first !== undefined) {
      return {
        ...document,
        pages: reindex([{ ...first, isHome: true, slug: HOME_PAGE_SLUG }, ...remaining.slice(1)]),
      };
    }
  }
  return { ...document, pages: reindex(remaining) };
}

export function reorderPages(document: BuilderDocumentInput, fromIndex: number, toIndex: number): BuilderDocumentInput {
  const pages = [...document.pages];
  const [moved] = pages.splice(fromIndex, 1);
  if (moved === undefined) return document;
  pages.splice(Math.max(0, Math.min(toIndex, pages.length)), 0, moved);
  return { ...document, pages: reindex(pages) };
}

/**
 * Sets the homepage. Exactly one page is home at any time, and the promoted page takes the
 * reserved "/" slug while the demoted one gets a normal slug derived from its name.
 */
export function setHomePage(document: BuilderDocumentInput, pageId: string): BuilderDocumentInput {
  if (!document.pages.some((page) => page.id === pageId)) return document;

  const pages = document.pages.map((page) => {
    if (page.id === pageId) return { ...page, isHome: true, slug: HOME_PAGE_SLUG };
    if (!page.isHome) return page;
    return { ...page, isHome: false, slug: page.name };
  });

  // Resolve the demoted page's slug against the others only after the swap, so it cannot collide.
  return {
    ...document,
    pages: pages.map((page) =>
      page.isHome || page.slug !== page.name ? page : { ...page, slug: uniquePageSlug(pages, page.name, page.id) },
    ),
  };
}
