import {
  createId,
  elementDefinition,
  DESIGN_WIDTH,
  elementDepth,
  MAX_CONTAINER_DEPTH,
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

/**
 * Creates an element centred on the visible canvas area, on top of everything else.
 *
 * The type-specific half — content, style, items — comes from the registry, so a block's defaults
 * are described once beside its schema rather than in a switch here that has to be remembered. This
 * function owns only what belongs to the canvas: a unique id, a size, a position and a z-index.
 */
export function createElement(
  type: ElementType,
  options: { section: BuilderSection; viewportCentre?: { x: number; y: number } },
): BuilderElement {
  const definition = elementDefinition(type);
  const size = definition.defaultSize;
  const centre = options.viewportCentre ?? { x: DESIGN_WIDTH / 2, y: 200 };
  const geometry: Geometry = constrainGeometry({
    x: centre.x - size.width / 2,
    y: centre.y - size.height / 2,
    width: size.width,
    height: size.height,
    rotation: 0,
  });

  return {
    id: createId(),
    // Left empty on purpose: every surface falls back to the block's translated name, so an
    // untouched element reads correctly in both locales instead of carrying an English literal.
    name: "",
    geometry,
    responsiveLayout: baseLayout(size.width, size.height),
    zIndex: nextZIndex(options.section),
    locked: false,
    hidden: false,
    type,
    version: definition.schemaVersion,
    ...definition.defaults(),
  } as BuilderElement;
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

/**
 * Where an element lands.
 *
 * One shape for creating and for moving, because "put this here" is the same question whether the
 * element is new or already exists — and a second shape would be a second set of rules to keep in
 * agreement about depth, ordering and which section owns what.
 */
export type InsertionTarget = {
  sectionId: string;
  /** Inside this container rather than directly in the section. */
  containerId?: string;
  /** Position among its new siblings. Appended when absent. */
  index?: number;
  /** Canvas coordinates, for a drop into a free section. */
  at?: { x: number; y: number };
};

function insertAt(elements: readonly BuilderElement[], element: BuilderElement, index?: number): BuilderElement[] {
  const next = [...elements];
  next.splice(index === undefined ? next.length : Math.max(0, Math.min(index, next.length)), 0, element);
  return next;
}

/** True when this container can still take another level of nesting. */
export function canAcceptChild(parent: BuilderElement): boolean {
  return parent.type === "container" && elementDepth(parent) < MAX_CONTAINER_DEPTH;
}

/** Places an element at a target, returning null when the target refuses it. */
function placeInto(
  document: BuilderDocumentInput,
  pageId: string,
  target: InsertionTarget,
  build: (section: BuilderSection) => BuilderElement,
): { document: BuilderDocumentInput; elementId: string | null } {
  let elementId: string | null = null;
  let refused = false;

  const next = mapPage(document, pageId, (page) =>
    mapSection(page, target.sectionId, (section) => {
      const element = build(section);

      if (target.containerId === undefined) {
        elementId = element.id;
        return { ...section, elements: insertAt(section.elements, element, target.index) };
      }

      const children = mapElements(section.elements, target.containerId, (parent) => {
        // Depth is a document invariant, not a UI hint: a rejected drop must leave the document
        // byte-identical, so the refusal happens here rather than in whichever surface asked.
        if (parent.type !== "container" || (element.type === "container" && !canAcceptChild(parent))) {
          refused = true;
          return parent;
        }
        elementId = element.id;
        return { ...parent, children: insertAt(parent.children, element, target.index) };
      });

      return { ...section, elements: children };
    }),
  );

  return refused || elementId === null ? { document, elementId: null } : { document: next, elementId };
}

/** Creates one element at a target. */
export function insertElement(
  document: BuilderDocumentInput,
  pageId: string,
  type: ElementType,
  target: InsertionTarget,
): { document: BuilderDocumentInput; elementId: string | null } {
  return placeInto(document, pageId, target, (section) =>
    createElement(type, { section, ...(target.at ? { viewportCentre: target.at } : {}) }),
  );
}

export function addElement(
  document: BuilderDocumentInput,
  location: { pageId: string; sectionId: string },
  type: ElementType,
  viewportCentre?: { x: number; y: number },
): { document: BuilderDocumentInput; elementId: string | null } {
  return insertElement(document, location.pageId, type, {
    sectionId: location.sectionId,
    ...(viewportCentre ? { at: viewportCentre } : {}),
  });
}

/**
 * Moves an existing element to another place in the same page.
 *
 * Refuses the two moves that would corrupt the tree — into itself, and into one of its own
 * descendants — by returning the document unchanged, so a caller has nothing to undo.
 */
export function moveElementTo(
  document: BuilderDocumentInput,
  pageId: string,
  elementId: string,
  target: InsertionTarget,
): BuilderDocumentInput {
  const source = findElement(document, elementId);
  if (source === null) return document;
  if (target.containerId === elementId) return document;
  if (target.containerId !== undefined && searchElements([source], target.containerId) !== null) return document;

  // A drop onto a free section names a coordinate; carrying the old one over would land the element
  // wherever it happened to be in the section it came from.
  const moved =
    target.at === undefined
      ? source
      : {
          ...source,
          geometry: constrainGeometry({
            ...source.geometry,
            x: target.at.x - source.geometry.width / 2,
            y: target.at.y - source.geometry.height / 2,
          }),
        };

  const detached = deleteElement(document, elementId);
  const { document: next, elementId: placed } = placeInto(detached, pageId, target, () => moved);
  return placed === null ? document : next;
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
