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
    ui: { currentPageId: null, selection: null, lastPanelMode: "pages", panelMode: "pages", panelIntent: "destination", zoom: 1, zoomChosen: false, editingWidth: 1440 },
  });
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in this test"))));
});

afterEach(() => {
  cancelPendingAutosave();
  vi.unstubAllGlobals();
});

const render = () => renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />);

/** The rail is the panel's own tablist, present in every mode — so it stands for "the panel is there". */
const PANEL_RAIL = "Builder destinations";

describe("the right panel", () => {
  it("collapses so the canvas can have the width back, and comes back", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();

    const panel = screen.getByRole("complementary", { name: "Builder controls" });
    expect(within(panel).getByRole("button", { name: "Collapse the panel" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("tablist", { name: PANEL_RAIL })).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Collapse the panel" }));

    // Gone rather than hidden: a collapsed panel must not keep a control the keyboard can still reach.
    expect(screen.queryByRole("tablist", { name: PANEL_RAIL })).not.toBeInTheDocument();
    const expand = within(panel).getByRole("button", { name: "Expand the panel" });
    expect(expand).toHaveAttribute("aria-expanded", "false");

    await user.click(expand);
    expect(screen.getByRole("tablist", { name: PANEL_RAIL })).toBeInTheDocument();
  });

  it("remembers the choice for the next session", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    const first = render();

    await user.click(screen.getByRole("button", { name: "Collapse the panel" }));
    first.unmount();
    render();

    // Someone who works on a laptop should not have to say this again every time they open a site.
    expect(screen.getByRole("button", { name: "Expand the panel" })).toBeInTheDocument();
  });
});

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

describe("top bar", () => {
  /** Everything in the bar that a person can act on, in reading order. */
  const actionInventory = () =>
    [...screen.getByRole("banner").querySelectorAll("button, a, select")].map(
      (node) => node.getAttribute("aria-label") ?? node.textContent?.trim(),
    );

  it("carries navigation and document actions only", () => {
    useEditorStore.getState().loadFromProject(project());
    render();

    // Manual Save stays because autosave can fail and a person closing the tab is entitled to force
    // the write. Everything else is exactly Section 4.2 of the plan.
    expect(actionInventory()).toEqual([
      "Back to sites",
      "Current page",
      "Desktop · 1440px",
      "Tablet · 768px",
      "Mobile · 390px",
      "Undo",
      "Redo",
      "Preview",
      "Save",
      "Publishing",
    ]);
  });

  it("offers one preview, not one per device", () => {
    useEditorStore.getState().loadFromProject(project());
    render();

    const previews = within(screen.getByRole("banner")).getAllByRole("link", { name: /preview/i });
    expect(previews).toHaveLength(1);
    expect(previews[0]).toHaveAttribute("href", "/preview/w1/aaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("names the publishing control for where it goes, because it does not publish", () => {
    useEditorStore.getState().loadFromProject(project());
    render();

    expect(screen.getByRole("link", { name: "Publishing" })).toHaveAttribute(
      "href",
      "/app/w1/sites/aaaaaaaaaaaaaaaaaaaaaaaa/publish",
    );

    // Nothing in the builder may carry the label of the act itself. Calling a link "Publish" is how
    // somebody left believing their site was live while it served a snapshot from before their edit.
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Publish" })).toBeNull();
  });

  it("switches page from the bar without leaving the builder", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    act(() => useEditorStore.getState().addPage("About"));
    render();

    const about = useEditorStore.getState().history.present.pages.find((page) => page.name === "About");
    await user.selectOptions(screen.getByLabelText("Current page"), about?.id ?? "");

    expect(useEditorStore.getState().ui.currentPageId).toBe(about?.id);
    expect(screen.getByRole("group", { name: "Page canvas" })).toBeInTheDocument();
  });

  it("carries no width tool or diagnostics", () => {
    useEditorStore.getState().loadFromProject(project());
    render();

    const bar = screen.getByRole("banner");
    expect(within(bar).queryByRole("slider")).toBeNull();
    expect(within(bar).queryByLabelText(/width/i)).toBeNull();
  });
});

describe("right panel state machine", () => {
  const railDestinations = () =>
    within(screen.getByRole("tablist", { name: "Builder destinations" }))
      .getAllByRole("tab")
      .map((tab) => tab.getAttribute("aria-label"));

  it("offers five stable destinations on an icon rail, not a row of text tabs", () => {
    useEditorStore.getState().loadFromProject(project());
    render();

    expect(railDestinations()).toEqual(["Add elements", "Pages", "Structure", "Page settings", "Site settings"]);
    // Icons carry a name and a tooltip; the label is not lost, only the space it used to take.
    for (const tab of within(screen.getByRole("tablist", { name: "Builder destinations" })).getAllByRole("tab")) {
      expect(tab).toHaveAttribute("title", tab.getAttribute("aria-label"));
    }
  });

  it("switches destinations without moving the canvas", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();

    const panel = screen.getByRole("complementary", { name: "Builder controls" });
    const widthBefore = panel.className;

    await user.click(screen.getByRole("tab", { name: "Structure" }));
    expect(screen.getByRole("tab", { name: "Structure" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Structure" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Page canvas" })).toBeInTheDocument();
    // The panel is one fixed-width region: its class contract is what stops the canvas jumping.
    expect(panel.className).toBe(widthBefore);
    expect(panel.className).toContain("w-80");
  });

  it("replaces the panel content with the section inspector when a section is selected", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();

    await user.click(screen.getByRole("region", { name: "Section" }));

    // The rail stays — leaving an inspector must not require guessing — but its panel is gone.
    expect(screen.getByRole("tab", { name: "Pages" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add page" })).toBeNull();
    expect(screen.getByRole("tablist", { name: "Element settings" })).toBeInTheDocument();
  });

  it("returns to the remembered destination when Back is pressed", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();

    await user.click(screen.getByRole("tab", { name: "Structure" }));
    await user.click(screen.getByRole("region", { name: "Section" }));
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("tab", { name: "Structure" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Structure" })).toBeInTheDocument();
  });

  it("keeps the chosen inspector tab when the selection changes", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();
    const sectionId = useEditorStore.getState().history.present.pages[0]?.sections[0]?.id ?? "";

    act(() => useEditorStore.getState().addElement(sectionId, "text"));
    await user.click(screen.getByRole("tab", { name: "Style" }));
    act(() => useEditorStore.getState().addElement(sectionId, "button"));

    expect(screen.getByRole("tab", { name: "Style" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("site settings destination", () => {
  const openSiteSettings = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole("tab", { name: "Site settings" }));

  it("edits the site name and its search defaults in the document", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();
    await openSiteSettings(user);

    await user.clear(screen.getByLabelText("Site name"));
    await user.type(screen.getByLabelText("Site name"), "Acme Ltd");
    expect(useEditorStore.getState().history.present.name).toBe("Acme Ltd");

    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    await user.click(screen.getByLabelText("Allow search engines to index this site"));
    expect(useEditorStore.getState().history.present.seo.defaultRobots.index).toBe(false);
  });

  it("offers configuration for a feature only once the site uses it", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();
    await openSiteSettings(user);

    expect(screen.queryByRole("link", { name: "Blog" })).toBeNull();

    act(() =>
      useEditorStore.setState((state) => ({
        history: {
          ...state.history,
          present: {
            ...state.history.present,
            featureStates: [
              {
                feature: "blog",
                lifecycle: "ready",
                draftReferenceCount: 1,
                publishedReferenceCount: 0,
                blockingIssueCount: 0,
                warningCount: 0,
                sourceRevision: 1,
              },
            ],
          },
        },
      })),
    );

    expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute(
      "href",
      "/app/w1/sites/aaaaaaaaaaaaaaaaaaaaaaaa/blog",
    );
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
    expect(screen.getByRole("tab", { name: "Configurações do site" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Todas as alterações salvas");
  });
});

describe("hooks", () => {
  it("survives the load finishing, which is when a misplaced hook shows up", async () => {
    // Every hook has to run before the early returns for loading and error. Placed after them, the
    // component renders a different number of hooks once the project arrives, and React tears the
    // whole builder down — which unit tests that start in one state never see.
    useEditorStore.setState({ loadStatus: "loading" });
    renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => useEditorStore.getState().loadFromProject(project()));
    expect(await screen.findByRole("group", { name: "Page canvas" })).toBeInTheDocument();
  });
});

/**
 * The chrome around a blog layout.
 *
 * The same shell edits a site and a blog template, and every control in the top bar used to be
 * written for the site. So Preview opened the site's home page, and Back left for a list of sites
 * two screens away from the layout somebody was editing.
 */
describe("editing a blog template", () => {
  const openTemplate = (templateKind: "index" | "article") => {
    useEditorStore.getState().loadFromProject(project());
    act(() => {
      useEditorStore.setState({
        target: { kind: "blogTemplate", templateKind, version: 1, fieldDefinitions: [] },
      });
    });
    return render();
  };

  it("previews the layout, not the site's home page", () => {
    openTemplate("article");

    expect(screen.getByRole("link", { name: /preview/i })).toHaveAttribute(
      "href",
      "/preview/w1/aaaaaaaaaaaaaaaaaaaaaaaa?template=article",
    );
  });

  it("previews the index layout when that is what is open", () => {
    openTemplate("index");
    expect(screen.getByRole("link", { name: /preview/i })).toHaveAttribute("href", expect.stringContaining("template=index"));
  });

  it("goes back to the blog it belongs to", () => {
    openTemplate("article");

    expect(screen.getByRole("link", { name: "Back to the blog" })).toHaveAttribute(
      "href",
      "/app/w1/sites/aaaaaaaaaaaaaaaaaaaaaaaa/blog",
    );
  });

  it("leaves the site's own chrome alone", () => {
    useEditorStore.getState().loadFromProject(project());
    render();

    expect(screen.getByRole("link", { name: /preview/i })).toHaveAttribute(
      "href",
      "/preview/w1/aaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(screen.getByRole("link", { name: "Back to sites" })).toBeInTheDocument();
  });
});
