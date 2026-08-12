import {
  createEmptySection,
  createId,
  DESIGN_WIDTH,
  MAX_CONTAINER_DEPTH,
  elementDepth,
  type BuilderDocumentInput,
  type BuilderElement,
  type BuilderPage,
  type BuilderSection,
  type SectionLayoutMode,
} from "@websitebuilder/shared";

/**
 * Section operations.
 *
 * The layout mode belongs to each section, never to the page. That is what lets one page mix a free
 * artboard section with a grid section, and it is why converting one section can never change how
 * another behaves.
 */

function mapPage(
  document: BuilderDocumentInput,
  pageId: string,
  recipe: (page: BuilderPage) => BuilderPage,
): BuilderDocumentInput {
  return { ...document, pages: document.pages.map((page) => (page.id === pageId ? recipe(page) : page)) };
}

function reindexOrder<T>(items: T[]): T[] {
  return items;
}

export function addSection(
  document: BuilderDocumentInput,
  pageId: string,
  layoutMode: SectionLayoutMode = "free",
  /** Position among existing sections. Appended when absent, which is what the page bottom means. */
  atIndex?: number,
): { document: BuilderDocumentInput; sectionId: string } {
  const section = { ...createEmptySection(), layoutMode };
  return {
    document: mapPage(document, pageId, (page) => {
      const sections = [...page.sections];
      sections.splice(atIndex === undefined ? sections.length : Math.max(0, Math.min(atIndex, sections.length)), 0, section);
      return { ...page, sections };
    }),
    sectionId: section.id,
  };
}

/** The section that owns an element, at any nesting depth. */
export function sectionOfElement(page: BuilderPage, elementId: string): BuilderSection | null {
  const contains = (elements: readonly BuilderElement[]): boolean =>
    elements.some(
      (element) => element.id === elementId || (element.type === "container" && contains(element.children)),
    );
  return page.sections.find((section) => contains(section.elements)) ?? null;
}

export function renameSection(document: BuilderDocumentInput, sectionId: string, name: string): BuilderDocumentInput {
  return mapSections(document, (section) => (section.id === sectionId ? { ...section, name } : section));
}

export function setSectionFlag(
  document: BuilderDocumentInput,
  sectionId: string,
  flag: "hidden",
  value: boolean,
): BuilderDocumentInput {
  return mapSections(document, (section) => (section.id === sectionId ? { ...section, [flag]: value } : section));
}

export function setSectionBackground(
  document: BuilderDocumentInput,
  sectionId: string,
  backgroundColor: string,
): BuilderDocumentInput {
  return mapSections(document, (section) => (section.id === sectionId ? { ...section, backgroundColor } : section));
}

function mapSections(
  document: BuilderDocumentInput,
  recipe: (section: BuilderSection) => BuilderSection,
): BuilderDocumentInput {
  return {
    ...document,
    pages: document.pages.map((page) => ({ ...page, sections: page.sections.map(recipe) })),
  };
}

export function duplicateSection(document: BuilderDocumentInput, sectionId: string): BuilderDocumentInput {
  return {
    ...document,
    pages: document.pages.map((page) => {
      const index = page.sections.findIndex((section) => section.id === sectionId);
      if (index === -1) return page;

      const source = page.sections[index];
      if (!source) return page;

      const copy: BuilderSection = {
        ...structuredClone(source),
        id: createId(),
        name: `${source.name} copy`,
        // A duplicated shared header would be a second copy of one source, defeating the point.
        ...(source.sharedSectionId ? {} : {}),
        elements: structuredClone(source.elements).map(regenerateIds),
      };
      return { ...page, sections: reindexOrder([...page.sections.slice(0, index + 1), copy, ...page.sections.slice(index + 1)]) };
    }),
  };
}

export function deleteSection(document: BuilderDocumentInput, sectionId: string): BuilderDocumentInput {
  return {
    ...document,
    pages: document.pages.map((page) =>
      // A page with no sections has nowhere to place an element, so the last one stays.
      page.sections.length <= 1 || !page.sections.some((section) => section.id === sectionId)
        ? page
        : { ...page, sections: page.sections.filter((section) => section.id !== sectionId) },
    ),
  };
}

export function reorderSections(
  document: BuilderDocumentInput,
  pageId: string,
  fromIndex: number,
  toIndex: number,
): BuilderDocumentInput {
  return mapPage(document, pageId, (page) => {
    const sections = [...page.sections];
    const [moved] = sections.splice(fromIndex, 1);
    if (moved === undefined) return page;
    sections.splice(Math.max(0, Math.min(toIndex, sections.length)), 0, moved);
    return { ...page, sections };
  });
}

function regenerateIds(element: BuilderElement): BuilderElement {
  const next = { ...element, id: createId() };
  if (next.type === "container") return { ...next, children: next.children.map(regenerateIds) };
  return next;
}

/**
 * Converts a section between layout modes.
 *
 * Free to structured lays elements out in their current visual order and keeps their geometry, so
 * an undo restores exactly what was there. Structured to free assigns a deterministic grid position
 * rather than collapsing everything onto the same coordinates. Nothing is ever discarded — the
 * caller shows a warning and the change stays undoable.
 */
export function convertSectionLayout(
  document: BuilderDocumentInput,
  sectionId: string,
  layoutMode: SectionLayoutMode,
): BuilderDocumentInput {
  return mapSections(document, (section) => {
    if (section.id !== sectionId || section.layoutMode === layoutMode) return section;

    if (layoutMode === "free") {
      // Structured children have no meaningful x/y yet; lay them out in a readable column so
      // nothing lands stacked at the origin.
      let offsetY = 0;
      const elements = section.elements.map((element) => {
        const geometry = { ...element.geometry, x: 24, y: offsetY };
        offsetY += element.geometry.height + 16;
        return { ...element, geometry };
      });
      return { ...section, layoutMode, elements };
    }

    // Free geometry is preserved on the element so converting back restores the exact layout.
    const ordered = [...section.elements].sort(
      (a, b) => a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x,
    );
    return { ...section, layoutMode, elements: ordered };
  });
}

export type ConversionImpact = { elementCount: number; losesFreePositioning: boolean };

/** What a conversion will affect, so the warning can state it rather than being generic. */
export function describeConversion(section: BuilderSection, target: SectionLayoutMode): ConversionImpact {
  return {
    elementCount: section.elements.length,
    losesFreePositioning: section.layoutMode === "free" && target !== "free",
  };
}

/** Guards against pathological documents that are slow to render and impossible to reason about. */
export function canNestContainer(parent: BuilderElement): boolean {
  return parent.type === "container" && elementDepth(parent) < MAX_CONTAINER_DEPTH;
}

export const CANVAS_WIDTH = DESIGN_WIDTH;
