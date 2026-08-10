import { createProjectDocument, type BuilderProject } from "@websitebuilder/shared";
import { act, screen } from "@testing-library/react";
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
    ui: { currentPageId: null, selection: null, lastPanelMode: "pages", panelMode: "pages", zoom: 1 },
  });
});

afterEach(() => {
  cancelPendingAutosave();
  vi.unstubAllGlobals();
});

function setup(type: "text" | "button" = "text") {
  useEditorStore.getState().loadFromProject(project());
  const sectionId = useEditorStore.getState().history.present.pages[0]?.sections[0]?.id;
  if (!sectionId) throw new Error("fixture is missing its section");
  act(() => useEditorStore.getState().addElement(sectionId, type));

  const selection = useEditorStore.getState().ui.selection;
  if (selection?.kind !== "element") throw new Error("adding an element should select it");

  renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />);
  return selection.elementId;
}

const elementCount = () =>
  useEditorStore.getState().history.present.pages.flatMap((page) => page.sections.flatMap((s) => s.elements)).length;

describe("canvas shortcuts", () => {
  it("deletes the selection with Delete", async () => {
    const user = userEvent.setup();
    const id = setup();
    await user.keyboard("{Delete}");

    expect(findElement(useEditorStore.getState().history.present, id)).toBeNull();
    expect(useEditorStore.getState().ui.selection).toBeNull();
  });

  it("duplicates the selection with the platform modifier and D", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("{Control>}d{/Control}");
    expect(elementCount()).toBe(2);
  });

  it("undoes and redoes", async () => {
    const user = userEvent.setup();
    setup();
    expect(elementCount()).toBe(1);

    await user.keyboard("{Control>}z{/Control}");
    expect(elementCount()).toBe(0);

    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(elementCount()).toBe(1);
  });

  it("clears the selection with Escape", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("{Escape}");
    expect(useEditorStore.getState().ui.selection).toBeNull();
  });
});

describe("editable-target guard", () => {
  it("does not delete the element while the user is backspacing in a field", async () => {
    const user = userEvent.setup();
    const id = setup();

    const field = screen.getByLabelText("Content");
    await user.click(field);
    await user.keyboard("{Backspace}{Backspace}{Backspace}");

    expect(findElement(useEditorStore.getState().history.present, id)).not.toBeNull();
  });

  it("does not hijack undo while typing in a field", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByLabelText("Content"));
    await user.keyboard("{Control>}z{/Control}");

    // The element is still there: the chord belonged to the input, not to the canvas.
    expect(elementCount()).toBe(1);
  });

  it("does not duplicate while typing in a field", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByLabelText("Content"));
    await user.keyboard("{Control>}d{/Control}");
    expect(elementCount()).toBe(1);
  });
});

describe("save shortcut", () => {
  it("saves even from inside a field, because that is what the chord means everywhere", async () => {
    const saved = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", saved);

    const user = userEvent.setup();
    setup();
    await user.click(screen.getByLabelText("Content"));
    await user.keyboard("{Control>}s{/Control}");

    expect(saved).toHaveBeenCalled();
  });
});

describe("clipboard shortcuts", () => {
  it("copies and pastes an element with a new id", async () => {
    const user = userEvent.setup();
    const id = setup();

    await user.keyboard("{Control>}c{/Control}");
    await user.keyboard("{Control>}v{/Control}");

    expect(elementCount()).toBe(2);
    const selection = useEditorStore.getState().ui.selection;
    expect(selection?.kind === "element" && selection.elementId).not.toBe(id);
  });

  it("cuts the element and restores it on paste", async () => {
    const user = userEvent.setup();
    const id = setup();

    await user.keyboard("{Control>}x{/Control}");
    expect(findElement(useEditorStore.getState().history.present, id)).toBeNull();
    expect(elementCount()).toBe(0);

    await user.keyboard("{Control>}v{/Control}");
    expect(elementCount()).toBe(1);
  });

  it("works without system clipboard permission, because the clipboard is in-app state", async () => {
    const user = userEvent.setup();
    setup();
    // No navigator.clipboard is stubbed: the shortcuts must not depend on it.
    await user.keyboard("{Control>}c{/Control}");
    await user.keyboard("{Control>}v{/Control}");
    expect(elementCount()).toBe(2);
  });

  it("does not copy or paste while typing in a field", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByLabelText("Content"));
    await user.keyboard("{Control>}c{/Control}");
    await user.keyboard("{Control>}v{/Control}");
    expect(elementCount()).toBe(1);
  });
});
