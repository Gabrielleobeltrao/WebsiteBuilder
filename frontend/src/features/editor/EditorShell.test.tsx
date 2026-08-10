import { createProjectDocument, type BuilderProject } from "@websitebuilder/shared";
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
  ...createProjectDocument({ name: "Acme Studio", slug: "acme-studio" }),
});

/** Desktop-class by default: a fine pointer and a wide enough window. */
function setViewport(width: number, pointer: "fine" | "coarse" = "fine") {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("pointer: fine") ? pointer === "fine" : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

beforeEach(() => {
  cancelPendingAutosave();
  setViewport(1440);
  useEditorStore.setState({
    projectId: null,
    workspaceId: null,
    revision: 0,
    loadStatus: "idle",
    loadErrorCode: null,
    history: createHistory(createProjectDocument({ name: "", slug: "empty-site" })),
    persistence: { status: "clean" },
    ui: { currentPageId: null, selection: null, lastPanelMode: "pages", panelMode: "pages", zoom: 1 },
  });
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in this test"))));
});

afterEach(() => {
  cancelPendingAutosave();
  vi.unstubAllGlobals();
});

const render = () => renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />);

describe("EditorShell layout", () => {
  it("keeps the canvas in the centre and builder controls on the right", () => {
    useEditorStore.getState().loadFromProject(project());
    render();

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Builder controls" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Page canvas" })).toBeInTheDocument();
  });

  it("does not create a second builder-specific left sidebar", () => {
    useEditorStore.getState().loadFromProject(project());
    render();
    expect(screen.getAllByRole("complementary")).toHaveLength(1);
  });

  it("shows a loading state before the project arrives", () => {
    render();
    expect(screen.getByRole("status")).toHaveTextContent("Loading the site…");
  });

  it("shows a localized message when the project fails to load", () => {
    useEditorStore.setState({ loadStatus: "error", loadErrorCode: "NOT_FOUND" });
    render();
    expect(within(screen.getByRole("alert")).getByText(/could not find/i)).toBeInTheDocument();
  });
});

describe("right panel state machine", () => {
  it("switches modes without losing the canvas", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();

    await user.click(screen.getByRole("tab", { name: "Layers" }));
    expect(screen.getByRole("tab", { name: "Layers" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("group", { name: "Page canvas" })).toBeInTheDocument();
  });

  it("replaces the panel with the section inspector when a section is selected", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();

    await user.click(screen.getByRole("region", { name: "Section" }));

    expect(screen.queryByRole("tab", { name: "Pages" })).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Responsive" })).toBeInTheDocument();
  });

  it("returns to the remembered mode when Back is pressed", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();

    await user.click(screen.getByRole("tab", { name: "Layers" }));
    await user.click(screen.getByRole("region", { name: "Section" }));
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("tab", { name: "Layers" })).toHaveAttribute("aria-selected", "true");
  });

  it("organises every inspector into the same five groups", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();

    await user.click(screen.getByRole("region", { name: "Section" }));
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Content",
      "Style",
      "Layout",
      "Responsive",
      "Advanced",
    ]);
  });
});

describe("pages panel", () => {
  it("adds a page and refuses to delete the last one", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();

    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Add page" }));
    const dialog = screen.getByRole("dialog", { name: "Name the page" });
    await user.type(within(dialog).getByLabelText("Page name"), "About");
    await user.click(within(dialog).getByRole("button", { name: "Add page" }));

    expect(useEditorStore.getState().history.present.pages).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete" })[0]).toBeEnabled();
  });
});

describe("save state", () => {
  it("reports unsaved changes and enables undo after an edit", async () => {
    useEditorStore.getState().loadFromProject(project());
    render();

    expect(screen.getByRole("status")).toHaveTextContent("All changes saved");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

    act(() => useEditorStore.getState().addPage("About"));
    expect(await screen.findByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("blocks editing behind a dialog when the document changed elsewhere", async () => {
    useEditorStore.getState().loadFromProject(project());
    useEditorStore.setState({ persistence: { status: "conflict", currentRevision: 9 } });
    render();

    expect(screen.getByRole("dialog", { name: "This site changed somewhere else" })).toBeInTheDocument();
    expect(screen.getByText(/discards the changes you made here/i)).toBeInTheDocument();
  });
});

describe("authoring gate", () => {
  it("offers preview only on a touch device, mounting no canvas or panel", () => {
    setViewport(1440, "coarse");
    useEditorStore.getState().loadFromProject(project());
    render();

    expect(screen.getByRole("heading", { level: 1, name: "Continue editing on a computer" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Page canvas" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Builder controls" })).toBeNull();
    expect(screen.getByRole("link", { name: "Mobile preview" })).toBeInTheDocument();
  });

  it("pauses editing without losing state when the window is too narrow", () => {
    setViewport(800);
    useEditorStore.getState().loadFromProject(project());
    useEditorStore.getState().addPage("About");
    render();

    expect(
      screen.getByRole("heading", { level: 1, name: "Increase your window size to continue editing" }),
    ).toBeInTheDocument();
    // The document is untouched: the gate pauses interaction, it does not discard work.
    expect(useEditorStore.getState().history.present.pages).toHaveLength(2);
    expect(useEditorStore.getState().persistence.status).toBe("dirty");
  });
});

describe("localization", () => {
  it("renders the builder in Portuguese", () => {
    useEditorStore.getState().loadFromProject(project());
    renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />, { locale: "pt-BR" });

    expect(screen.getByRole("tab", { name: "Páginas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Todas as alterações salvas");
  });
});
