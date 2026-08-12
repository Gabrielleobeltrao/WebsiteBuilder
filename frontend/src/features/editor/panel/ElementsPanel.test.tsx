import { createProjectDocument, MAX_CONTAINER_DEPTH, type BuilderProject } from "@websitebuilder/shared";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorShell } from "@/features/editor/EditorShell";
import { cancelPendingAutosave, useEditorStore } from "@/features/editor/store/editorStore";
import { createHistory } from "@/features/editor/store/history";
import { renderWithProviders } from "@/test/render";

/**
 * The block catalog, as a person uses it.
 *
 * Nineteen blocks is past the point where a grid of icons is something you scan, so what is checked
 * here is the finding: search by either language's word, categories that fold away, the blocks you
 * reached for last, and a row that says why it cannot be used rather than merely refusing.
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
  window.localStorage.clear();
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

async function openCatalog(locale: "en-US" | "pt-BR" = "en-US") {
  useEditorStore.getState().loadFromProject(project());
  renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />, { locale });
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: locale === "pt-BR" ? "Adicionar elementos" : "Add elements" }));
  return user;
}

const panel = () => screen.getByRole("complementary", { name: /Builder controls|Controles do construtor/ });
describe("what the catalog offers", () => {
  it("shows every block, grouped by category", async () => {
    await openCatalog();

    for (const category of ["Layout", "Basic", "Media", "Interactive", "Marketing", "Navigation"]) {
      expect(within(panel()).getByRole("button", { name: category })).toBeInTheDocument();
    }

    // The fourteen schemas that existed in the document but could not be created, plus the four
    // that could, plus the form.
    for (const block of ["Text", "Image", "Gallery", "Video", "FAQ", "Tabs", "Pricing table", "Form"]) {
      expect(within(panel()).getByRole("button", { name: block })).toBeInTheDocument();
    }
  });

  it("folds a category away and back", async () => {
    const user = await openCatalog();
    const media = within(panel()).getByRole("button", { name: "Media" });

    expect(media).toHaveAttribute("aria-expanded", "true");
    await user.click(media);

    expect(media).toHaveAttribute("aria-expanded", "false");
    expect(within(panel()).queryByRole("button", { name: "Gallery" })).toBeNull();

    await user.click(media);
    expect(within(panel()).getByRole("button", { name: "Gallery" })).toBeInTheDocument();
  });
});

describe("searching", () => {
  it("narrows to what was typed", async () => {
    const user = await openCatalog();

    await user.type(screen.getByRole("searchbox", { name: "Search blocks" }), "gall");

    expect(within(panel()).getByRole("button", { name: "Gallery" })).toBeInTheDocument();
    expect(within(panel()).queryByRole("button", { name: "Text" })).toBeNull();
  });

  it("finds a block by a word that is not its name", async () => {
    const user = await openCatalog();

    // "sanfona"/"accordion" is not what anybody calls it; the keyword list is what makes it findable.
    await user.type(screen.getByRole("searchbox", { name: "Search blocks" }), "collapse");
    expect(within(panel()).getByRole("button", { name: "FAQ" })).toBeInTheDocument();
  });

  it("finds a Portuguese word without its accent", async () => {
    const user = await openCatalog("pt-BR");

    await user.type(screen.getByRole("searchbox", { name: "Buscar blocos" }), "botao");
    expect(within(panel()).getByRole("button", { name: "Botão" })).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    const user = await openCatalog();

    await user.type(screen.getByRole("searchbox", { name: "Search blocks" }), "zzzz");
    expect(screen.getByText("No block matches that search.")).toBeInTheDocument();
  });

  it("does not change the canvas selection", async () => {
    const user = await openCatalog();
    const before = useEditorStore.getState().ui.selection;

    await user.type(screen.getByRole("searchbox", { name: "Search blocks" }), "video");
    expect(useEditorStore.getState().ui.selection).toEqual(before);
  });
});

describe("recent and favourites", () => {
  it("remembers the blocks used last, most recent first", async () => {
    const user = await openCatalog();

    await user.click(within(panel()).getByRole("button", { name: "Divider" }));
    await user.click(within(panel()).getByRole("tab", { name: "Add elements" }));
    await user.click(within(panel()).getByRole("button", { name: "Text" }));
    await user.click(within(panel()).getByRole("tab", { name: "Add elements" }));

    const recentHeading = within(panel()).getByText("Recent");
    const list = recentHeading.parentElement?.querySelector("ul");
    expect([...(list?.querySelectorAll("button[draggable]") ?? [])].map((button) => button.textContent?.trim())).toEqual([
      "Text",
      "Divider",
    ]);
  });

  it("keeps a favourite across a reload of the panel", async () => {
    const user = await openCatalog();

    await user.click(within(panel()).getByRole("button", { name: "Add Video to favourites" }));
    await user.click(within(panel()).getByRole("tab", { name: "Pages" }));
    await user.click(within(panel()).getByRole("tab", { name: "Add elements" }));

    // The block appears twice on purpose: pinned at the top and still in its category.
    const favourites = within(panel()).getByText("Favourites").parentElement;
    expect(favourites).not.toBeNull();
    expect(within(favourites!).getByRole("button", { name: "Video" })).toBeInTheDocument();
    expect(within(favourites!).getByRole("button", { name: "Remove Video from favourites" })).toBeInTheDocument();
  });

  it("stores a preference in the browser, never in the document", async () => {
    const user = await openCatalog();
    const before = useEditorStore.getState().history.present;

    await user.click(within(panel()).getByRole("button", { name: "Add Text to favourites" }));

    expect(useEditorStore.getState().history.present).toBe(before);
    expect(window.localStorage.getItem("wb.catalog.favorites")).toContain("text");
  });
});

describe("a block that cannot be used here", () => {
  it("is disabled and says why", async () => {
    useEditorStore.getState().loadFromProject(project());
    const sectionId = useEditorStore.getState().history.present.pages[0]!.sections[0]!.id;

    // Nest containers to the depth limit, then select the outermost: another container inside it
    // would exceed the limit.
    act(() => useEditorStore.getState().addElement(sectionId, "container"));
    const outer = useEditorStore.getState().ui.selection;
    if (outer?.kind !== "element") throw new Error("adding an element should select it");
    for (let level = 1; level < MAX_CONTAINER_DEPTH; level += 1) {
      const parent = useEditorStore.getState().ui.selection;
      if (parent?.kind !== "element") throw new Error("adding an element should select it");
      act(() => useEditorStore.getState().insertElement("container", { sectionId, containerId: parent.elementId }));
    }
    act(() => useEditorStore.getState().select({ kind: "element", elementId: outer.elementId }));

    renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Add elements" }));

    const container = within(panel()).getByRole("button", { name: "Container" });
    expect(container).toBeDisabled();
    expect(container).toHaveAccessibleDescription("Containers cannot be nested any deeper");

    // A block that is unaffected stays available.
    expect(within(panel()).getByRole("button", { name: "Text" })).toBeEnabled();
  });
});
