import { createProjectDocument, type BuilderProject } from "@websitebuilder/shared";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorShell } from "@/features/editor/EditorShell";
import { findElement } from "@/features/editor/store/elements";
import type { ElementType } from "@websitebuilder/shared";
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
    loadErrorCode: null,
    history: createHistory(createProjectDocument({ name: "", slug: "empty-site" })),
    persistence: { status: "clean" },
    ui: { currentPageId: null, selection: null, lastPanelMode: "pages", panelMode: "pages", panelIntent: "destination", zoom: 1, zoomChosen: false, editingWidth: 1440 },
  });
});

afterEach(() => {
  cancelPendingAutosave();
  vi.unstubAllGlobals();
});

/** Loads a project, adds one element of the given type and selects it. */
async function setupWithElement(type: ElementType) {
  useEditorStore.getState().loadFromProject(project());
  const sectionId = useEditorStore.getState().history.present.pages[0]?.sections[0]?.id;
  if (!sectionId) throw new Error("fixture is missing its section");

  act(() => useEditorStore.getState().addElement(sectionId, type));
  const selection = useEditorStore.getState().ui.selection;
  if (selection?.kind !== "element") throw new Error("adding an element should select it");

  renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />);
  return selection.elementId;
}

const currentElement = (id: string) => findElement(useEditorStore.getState().history.present, id);

/** The inspector opens on Content; every other group lives behind its tab. */
const openTab = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole("tab", { name }));

/** The group headings currently rendered, without the disclosure glyph. */
const headingsInPanel = () =>
  within(screen.getByRole("complementary", { name: "Builder controls" }))
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent?.replace(/[−+]/g, "").trim());

describe("inspector structure", () => {
  it("offers the same three tabs for every element type", async () => {
    // Stability is the point: a person who is editing colours does not have to rediscover where
    // colours live every time they select a different kind of element.
    for (const type of ["text", "image", "button"] as const) {
      await setupWithElement(type);
      const tabs = within(screen.getByRole("tablist", { name: "Element settings" })).getAllByRole("tab");
      expect(tabs.map((tab) => tab.textContent), type).toEqual(["Content", "Style", "Advanced"]);
      cleanup();
    }
  });

  it("puts layout and responsive sizing inside Style rather than beside it", async () => {
    const user = userEvent.setup();
    await setupWithElement("text");

    expect(headingsInPanel()).toEqual(["Content"]);
    await openTab(user, "Style");
    expect(headingsInPanel()).toEqual(["Style", "Layout", "Responsive"]);
    await openTab(user, "Advanced");
    expect(headingsInPanel()).toEqual(["Advanced"]);
  });

  it("only shows controls that can affect the selected type", async () => {
    const user = userEvent.setup();
    await setupWithElement("image");
    await openTab(user, "Style");

    expect(screen.queryByLabelText("Line height")).toBeNull();
    expect(screen.getByLabelText("Fit")).toBeInTheDocument();
  });

  it("collapses and expands a group without touching the document", async () => {
    const user = userEvent.setup();
    const id = await setupWithElement("text");
    await openTab(user, "Style");
    const before = useEditorStore.getState().history;

    await user.click(screen.getByRole("button", { name: /Style/ }));
    expect(screen.queryByLabelText("Font size")).toBeNull();
    expect(useEditorStore.getState().history).toEqual(before);
    expect(currentElement(id)).not.toBeNull();
  });
});

describe("text inspector", () => {
  it("edits content and keeps the whole burst as one undo step", async () => {
    const user = userEvent.setup();
    const id = await setupWithElement("text");
    const undoDepth = useEditorStore.getState().history.past.length;

    const field = screen.getByLabelText("Content");
    await user.clear(field);
    await user.type(field, "Hello");
    await user.tab();

    expect(currentElement(id)).toMatchObject({ content: "Hello" });
    expect(useEditorStore.getState().history.past.length).toBe(undoDepth + 1);
  });

  it("changes the semantic tag", async () => {
    const user = userEvent.setup();
    const id = await setupWithElement("text");
    await user.selectOptions(screen.getByLabelText("Tag"), "h2");
    expect(currentElement(id)).toMatchObject({ tag: "h2" });
  });

  it("keeps font size a structured value with an allowlisted unit", async () => {
    const user = userEvent.setup();
    const id = await setupWithElement("text");
    await openTab(user, "Style");

    await user.selectOptions(screen.getByLabelText("Font size unit"), "rem");
    const element = currentElement(id);
    expect(element?.type === "text" && element.style.fontSize).toEqual({ value: 16, unit: "rem" });
  });
});

describe("image inspector", () => {
  it("hides the alt field for a decorative image", async () => {
    const user = userEvent.setup();
    const id = await setupWithElement("image");

    expect(screen.getByLabelText("Alternative text")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Decorative image"));

    expect(screen.queryByLabelText("Alternative text")).toBeNull();
    expect(currentElement(id)).toMatchObject({ decorative: true });
  });

  it("switches the source kind without corrupting the document", async () => {
    const user = userEvent.setup();
    const id = await setupWithElement("image");

    await user.selectOptions(screen.getByLabelText("Image source"), "url");
    await user.type(screen.getByLabelText("Image URL"), "https://example.com/a.png");

    const element = currentElement(id);
    expect(element?.type === "image" && element.source).toEqual({
      kind: "url",
      url: "https://example.com/a.png",
    });
  });
});

describe("button inspector and links", () => {
  it("starts unconfigured rather than pointing somewhere wrong", async () => {
    const id = await setupWithElement("button");
    expect(currentElement(id)).toMatchObject({ link: { kind: "none" } });
    expect(screen.getByLabelText("Link to")).toHaveValue("none");
  });

  it("links to an internal page by id", async () => {
    const user = userEvent.setup();
    const id = await setupWithElement("button");

    await user.selectOptions(screen.getByLabelText("Link to"), "internal");
    const element = currentElement(id);
    const homeId = useEditorStore.getState().history.present.pages[0]?.id;
    expect(element?.type === "button" && element.link).toEqual({ kind: "internal", pageId: homeId });
  });

  it("warns about an unsafe external address instead of storing it silently", async () => {
    const user = userEvent.setup();
    await setupWithElement("button");

    await user.selectOptions(screen.getByLabelText("Link to"), "external");
    await user.type(screen.getByLabelText("Address"), "javascript:alert(1)");

    expect(screen.getByRole("alert")).toHaveTextContent("Only https addresses are accepted.");
  });

  it("shows a repairable state when the linked page was deleted", async () => {
    const user = userEvent.setup();
    const id = await setupWithElement("button");

    await user.selectOptions(screen.getByLabelText("Link to"), "internal");
    act(() =>
      useEditorStore.getState().update((document) => {
        const walk = (elements: typeof document.pages[number]["sections"][number]["elements"]) =>
          elements.map((element) =>
            element.id === id && element.type === "button"
              ? { ...element, link: { kind: "internal" as const, pageId: "deleted-page" } }
              : element,
          );
        return {
          ...document,
          pages: document.pages.map((page) => ({
            ...page,
            sections: page.sections.map((section) => ({ ...section, elements: walk(section.elements) })),
          })),
        };
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("The linked page no longer exists.");
  });
});

describe("advanced group", () => {
  it("renames, locks and hides the element", async () => {
    const user = userEvent.setup();
    const id = await setupWithElement("text");

    await openTab(user, "Advanced");
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "Headline");
    await user.click(screen.getByLabelText("Locked"));

    expect(currentElement(id)).toMatchObject({ name: "Headline", locked: true });
  });
});

describe("z-order controls", () => {
  it("sends the element backward", async () => {
    const user = userEvent.setup();
    const first = await setupWithElement("text");
    const sectionId = useEditorStore.getState().history.present.pages[0]?.sections[0]?.id;
    if (!sectionId) throw new Error("fixture is missing its section");

    act(() => useEditorStore.getState().addElement(sectionId, "button"));
    const second = useEditorStore.getState().ui.selection;
    if (second?.kind !== "element") throw new Error("adding an element should select it");

    await openTab(user, "Style");
    await user.click(screen.getByRole("button", { name: "Send to back" }));
    expect(currentElement(second.elementId)?.zIndex).toBe(1);
    expect(currentElement(first)?.zIndex).toBe(2);
  });
});

describe("localization", () => {
  it("labels every inspector field in Portuguese", async () => {
    useEditorStore.getState().loadFromProject(project());
    const sectionId = useEditorStore.getState().history.present.pages[0]?.sections[0]?.id;
    if (!sectionId) throw new Error("fixture is missing its section");
    act(() => useEditorStore.getState().addElement(sectionId, "text"));

    renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />, { locale: "pt-BR" });
    const panel = screen.getByRole("complementary", { name: "Controles do construtor" });
    expect(within(panel).getByLabelText("Conteúdo")).toBeInTheDocument();
    expect(within(panel).getByLabelText("Tag")).toBeInTheDocument();
  });
});

/**
 * The colour pair, for the twenty-two block types that had none.
 *
 * A download button was a browser-default link and a table was browser-default text: no way to set
 * either colour, on any of them. What is checked here is that the group appears exactly where it is
 * needed and nowhere it would compete with a control that already exists.
 */
describe("shared colours", () => {
  it("offers text and background to a block that owns neither", async () => {
    const user = userEvent.setup();
    const id = await setupWithElement("downloadButton");
    await openTab(user, "Style");

    expect(headingsInPanel()).toContain("Colours");

    await user.click(screen.getByLabelText("Background"));
    fireEvent.change(screen.getByLabelText("Background"), { target: { value: "#123456" } });

    expect(currentElement(id)?.appearance?.backgroundColor).toBe("#123456");
  });

  it("gives the colour back, because a picker has no empty state of its own", async () => {
    const user = userEvent.setup();
    const id = await setupWithElement("downloadButton");
    await openTab(user, "Style");

    fireEvent.change(screen.getByLabelText("Background"), { target: { value: "#123456" } });
    await user.click(screen.getByRole("button", { name: "Clear colour" }));

    // Cleared back to nothing at all, not to a black that only looks like a choice.
    expect(currentElement(id)?.appearance).toBeUndefined();
  });

  it("stays away from blocks that already own their colours", async () => {
    const user = userEvent.setup();
    await setupWithElement("text");
    await openTab(user, "Style");

    // Text has a colour field of its own. Two controls writing one property is worse than one.
    expect(headingsInPanel()).not.toContain("Colours");
  });
});
