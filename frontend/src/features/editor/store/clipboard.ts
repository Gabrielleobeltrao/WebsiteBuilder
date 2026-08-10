import { createId, type BuilderDocumentInput, type BuilderElement } from "@websitebuilder/shared";

import { constrainGeometry } from "@/features/editor/canvas/coordinates";
import { deleteElement, findElement } from "./elements";

/**
 * Copy, cut and paste.
 *
 * The clipboard is in-app state rather than the system clipboard, because browser clipboard
 * permission is not always available and an editor that silently stops copying is worse than one
 * that never used the system clipboard at all. Pasted trees get fresh IDs recursively, so a paste
 * can never introduce two nodes sharing an identifier.
 */
export type ClipboardState = { element: BuilderElement } | null;

export function copyElement(document: BuilderDocumentInput, elementId: string): ClipboardState {
  const element = findElement(document, elementId);
  return element === null ? null : { element: structuredClone(element) };
}

export function cutElement(
  document: BuilderDocumentInput,
  elementId: string,
): { document: BuilderDocumentInput; clipboard: ClipboardState } {
  const clipboard = copyElement(document, elementId);
  if (clipboard === null) return { document, clipboard: null };
  return { document: deleteElement(document, elementId), clipboard };
}

function regenerateIds(element: BuilderElement): BuilderElement {
  const next = { ...element, id: createId() };
  if (next.type === "container") return { ...next, children: next.children.map(regenerateIds) };
  return next;
}

/**
 * Pastes into a target section, offsetting the copy so it does not hide the original exactly.
 * Returns the new element ID so the caller can select what it just created.
 */
export function pasteElement(
  document: BuilderDocumentInput,
  clipboard: ClipboardState,
  target: { pageId: string; sectionId: string },
  offset = 16,
): { document: BuilderDocumentInput; elementId: string | null } {
  if (clipboard === null) return { document, elementId: null };

  const copy = regenerateIds(structuredClone(clipboard.element));
  copy.geometry = constrainGeometry({
    ...copy.geometry,
    x: copy.geometry.x + offset,
    y: copy.geometry.y + offset,
  });

  let pasted = false;
  const next: BuilderDocumentInput = {
    ...document,
    pages: document.pages.map((page) => {
      if (page.id !== target.pageId) return page;
      return {
        ...page,
        sections: page.sections.map((section) => {
          if (section.id !== target.sectionId) return section;
          pasted = true;
          const highest = section.elements.reduce((max, element) => Math.max(max, element.zIndex), 0);
          return { ...section, elements: [...section.elements, { ...copy, zIndex: highest + 1 }] };
        }),
      };
    }),
  };

  return pasted ? { document: next, elementId: copy.id } : { document, elementId: null };
}

/** Every ID in a tree, used to prove a paste introduced no duplicates. */
export function collectIds(element: BuilderElement): string[] {
  if (element.type !== "container") return [element.id];
  return [element.id, ...element.children.flatMap(collectIds)];
}
