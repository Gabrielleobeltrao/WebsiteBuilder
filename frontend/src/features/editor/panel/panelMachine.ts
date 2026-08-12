import type { InspectorTarget, PanelMode } from "@/features/editor/store/editorStore";

/**
 * The right builder panel is one fixed region with mutually exclusive modes. Modelling it as an
 * explicit machine — rather than a pile of booleans read by the component — is what guarantees the
 * two properties users actually notice: the canvas never moves when the panel content changes, and
 * deselecting always returns to the mode they last opened on purpose.
 */
export type PanelView =
  | { kind: "pages" }
  | { kind: "elements" }
  | { kind: "layers" }
  | { kind: "pageSettings" }
  | { kind: "siteSettings" }
  | { kind: "sectionInspector"; sectionId: string }
  | { kind: "elementInspector"; elementId: string };

export function resolvePanelView(input: { panelMode: PanelMode; selection: InspectorTarget | null }): PanelView {
  if (input.selection?.kind === "element") {
    return { kind: "elementInspector", elementId: input.selection.elementId };
  }
  if (input.selection?.kind === "section") {
    return { kind: "sectionInspector", sectionId: input.selection.sectionId };
  }
  return { kind: input.panelMode };
}

export function isInspector(view: PanelView): boolean {
  return view.kind === "sectionInspector" || view.kind === "elementInspector";
}

/**
 * Destinations a user opens deliberately, and therefore the only ones worth returning to.
 *
 * Five, in the order the rail shows them. Page SEO is not among them: it is page settings, and
 * making it a sixth peer meant an author had to know the product's internal split to find the title
 * of the page they were editing.
 */
export const NON_INSPECTOR_MODES: PanelMode[] = [
  "elements",
  "pages",
  "layers",
  "pageSettings",
  "siteSettings",
];
