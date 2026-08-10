import { describe, expect, it } from "vitest";

import { isInspector, resolvePanelView } from "./panelMachine";

describe("resolvePanelView", () => {
  it("shows the chosen mode when nothing is selected", () => {
    expect(resolvePanelView({ panelMode: "layers", selection: null })).toEqual({ kind: "layers" });
    expect(resolvePanelView({ panelMode: "elements", selection: null })).toEqual({ kind: "elements" });
  });

  it("raises the element inspector as soon as an element is selected", () => {
    expect(resolvePanelView({ panelMode: "pages", selection: { kind: "element", elementId: "e1" } })).toEqual({
      kind: "elementInspector",
      elementId: "e1",
    });
  });

  it("raises the section inspector for a selected section", () => {
    expect(resolvePanelView({ panelMode: "pages", selection: { kind: "section", sectionId: "s1" } })).toEqual({
      kind: "sectionInspector",
      sectionId: "s1",
    });
  });

  it("replaces one inspector with another without passing through a non-inspector mode", () => {
    const first = resolvePanelView({ panelMode: "pages", selection: { kind: "element", elementId: "e1" } });
    const second = resolvePanelView({ panelMode: "pages", selection: { kind: "element", elementId: "e2" } });

    expect(isInspector(first)).toBe(true);
    expect(isInspector(second)).toBe(true);
    expect(second).toEqual({ kind: "elementInspector", elementId: "e2" });
  });

  it("returns to the remembered mode when the selection is cleared", () => {
    expect(resolvePanelView({ panelMode: "layers", selection: null })).toEqual({ kind: "layers" });
  });
});
