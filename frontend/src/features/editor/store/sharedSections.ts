import {
  createEmptySection,
  createId,
  findSharedSection,
  resolvePageSections,
  type BuilderDocumentInput,
  type BuilderPage,
  type BuilderSection,
  type SectionRole,
} from "@websitebuilder/shared";

export { findSharedSection, resolvePageSections };

/**
 * Shared header and footer sections.
 *
 * A page holds a *reference* to a shared section, never a copy of its contents. That is the whole
 * point: editing the header once updates every page and every preview, and there is no second copy
 * to drift. Resolution happens at render time, so a page document stays small and a rename or edit
 * never has to be replayed across pages.
 */

/** Marker section stored on a page: it carries the reference and nothing else. */
export function createSharedReference(sharedSectionId: string, role: SectionRole): BuilderSection {
  return {
    id: createId(),
    name: role === "header" ? "Header" : "Footer",
    role,
    sharedSectionId,
    layoutMode: "free",
    heightByBreakpoint: {},
    layoutByBreakpoint: {},
    elements: [],
    backgroundColor: "#ffffff",
    hidden: false,
  };
}

/**
 * Replaces each reference with the shared section's real content for rendering.
 *
 * A reference whose target has been deleted resolves to nothing rather than to an empty box, so a
 * dangling reference cannot leave a mysterious gap on a published page.
 */
export function createSharedSection(
  document: BuilderDocumentInput,
  role: Exclude<SectionRole, "content">,
): { document: BuilderDocumentInput; sharedSectionId: string } {
  const existing = document.sharedSections.find((section) => section.role === role);
  // One header and one footer per site: a second would make "the shared header" ambiguous.
  if (existing) return { document, sharedSectionId: existing.id };

  const shared = { ...createEmptySection(role, role === "header" ? "Header" : "Footer"), role };
  return {
    document: { ...document, sharedSections: [...document.sharedSections, shared] },
    sharedSectionId: shared.id,
  };
}

/** Adds the shared header or footer to a page, at the top or bottom respectively. */
export function attachSharedSection(
  document: BuilderDocumentInput,
  pageId: string,
  role: Exclude<SectionRole, "content">,
): BuilderDocumentInput {
  // Creating the shared section before checking the page would leave an orphan behind whenever the
  // page id is stale.
  if (!document.pages.some((page) => page.id === pageId)) return document;

  const created = createSharedSection(document, role);
  const sharedSectionId = created.sharedSectionId;

  return {
    ...created.document,
    pages: created.document.pages.map((page) => {
      if (page.id !== pageId) return page;
      if (page.sections.some((section) => section.sharedSectionId === sharedSectionId)) return page;

      const reference = createSharedReference(sharedSectionId, role);
      return {
        ...page,
        sections: role === "header" ? [reference, ...page.sections] : [...page.sections, reference],
      };
    }),
  };
}

export function detachSharedSection(
  document: BuilderDocumentInput,
  pageId: string,
  sharedSectionId: string,
): BuilderDocumentInput {
  return {
    ...document,
    pages: document.pages.map((page) =>
      page.id === pageId
        ? { ...page, sections: page.sections.filter((section) => section.sharedSectionId !== sharedSectionId) }
        : page,
    ),
  };
}

/** Pages currently referencing a shared section, so an edit can state its reach. */
export function pagesReferencing(document: BuilderDocumentInput, sharedSectionId: string): BuilderPage[] {
  return document.pages.filter((page) =>
    page.sections.some((section) => section.sharedSectionId === sharedSectionId),
  );
}

export function updateSharedSection(
  document: BuilderDocumentInput,
  sharedSectionId: string,
  recipe: (section: BuilderSection) => BuilderSection,
): BuilderDocumentInput {
  return {
    ...document,
    sharedSections: document.sharedSections.map((section) =>
      section.id === sharedSectionId ? recipe(section) : section,
    ),
  };
}

/**
 * Deletes a shared section and every reference to it. Leaving references behind would produce
 * pages pointing at nothing, which is exactly the dangling state `resolvePageSections` has to
 * defend against.
 */
export function deleteSharedSection(document: BuilderDocumentInput, sharedSectionId: string): BuilderDocumentInput {
  return {
    ...document,
    sharedSections: document.sharedSections.filter((section) => section.id !== sharedSectionId),
    pages: document.pages.map((page) => ({
      ...page,
      sections: page.sections.filter((section) => section.sharedSectionId !== sharedSectionId),
    })),
  };
}
