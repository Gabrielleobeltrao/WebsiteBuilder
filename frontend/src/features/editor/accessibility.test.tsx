import { createProjectDocument, type BuilderProject } from "@websitebuilder/shared";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorShell } from "@/features/editor/EditorShell";
import { cancelPendingAutosave, useEditorStore } from "@/features/editor/store/editorStore";
import { createHistory } from "@/features/editor/store/history";
import { renderWithProviders } from "@/test/render";

/**
 * The builder, operated without a pointer.
 *
 * Every control this plan added is checked here for the two things that decide whether it is usable
 * at all: it has a name a screen reader can announce, and it can be reached and activated from the
 * keyboard. Drag and drop is the case that matters most — it is inherently a pointer gesture, so
 * every placement it performs has to be reachable another way, or the feature is available only to
 * people who can drag.
 */

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
  vi.stubGlobal("innerWidth", 1440);
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
    ui: { currentPageId: null, selection: null, lastPanelMode: "pages", panelMode: "pages", panelIntent: "destination", zoom: 1, editingWidth: 1440 },
    clipboard: null,
  });
});

afterEach(() => {
  cancelPendingAutosave();
  vi.unstubAllGlobals();
});

const render = () => {
  useEditorStore.getState().loadFromProject(project());
  return renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />);
};

const firstSection = () => useEditorStore.getState().history.present.pages[0]!.sections[0]!;

describe("names and states are announced, not implied by an icon", () => {
  it("gives every icon-only control an accessible name", () => {
    render();

    for (const control of [
      ...screen.getAllByRole("tab"),
      ...screen.getAllByRole("button"),
      ...screen.getAllByRole("link"),
    ]) {
      const name = control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "";
      expect(name, control.outerHTML.slice(0, 120)).not.toBe("");
    }
  });

  it("marks the current device and the current destination as pressed and selected", async () => {
    const user = userEvent.setup();
    render();

    await user.click(screen.getByRole("button", { name: /^Mobile/ }));
    expect(screen.getByRole("button", { name: /^Mobile/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Desktop/ })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("tab", { name: "Structure" }));
    expect(screen.getByRole("tab", { name: "Structure" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Pages" })).toHaveAttribute("aria-selected", "false");
  });

  it("names the regions a person navigates between", () => {
    render();

    expect(screen.getByRole("complementary", { name: "Builder controls" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Builder destinations" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Device" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Page canvas" })).toBeInTheDocument();
  });
});

describe("everything a drag can do, the keyboard can do", () => {
  it("adds an element to the selected section with Enter", async () => {
    const user = userEvent.setup();
    render();

    act(() => useEditorStore.getState().select({ kind: "section", sectionId: firstSection().id }));
    await user.click(screen.getByRole("tab", { name: "Add elements" }));

    // Reached by keyboard, activated by keyboard: the library item is a button, not a drag handle
    // with a click listener bolted on.
    const text = screen.getByRole("button", { name: "Text" });
    text.focus();
    await user.keyboard("{Enter}");

    expect(firstSection().elements).toHaveLength(1);
  });

  it("reorders without a pointer, and says which direction each control moves", async () => {
    const user = userEvent.setup();
    render();
    act(() => useEditorStore.getState().addElement(firstSection().id, "text"));
    act(() => useEditorStore.getState().addElement(firstSection().id, "button"));

    await user.click(screen.getByRole("tab", { name: "Structure" }));
    const tree = screen.getByRole("navigation", { name: "Page structure" });

    const up = within(tree).getAllByRole("button", { name: "Move up" })[0]!;
    up.focus();
    await user.keyboard("{Enter}");

    expect(firstSection().elements.map((element) => element.type)).toEqual(["button", "text"]);
  });

  it("creates a section of a chosen layout from the canvas by keyboard", async () => {
    const user = userEvent.setup();
    render();

    const add = screen.getAllByRole("button", { name: "Add a Grid section here" })[0]!;
    add.focus();
    await user.keyboard("{Enter}");

    expect(useEditorStore.getState().history.present.pages[0]!.sections[0]?.layoutMode).toBe("grid");
  });
});

describe("the inspector is reachable and its tabs are real tabs", () => {
  it("opens on selection and moves between tabs from the keyboard", async () => {
    const user = userEvent.setup();
    render();
    act(() => useEditorStore.getState().addElement(firstSection().id, "text"));

    const tabs = screen.getByRole("tablist", { name: "Element settings" });
    const style = within(tabs).getByRole("tab", { name: "Style" });
    style.focus();
    await user.keyboard("{Enter}");

    expect(style).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Font size")).toBeInTheDocument();
  });

  it("returns to the last destination from the inspector's own Back", async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole("tab", { name: "Structure" }));
    act(() => useEditorStore.getState().addElement(firstSection().id, "text"));

    const back = screen.getByRole("button", { name: "Back" });
    back.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("heading", { level: 2, name: "Structure" })).toBeInTheDocument();
  });
});

describe("dialogs", () => {
  it("names the conflict dialog and describes what reloading costs", () => {
    render();
    act(() => useEditorStore.setState({ persistence: { status: "conflict", currentRevision: 9 } }));

    const dialog = screen.getByRole("dialog", { name: "This site changed somewhere else" });
    expect(within(dialog).getByText(/discards the changes you made here/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Reload the newest version" })).toBeInTheDocument();
  });
});
