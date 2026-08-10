import { createProjectDocument, readGridLayout, type BuilderProject } from "@websitebuilder/shared";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorShell } from "@/features/editor/EditorShell";
import { cancelPendingAutosave, useEditorStore } from "@/features/editor/store/editorStore";
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
    ui: { currentPageId: null, selection: null, lastPanelMode: "pages", panelMode: "pages", zoom: 1, editingWidth: 1440 },
    clipboard: null,
  });
});

afterEach(() => {
  cancelPendingAutosave();
  vi.unstubAllGlobals();
});

function setupSection(withElements = 0) {
  useEditorStore.getState().loadFromProject(project());
  const sectionId = useEditorStore.getState().history.present.pages[0]?.sections[0]?.id;
  if (!sectionId) throw new Error("fixture is missing its section");

  for (let index = 0; index < withElements; index += 1) {
    act(() => useEditorStore.getState().addElement(sectionId, "text"));
  }
  act(() => useEditorStore.getState().select({ kind: "section", sectionId }));

  renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />);
  return sectionId;
}

const currentSection = (id: string) =>
  useEditorStore.getState().history.present.pages[0]?.sections.find((section) => section.id === id);

describe("section inspector", () => {
  it("converts an empty section immediately, with no warning to dismiss", async () => {
    const user = userEvent.setup();
    const id = setupSection(0);

    await user.selectOptions(screen.getByLabelText("Layout mode"), "grid");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(currentSection(id)?.layoutMode).toBe("grid");
  });

  it("warns before converting a populated section and states how much is affected", async () => {
    const user = userEvent.setup();
    const id = setupSection(3);

    await user.selectOptions(screen.getByLabelText("Layout mode"), "grid");
    const dialog = screen.getByRole("dialog", { name: "Change this section's layout?" });
    expect(within(dialog).getByText(/3 element\(s\) placed freely/)).toBeInTheDocument();
    expect(currentSection(id)?.layoutMode).toBe("free");

    await user.click(within(dialog).getByRole("button", { name: "Change layout" }));
    expect(currentSection(id)?.layoutMode).toBe("grid");
    expect(currentSection(id)?.elements).toHaveLength(3);
  });

  it("leaves the section untouched when the warning is cancelled", async () => {
    const user = userEvent.setup();
    const id = setupSection(2);

    await user.selectOptions(screen.getByLabelText("Layout mode"), "flex");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(currentSection(id)?.layoutMode).toBe("free");
  });

  it("shows grid controls only for a grid section", async () => {
    const user = userEvent.setup();
    setupSection(0);

    expect(screen.queryByLabelText("Minimum column width")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Layout mode"), "grid");
    expect(screen.getByLabelText("Minimum column width")).toBeInTheDocument();
    expect(screen.queryByLabelText("Direction")).toBeNull();
  });

  it("shows flex controls only for a flex section", async () => {
    const user = userEvent.setup();
    setupSection(0);

    await user.selectOptions(screen.getByLabelText("Layout mode"), "flex");
    expect(screen.getByLabelText("Direction")).toBeInTheDocument();
    expect(screen.queryByLabelText("Minimum column width")).toBeNull();
  });

  it("stores grid settings as typed fields under the breakpoint", async () => {
    const user = userEvent.setup();
    const id = setupSection(0);

    await user.selectOptions(screen.getByLabelText("Layout mode"), "grid");
    await user.click(screen.getByLabelText("Adapt columns automatically"));
    await user.clear(screen.getByLabelText("Columns"));
    await user.type(screen.getByLabelText("Columns"), "4");

    const stored = readGridLayout(currentSection(id)?.layoutByBreakpoint.desktop);
    expect(stored.autoFit).toBe(false);
    expect(stored.columns).toBe(4);
  });

  it("keeps layout changes scoped to the section being edited", async () => {
    const user = userEvent.setup();
    const first = setupSection(0);
    act(() => useEditorStore.getState().addSection("free"));
    const second = useEditorStore.getState().history.present.pages[0]?.sections[1]?.id;

    act(() => useEditorStore.getState().select({ kind: "section", sectionId: first }));
    await user.selectOptions(screen.getByLabelText("Layout mode"), "grid");

    expect(currentSection(first)?.layoutMode).toBe("grid");
    expect(second && currentSection(second)?.layoutMode).toBe("free");
  });

  it("labels the section inspector in Portuguese", () => {
    useEditorStore.getState().loadFromProject(project());
    const sectionId = useEditorStore.getState().history.present.pages[0]?.sections[0]?.id;
    if (!sectionId) throw new Error("fixture is missing its section");
    act(() => useEditorStore.getState().select({ kind: "section", sectionId }));

    renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />, { locale: "pt-BR" });
    expect(screen.getByLabelText("Modo de layout")).toBeInTheDocument();
  });
});
