import { createProjectDocument, resolveLayoutAt, type BuilderProject } from "@websitebuilder/shared";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorShell } from "@/features/editor/EditorShell";
import { cancelPendingAutosave, useEditorStore } from "@/features/editor/store/editorStore";
import { findElement } from "@/features/editor/store/elements";
import { createHistory } from "@/features/editor/store/history";
import { renderWithProviders } from "@/test/render";

const project = (): BuilderProject => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceId: "w1",
  createdByUserId: "u1",
  revision: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...createProjectDocument({ name: "Acme", slug: "acme" }),
});

beforeEach(() => {
  cancelPendingAutosave();
  vi.stubGlobal("innerWidth", 1600);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("pointer: fine"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in this test"))));
  useEditorStore.setState({
    loadStatus: "idle",
    history: createHistory(createProjectDocument({ name: "", slug: "empty-site" })),
    persistence: { status: "clean" },
    ui: { currentPageId: null, selection: null, lastPanelMode: "pages", panelMode: "pages", panelIntent: "destination", zoom: 1, zoomChosen: false, editingWidth: 1440 },
    clipboard: null,
  });
});

afterEach(() => {
  cancelPendingAutosave();
  vi.unstubAllGlobals();
});

function setup() {
  useEditorStore.getState().loadFromProject(project());
  const sectionId = useEditorStore.getState().history.present.pages[0]?.sections[0]?.id;
  if (!sectionId) throw new Error("fixture is missing its section");
  act(() => useEditorStore.getState().addElement(sectionId, "text"));

  const selection = useEditorStore.getState().ui.selection;
  if (selection?.kind !== "element") throw new Error("adding an element should select it");

  renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />);
  return selection.elementId;
}

describe("the device switcher", () => {
  it("offers exactly three devices and nothing else", () => {
    setup();
    const group = screen.getByRole("group", { name: "Device" });

    // Three, and only three. The slider, the numeric width and the breakpoint badge are gone: the
    // continuum was honest about the problem and useless as a control, because it asked an author
    // which of sixteen hundred widths to design for.
    expect(within(group).getAllByRole("button")).toHaveLength(3);

    // Scoped to the top bar: the inspector still has a width field, because an element's own width
    // is a property somebody edits. What is gone is the canvas width, which was never one.
    const header = screen.getByRole("banner");
    expect(within(header).queryByRole("slider")).toBeNull();
    expect(within(header).queryByRole("spinbutton")).toBeNull();
  });

  it("announces which device is being authored", async () => {
    const user = userEvent.setup();
    setup();
    const group = screen.getByRole("group", { name: "Device" });

    // Which device is selected decides where every following edit lands, so it is announced rather
    // than only highlighted.
    expect(within(group).getByRole("button", { name: /Desktop/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(group).getByRole("button", { name: /Mobile/ }));
    expect(within(group).getByRole("button", { name: /Mobile/ })).toHaveAttribute("aria-pressed", "true");
    expect(useEditorStore.getState().ui.editingWidth).toBe(390);
  });

  it("renders each device at its own reference width", async () => {
    const user = userEvent.setup();
    setup();
    const group = screen.getByRole("group", { name: "Device" });

    await user.click(within(group).getByRole("button", { name: /Tablet/ }));
    expect(useEditorStore.getState().ui.editingWidth).toBe(768);
  });

  it("changing device never touches the document or history", () => {
    setup();
    const before = useEditorStore.getState().history;

    act(() => useEditorStore.getState().setEditingDevice("mobile"));
    expect(useEditorStore.getState().history).toEqual(before);
  });

  it("still clamps a width set programmatically", () => {
    setup();
    act(() => useEditorStore.getState().setEditingWidth(99));
    expect(useEditorStore.getState().ui.editingWidth).toBe(320);
    act(() => useEditorStore.getState().setEditingWidth(9999));
    expect(useEditorStore.getState().ui.editingWidth).toBe(1920);
  });
});

describe("breakpoint overrides", () => {
  it("stores an override under the breakpoint without changing the base value", () => {
    const id = setup();
    const before = findElement(useEditorStore.getState().history.present, id);

    act(() => useEditorStore.getState().setBreakpointOverride(id, "mobile", "geometry", { x: 8 }));

    const after = findElement(useEditorStore.getState().history.present, id);
    expect(after?.geometry.x).toBe(before?.geometry.x);
    expect(after?.breakpointOverrides?.mobile?.geometry?.x).toBe(8);
  });

  it("applies the override only at widths the breakpoint covers", () => {
    const id = setup();
    act(() => useEditorStore.getState().setBreakpointOverride(id, "mobile", "geometry", { x: 8 }));

    const element = findElement(useEditorStore.getState().history.present, id);
    if (!element) throw new Error("element vanished");
    const breakpoints = useEditorStore.getState().history.present.breakpoints;

    const atMobile = resolveLayoutAt({
      width: 390,
      base: element.responsiveLayout,
      geometry: element.geometry,
      breakpoints,
      overrides: element.breakpointOverrides,
    });
    const atDesktop = resolveLayoutAt({
      width: 1440,
      base: element.responsiveLayout,
      geometry: element.geometry,
      breakpoints,
      overrides: element.breakpointOverrides,
    });

    expect(atMobile.geometry.x).toBe(8);
    expect(atDesktop.geometry.x).toBe(element.geometry.x);
  });

  it("clearing an override restores inheritance and leaves no empty record behind", () => {
    const id = setup();
    act(() => useEditorStore.getState().setBreakpointOverride(id, "mobile", "geometry", { x: 8 }));
    act(() => useEditorStore.getState().clearBreakpointOverride(id, "mobile", "geometry", "x"));

    const element = findElement(useEditorStore.getState().history.present, id);
    expect(element?.breakpointOverrides?.mobile).toBeUndefined();
  });

  it("editing one breakpoint never mutates another", () => {
    const id = setup();
    act(() => useEditorStore.getState().setBreakpointOverride(id, "tablet", "geometry", { x: 40 }));
    act(() => useEditorStore.getState().setBreakpointOverride(id, "mobile", "geometry", { x: 8 }));

    const element = findElement(useEditorStore.getState().history.present, id);
    expect(element?.breakpointOverrides?.tablet?.geometry?.x).toBe(40);
    expect(element?.breakpointOverrides?.mobile?.geometry?.x).toBe(8);
  });
});
