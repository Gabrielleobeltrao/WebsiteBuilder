import type { BuilderElement, SectionLayoutMode } from "./elements";
import type { BuilderPage, BuilderSection } from "./project";

/**
 * The one way a document-wide transform visits elements.
 *
 * Three transforms each wrote their own traversal and each stopped somewhere different: element
 * migration reached nested containers and not shared sections, responsive migration reached neither,
 * readiness reached both. So readiness blocked publication on elements the migration existed to fix
 * and never saw — an old site could be edited and saved and never published, and the message named
 * a block the author could not tell apart from the one beside it that worked.
 *
 * What makes that class of bug possible is having three answers to "what is in this document". This
 * is the single answer.
 *
 * It walks the document as stored, never as resolved. A page section that references a shared
 * section carries its own (empty) element list, and the shared section is visited once through
 * `sharedSections` — so a header is transformed exactly once no matter how many pages show it.
 */

export type DocumentLike = {
  pages: BuilderPage[];
  sharedSections: BuilderSection[];
};

export type ElementLocation = {
  /** The page holding this element, or null when it lives in a shared section. */
  pageId: string | null;
  sectionId: string;
  /**
   * How this element's *immediate parent* places it.
   *
   * The section's mode for a direct child of the section, and the container's own `layout` for
   * anything inside one. Passing the section's mode all the way down told a transform that a child
   * of a flex container was positioned by coordinate, which is how the responsive migration came to
   * write phone overrides onto elements the browser already reflows — moving somebody's work for a
   * problem they did not have.
   */
  layoutMode: SectionLayoutMode;
  /** Depth 0 is a direct child of the section; deeper means inside a container. */
  depth: number;
};

/** Every element in the document, wherever it lives, with enough context to decide about it. */
export function* walkDocumentElements(
  document: DocumentLike,
): Generator<{ element: BuilderElement; location: ElementLocation }> {
  function* section(current: BuilderSection, pageId: string | null): Generator<{ element: BuilderElement; location: ElementLocation }> {
    function* level(
      elements: readonly BuilderElement[],
      layoutMode: SectionLayoutMode,
      depth: number,
    ): Generator<{ element: BuilderElement; location: ElementLocation }> {
      for (const element of elements) {
        yield { element, location: { pageId, sectionId: current.id, layoutMode, depth } };
        // Children are placed by the container, so the container's layout is what describes them.
        if (element.type === "container") yield* level(element.children, element.layout, depth + 1);
      }
    }
    yield* level(current.elements, current.layoutMode, 0);
  }

  for (const page of document.pages) {
    for (const current of page.sections) yield* section(current, page.id);
  }
  for (const current of document.sharedSections) yield* section(current, null);
}

/**
 * Rewrites every element in the document, keeping object identity wherever nothing changed.
 *
 * Identity matters to the callers: the editor loads a document and must not mark it dirty, and the
 * migrations report "nothing to do" by returning the object they were given. An implementation that
 * rebuilt the tree unconditionally would make every load a pending save.
 *
 * Children are visited before their container, so a transform that reads a container's children sees
 * the rewritten ones.
 */
export function mapDocumentElements<T extends DocumentLike>(
  document: T,
  visit: (element: BuilderElement, location: ElementLocation) => BuilderElement,
): T {
  const visitLevel = (
    elements: readonly BuilderElement[],
    section: BuilderSection,
    pageId: string | null,
    layoutMode: SectionLayoutMode,
    depth: number,
  ): readonly BuilderElement[] => {
    const next = elements.map((element) => {
      const withChildren =
        element.type === "container"
          ? (() => {
              // The container's own layout describes its children, not the section's.
              const children = visitLevel(element.children, section, pageId, element.layout, depth + 1);
              return children === element.children ? element : ({ ...element, children } as BuilderElement);
            })()
          : element;

      return visit(withChildren, { pageId, sectionId: section.id, layoutMode, depth });
    });

    return next.every((element, index) => element === elements[index]) ? elements : next;
  };

  const visitSection = (section: BuilderSection, pageId: string | null): BuilderSection => {
    const elements = visitLevel(section.elements, section, pageId, section.layoutMode, 0);
    return elements === section.elements ? section : { ...section, elements: elements as BuilderElement[] };
  };

  const pages = document.pages.map((page) => {
    const sections = page.sections.map((section) => visitSection(section, page.id));
    return sections.every((section, index) => section === page.sections[index]) ? page : { ...page, sections };
  });

  const sharedSections = document.sharedSections.map((section) => visitSection(section, null));

  const pagesChanged = !pages.every((page, index) => page === document.pages[index]);
  const sharedChanged = !sharedSections.every((section, index) => section === document.sharedSections[index]);
  if (!pagesChanged && !sharedChanged) return document;

  return { ...document, pages, sharedSections };
}
