import { createProjectDocument } from "@websitebuilder/shared";
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { cancelPendingAutosave, useEditorStore } from "@/features/editor/store/editorStore";
import { createHistory } from "@/features/editor/store/history";
import { findElement } from "@/features/editor/store/elements";

/**
 * Editing one device must not move an element on another.
 *
 * This is the property the device switcher promises. Before it existed, dragging while a narrow
 * canvas was selected wrote the base geometry — so an author "fixed" their phone layout and broke
 * their desktop one, and nothing told them until somebody opened the site on a laptop.
 */

const document = () => useEditorStore.getState().history.present;
const section = () => document().pages[0]!.sections[0]!;

function addElement() {
  act(() => useEditorStore.getState().addElement(section().id, "button"));
  const selection = useEditorStore.getState().ui.selection;
  if (selection?.kind !== "element") throw new Error("adding an element should select it");
  return selection.elementId;
}

const geometryOf = (id: string) => findElement(document(), id)!.geometry;
const overridesOf = (id: string) => findElement(document(), id)!.breakpointOverrides;

beforeEach(() => {
  cancelPendingAutosave();
  useEditorStore.setState({
    loadStatus: "idle",
    loadErrorCode: null,
    history: createHistory(createProjectDocument({ name: "Acme", slug: "acme" })),
    persistence: { status: "clean" },
    ui: { currentPageId: null, selection: null, lastPanelMode: "pages", panelMode: "pages", panelIntent: "destination", zoom: 1, zoomChosen: false, editingWidth: 1440 },
  });
});

describe("dragging on desktop", () => {
  it("writes the base geometry every other device inherits", () => {
    const id = addElement();

    act(() => useEditorStore.getState().moveElement(id, { ...geometryOf(id), x: 500 }));

    expect(geometryOf(id).x).toBe(500);
    expect(overridesOf(id)).toBeUndefined();
  });
});

describe("dragging on a narrow device", () => {
  it("writes that device's override and leaves the base alone", () => {
    const id = addElement();
    const before = geometryOf(id).x;

    act(() => useEditorStore.getState().setEditingDevice("mobile"));
    act(() => useEditorStore.getState().moveElement(id, { ...geometryOf(id), x: 16 }));

    expect(geometryOf(id).x).toBe(before);
    expect(overridesOf(id)?.["mobile"]?.geometry?.x).toBe(16);
  });

  it("records the canvas the geometry was authored against", () => {
    // Pixels written while looking at a 390px canvas mean something different against 1440. The
    // compiler needs to be told which one, not left to assume.
    const id = addElement();

    act(() => useEditorStore.getState().setEditingDevice("mobile"));
    act(() => useEditorStore.getState().moveElement(id, { ...geometryOf(id), x: 16 }));

    expect(overridesOf(id)?.["mobile"]?.referenceWidth).toBe(390);
  });

  it("keeps tablet and mobile independent of each other", () => {
    const id = addElement();

    act(() => useEditorStore.getState().setEditingDevice("tablet"));
    act(() => useEditorStore.getState().moveElement(id, { ...geometryOf(id), x: 100 }));
    act(() => useEditorStore.getState().setEditingDevice("mobile"));
    act(() => useEditorStore.getState().moveElement(id, { ...geometryOf(id), x: 16 }));

    expect(overridesOf(id)?.["tablet"]?.geometry?.x).toBe(100);
    expect(overridesOf(id)?.["mobile"]?.geometry?.x).toBe(16);
  });

  it("is undoable as one step", () => {
    const id = addElement();
    const before = geometryOf(id).x;

    act(() => useEditorStore.getState().setEditingDevice("mobile"));
    act(() => useEditorStore.getState().moveElement(id, { ...geometryOf(id), x: 16 }));
    act(() => useEditorStore.getState().undo());

    expect(overridesOf(id)?.["mobile"]?.geometry?.x).toBeUndefined();
    expect(geometryOf(id).x).toBe(before);
  });
});

describe("fitting the page to a device", () => {
  /** Puts one element far outside a phone, the way a desktop-authored layout does. */
  function farRight() {
    const id = addElement();
    act(() => useEditorStore.getState().moveElement(id, { x: 1100, y: 40, width: 280, height: 48, rotation: 0 }));
    return id;
  }

  it("brings an escaping element back and leaves desktop alone", () => {
    const id = farRight();

    act(() => useEditorStore.getState().setEditingDevice("mobile"));
    let changed = 0;
    act(() => {
      changed = useEditorStore.getState().autoFitCurrentPage();
    });

    expect(changed).toBe(1);
    expect(geometryOf(id).x).toBe(1100);
    expect(overridesOf(id)?.["mobile"]?.geometry?.x).toBe(16);
  });

  it("is one undo", () => {
    // A repair that takes five presses of undo to reverse is a repair people stop trusting.
    const id = farRight();
    act(() => useEditorStore.getState().setEditingDevice("mobile"));
    act(() => void useEditorStore.getState().autoFitCurrentPage());

    act(() => useEditorStore.getState().undo());

    expect(overridesOf(id)?.["mobile"]).toBeUndefined();
  });

  it("does nothing on desktop", () => {
    farRight();
    let changed = 0;
    act(() => {
      changed = useEditorStore.getState().autoFitCurrentPage();
    });

    expect(changed).toBe(0);
  });

  it("reports zero when everything already fits", () => {
    // Placed where a phone can hold it. A default-placed element does not qualify: the builder
    // drops new elements on a 1440 canvas, and most of those positions are off a 390 screen.
    const id = addElement();
    act(() => useEditorStore.getState().moveElement(id, { x: 16, y: 40, width: 200, height: 48, rotation: 0 }));
    act(() => useEditorStore.getState().setEditingDevice("mobile"));

    let changed = 0;
    act(() => {
      changed = useEditorStore.getState().autoFitCurrentPage();
    });

    expect(changed).toBe(0);
  });
});
