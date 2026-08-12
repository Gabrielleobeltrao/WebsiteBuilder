import type { BuilderPage, BuilderSection } from "./project";

/**
 * Shared header and footer resolution.
 *
 * A page stores a *reference* to a shared section, not a copy, so editing the header once changes
 * every page. That only holds if every renderer resolves the reference — the editor, the draft
 * preview and the published site alike. It lives here rather than in the editor for exactly that
 * reason: it used to be an editor concern, and a published page therefore shipped without its
 * header while the builder showed one.
 */
export function findSharedSection(
  document: { sharedSections: readonly BuilderSection[] },
  sharedSectionId: string,
): BuilderSection | null {
  return document.sharedSections.find((section) => section.id === sharedSectionId) ?? null;
}

export function resolvePageSections(
  document: { sharedSections: readonly BuilderSection[] },
  page: BuilderPage,
): BuilderSection[] {
  return page.sections.flatMap((section) => {
    if (section.sharedSectionId === undefined) return [section];
    const shared = findSharedSection(document, section.sharedSectionId);
    // A dangling reference renders nothing rather than an empty band nobody can select or remove.
    if (shared === null) return [];
    // Keep the reference's own id and hidden flag so a page can hide the shared header locally.
    return [{ ...shared, id: section.id, sharedSectionId: shared.id, hidden: section.hidden || shared.hidden }];
  });
}

/** The page as it should be rendered: shared references resolved, nothing else changed. */
export function renderablePage(document: { sharedSections: readonly BuilderSection[] }, page: BuilderPage): BuilderPage {
  return { ...page, sections: resolvePageSections(document, page) };
}
