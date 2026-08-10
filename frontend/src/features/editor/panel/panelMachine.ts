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

/** Modes a user can open deliberately, and therefore the only ones worth returning to. */
export const NON_INSPECTOR_MODES: PanelMode[] = ["pages", "elements", "layers", "pageSettings"];
