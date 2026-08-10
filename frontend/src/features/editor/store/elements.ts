import {
  createId,
  DESIGN_WIDTH,
  type BuilderDocumentInput,
  type BuilderElement,
  type BuilderPage,
  type BuilderSection,
  type ElementType,
  type Geometry,
} from "@websitebuilder/shared";

import { constrainGeometry } from "@/features/editor/canvas/coordinates";

/**
 * Pure element operations over a builder document. Kept out of the store so the rules that matter —
 * unique IDs, deterministic z-order, locked elements staying put — are testable without React.
 */

/** Defaults from Section 7 of the plan. Nothing here forces a full-width size. */
const DEFAULTS: Record<ElementType, { width: number; height: number }> = {
  text: { width: 320, height: 64 },
  image: { width: 400, height: 260 },
  button: { width: 180, height: 48 },
  container: { width: 480, height: 240 },
};

function baseLayout(width: number, height: number) {
  return {
    width: { value: width, unit: "px" as const },
    height: { value: height, unit: "px" as const },
    horizontalConstraint: "left" as const,
    verticalConstraint: "top" as const,
    visible: true,
  };
}

function nextZIndex(section: BuilderSection): number {
  return section.elements.reduce((highest, element) => Math.max(highest, element.zIndex), 0) + 1;
}

/** Creates an element centred on the visible canvas area, on top of everything else. */
export function createElement(
  type: ElementType,
  options: { section: BuilderSection; viewportCentre?: { x: number; y: number } },
): BuilderElement {
  const size = DEFAULTS[type];
  const centre = options.viewportCentre ?? { x: DESIGN_WIDTH / 2, y: 200 };
  const geometry: Geometry = constrainGeometry({
    x: centre.x - size.width / 2,
    y: centre.y - size.height / 2,
    width: size.width,
    height: size.height,
    rotation: 0,
  });

  const shared = {
    id: createId(),
    geometry,
    responsiveLayout: baseLayout(size.width, size.height),
    zIndex: nextZIndex(options.section),
    locked: false,
    hidden: false,
  };

  switch (type) {
    case "text":
      return {
        ...shared,
        type: "text",
        name: "Text",
        tag: "p",
        content: "Write something",
        style: {
          fontFamily: "Inter",
          fontSize: { value: 18, unit: "px" },
          fontWeight: 400,
          fontStyle: "normal",
          textAlign: "left",
          color: "#232936",
          lineHeight: 1.5,
        },
      };
    case "image":
      return {
        ...shared,
        type: "image",
        name: "Image",
        source: { kind: "empty" },
        alt: "",
        decorative: false,
        style: { objectFit: "cover", borderRadius: 0 },
      };
    case "button":
      return {
        ...shared,
        type: "button",
        name: "Button",
        text: "Button",
        // Unconfigured until the designer chooses a destination: a button that silently links
        // nowhere is worse than one that visibly needs configuring.
        link: { kind: "none" },
        style: {
          fontSize: { value: 16, unit: "px" },
          fontWeight: 600,
          textColor: "#ffffff",
          backgroundColor: "#12806f",
          borderRadius: 6,
          horizontalAlign: "center",
        },
      };
    case "container":
      return { ...shared, type: "container", name: "Container", layout: "free", children: [], layoutByBreakpoint: {} };
  }
}

function mapPage(
  document: BuilderDocumentInput,
  pageId: string,
  recipe: (page: BuilderPage) => BuilderPage,
): BuilderDocumentInput {
  return { ...document, pages: document.pages.map((page) => (page.id === pageId ? recipe(page) : page)) };
}

function mapSection(page: BuilderPage, sectionId: string, recipe: (section: BuilderSection) => BuilderSection) {
  return { ...page, sections: page.sections.map((s) => (s.id === sectionId ? recipe(s) : s)) };
}

export function addElement(
  document: BuilderDocumentInput,
  location: { pageId: string; sectionId: string },
  type: ElementType,
  viewportCentre?: { x: number; y: number },
): { document: BuilderDocumentInput; elementId: string | null } {
  let elementId: string | null = null;

  const next = mapPage(document, location.pageId, (page) =>
    mapSection(page, location.sectionId, (section) => {
      const element = createElement(type, {
        section,
        ...(viewportCentre ? { viewportCentre } : {}),
      });
      elementId = element.id;
      return { ...section, elements: [...section.elements, element] };
    }),
  );

  return { document: next, elementId };
}

/** Depth-first search across every section of every page. */
export function findElement(document: BuilderDocumentInput, elementId: string): BuilderElement | null {
  for (const page of document.pages) {
    for (const section of page.sections) {
      const found = searchElements(section.elements, elementId);
      if (found) return found;
    }
  }
  return null;
}

function searchElements(elements: readonly BuilderElement[], elementId: string): BuilderElement | null {
  for (const element of elements) {
    if (element.id === elementId) return element;
    if (element.type === "container") {
      const nested = searchElements(element.children, elementId);
      if (nested) return nested;
    }
  }
  return null;
}

function mapElements(
  elements: readonly BuilderElement[],
  elementId: string,
  recipe: (element: BuilderElement) => BuilderElement | null,
): BuilderElement[] {
  const result: BuilderElement[] = [];
  for (const element of elements) {
    if (element.id === elementId) {
      const replacement = recipe(element);
      if (replacement !== null) result.push(replacement);
      continue;
    }
    if (element.type === "container") {
      result.push({ ...element, children: mapElements(element.children, elementId, recipe) });
      continue;
    }
    result.push(element);
  }
  return result;
}

function mapAllSections(
  document: BuilderDocumentInput,
  recipe: (elements: readonly BuilderElement[]) => BuilderElement[],
): BuilderDocumentInput {
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      sections: page.sections.map((section) => ({ ...section, elements: recipe(section.elements) })),
    })),
  };
}

export function updateElement(
  document: BuilderDocumentInput,
  elementId: string,
  recipe: (element: BuilderElement) => BuilderElement,
): BuilderDocumentInput {
  return mapAllSections(document, (elements) => mapElements(elements, elementId, recipe));
}

export function deleteElement(document: BuilderDocumentInput, elementId: string): BuilderDocumentInput {
  return mapAllSections(document, (elements) => mapElements(elements, elementId, () => null));
}

/** Moves geometry, refusing to move a locked element. */
export function moveElement(
  document: BuilderDocumentInput,
  elementId: string,
  geometry: Geometry,
): BuilderDocumentInput {
  return updateElement(document, elementId, (element) =>
    element.locked ? element : { ...element, geometry: constrainGeometry(geometry) },
  );
}

export function setElementFlag(
  document: BuilderDocumentInput,
  elementId: string,
  flag: "locked" | "hidden",
  value: boolean,
): BuilderDocumentInput {
  return updateElement(document, elementId, (element) => ({ ...element, [flag]: value }));
}

export function renameElement(document: BuilderDocumentInput, elementId: string, name: string): BuilderDocumentInput {
  return updateElement(document, elementId, (element) => ({ ...element, name }));
}

function regenerateIds(element: BuilderElement): BuilderElement {
  const next = { ...element, id: createId() };
  if (next.type === "container") {
    return { ...next, children: next.children.map(regenerateIds) };
  }
  return next;
}

/** Duplicates an element next to the original with fresh IDs throughout. */
export function duplicateElement(
  document: BuilderDocumentInput,
  elementId: string,
  offset = 16,
): { document: BuilderDocumentInput; elementId: string | null } {
  const source = findElement(document, elementId);
  if (source === null) return { document, elementId: null };

  const copy = regenerateIds(structuredClone(source));
  copy.geometry = constrainGeometry({
    ...copy.geometry,
    x: copy.geometry.x + offset,
    y: copy.geometry.y + offset,
  });

  const next = mapAllSections(document, (elements) => {
    const index = elements.findIndex((element) => element.id === elementId);
    if (index === -1) return [...elements];
    const highest = elements.reduce((max, element) => Math.max(max, element.zIndex), 0);
    return [...elements.slice(0, index + 1), { ...copy, zIndex: highest + 1 }, ...elements.slice(index + 1)];
  });

  return { document: next, elementId: copy.id };
}

/**
 * Normalises z-index to a contiguous 1..n sequence per section after any reorder, so stacking is
 * deterministic after save and reload rather than depending on accumulated arbitrary values.
 */
export function normalizeZOrder(document: BuilderDocumentInput): BuilderDocumentInput {
  return mapAllSections(document, (elements) => {
    const ordered = [...elements].sort((a, b) => a.zIndex - b.zIndex);
    const ranks = new Map(ordered.map((element, index) => [element.id, index + 1]));
    return elements.map((element) => ({ ...element, zIndex: ranks.get(element.id) ?? element.zIndex }));
  });
}

export function changeZOrder(
  document: BuilderDocumentInput,
  elementId: string,
  direction: "forward" | "backward" | "front" | "back",
): BuilderDocumentInput {
  const next = mapAllSections(document, (elements) => {
    if (!elements.some((element) => element.id === elementId)) return [...elements];

    const ordered = [...elements].sort((a, b) => a.zIndex - b.zIndex);
    const index = ordered.findIndex((element) => element.id === elementId);
    if (index === -1) return [...elements];

    const target =
      direction === "forward"
        ? Math.min(ordered.length - 1, index + 1)
        : direction === "backward"
          ? Math.max(0, index - 1)
          : direction === "front"
            ? ordered.length - 1
            : 0;

    const [moved] = ordered.splice(index, 1);
    if (moved === undefined) return [...elements];
    ordered.splice(target, 0, moved);

    const ranks = new Map(ordered.map((element, rank) => [element.id, rank + 1]));
    return elements.map((element) => ({ ...element, zIndex: ranks.get(element.id) ?? element.zIndex }));
  });

  return next;
}

/** Lowest y a page must accommodate, used to grow the canvas as content is placed. */
export function requiredPageHeight(page: BuilderPage, minimum = 400): number {
  let lowest = minimum;
  for (const section of page.sections) {
    for (const element of section.elements) {
      lowest = Math.max(lowest, element.geometry.y + element.geometry.height);
    }
  }
  return Math.ceil(lowest);
}
