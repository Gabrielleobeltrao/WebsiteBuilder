import { createProjectDocument, MAX_CONTAINER_DEPTH, type BuilderProject, type ElementType } from "@websitebuilder/shared";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorRoute } from "@/features/editor/EditorRoute";
import { EditorShell } from "@/features/editor/EditorShell";
import { CREATE_MIME, MOVE_MIME, SECTION_MIME } from "@/features/editor/canvas/dnd";
import { findElement } from "@/features/editor/store/elements";
import { cancelPendingAutosave, useEditorStore } from "@/features/editor/store/editorStore";
import { createHistory } from "@/features/editor/store/history";
import { renderWithProviders } from "@/test/render";

/**
 * Authoring by drag, by click, and by keyboard.
 *
 * Every assertion here is about the document, not the pixels: a drop that highlights the right place
 * and writes the wrong one is the failure this suite exists to catch. The pointer geometry itself is
 * a browser's job and is checked in the Playwright viewport matrix.
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

/** jsdom has no DataTransfer; the drag protocol only ever needs these three members. */
function transfer(mime: string, value: string) {
  return {
    types: [mime],
    getData: (requested: string) => (requested === mime ? value : ""),
    setData: vi.fn(),
    effectAllowed: "",
  };
}

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

const render = () => renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />);

const currentPage = () => useEditorStore.getState().history.present.pages[0]!;
const firstSection = () => currentPage().sections[0]!;

/** Starts a drag so the canvas renders its markers, then drops on `node`. */
function dragTo(node: Element, data: ReturnType<typeof transfer>) {
  const canvas = screen.getByRole("group", { name: "Page canvas" });
  fireEvent.dragEnter(canvas, { dataTransfer: data });
  fireEvent.dragOver(node, { dataTransfer: data });
  fireEvent.drop(node, { dataTransfer: data });
}

const openElements = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("tab", { name: "Add elements" }));

describe("dragging a block from the library", () => {
  it("writes a usable position when the drag carries no coordinates", () => {
    useEditorStore.getState().loadFromProject(project());
    render();

    // A synthetic drag has no clientX/clientY, and neither does a pointer event from an assistive
    // device driving the drop. What must never happen is NaN reaching the document: the schema
    // rejects it, so the next save fails with an error about a field nobody touched.
    dragTo(screen.getByRole("region", { name: "Section" }), transfer(CREATE_MIME, "text"));

    const created = firstSection().elements[0];
    expect(created).toBeDefined();
    for (const [axis, value] of Object.entries(created!.geometry)) {
      expect(Number.isFinite(value), `${axis} is ${String(value)}`).toBe(true);
    }
  });

  it("drops into a free section at the pointer and selects what it created", () => {
    useEditorStore.getState().loadFromProject(project());
    render();

    dragTo(screen.getByRole("region", { name: "Section" }), transfer(CREATE_MIME, "text"));

    const created = firstSection().elements;
    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe("text");
    expect(useEditorStore.getState().ui.selection).toEqual({ kind: "element", elementId: created[0]?.id });
  });

  it("shows insertion markers in a structured section and drops at the chosen position", () => {
    useEditorStore.getState().loadFromProject(project());
    act(() => useEditorStore.getState().convertSectionLayout(firstSection().id, "flex"));
    const sectionId = firstSection().id;
    act(() => useEditorStore.getState().addElement(sectionId, "button"));
    render();

    const canvas = screen.getByRole("group", { name: "Page canvas" });
    // No drag in progress, no markers: a page permanently striped with drop zones reads as noise.
    expect(screen.queryAllByRole("separator", { name: "Insert here" })).toHaveLength(0);

    const data = transfer(CREATE_MIME, "text");
    fireEvent.dragEnter(canvas, { dataTransfer: data });

    const markers = screen.getAllByRole("separator", { name: "Insert here" });
    expect(markers).toHaveLength(2); // before the button, and after it
    fireEvent.dragOver(markers[0]!, { dataTransfer: data });
    fireEvent.drop(markers[0]!, { dataTransfer: data });

    expect(firstSection().elements.map((element) => element.type)).toEqual(["text", "button"]);
  });

  it("writes nothing when the drag is cancelled", () => {
    useEditorStore.getState().loadFromProject(project());
    render();
    const before = useEditorStore.getState().history;

    const canvas = screen.getByRole("group", { name: "Page canvas" });
    fireEvent.dragEnter(canvas, { dataTransfer: transfer(CREATE_MIME, "text") });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryAllByRole("separator")).toHaveLength(0);
    expect(useEditorStore.getState().history).toEqual(before);
  });

  it("visibly refuses a container that would nest too deep", () => {
    useEditorStore.getState().loadFromProject(project());
    const sectionId = firstSection().id;

    // Nest containers until the outermost one is at the depth limit; the next one is what the guard
    // exists to refuse.
    act(() => useEditorStore.getState().addElement(sectionId, "container"));
    for (let level = 1; level < MAX_CONTAINER_DEPTH; level += 1) {
      const parent = useEditorStore.getState().ui.selection;
      if (parent?.kind !== "element") throw new Error("adding an element should select it");
      act(() => useEditorStore.getState().insertElement("container", { sectionId, containerId: parent.elementId }));
    }

    render();
    const before = useEditorStore.getState().history.present;
    const data = transfer(CREATE_MIME, "container");
    fireEvent.dragEnter(screen.getByRole("group", { name: "Page canvas" }), { dataTransfer: data });

    const refused = screen.getAllByRole("separator", { name: "Containers cannot be nested any deeper" });
    expect(refused.length).toBeGreaterThan(0);
    fireEvent.drop(refused[0]!, { dataTransfer: data });

    expect(useEditorStore.getState().history.present).toEqual(before);
  });

  it("moves an element that already exists instead of copying it", () => {
    useEditorStore.getState().loadFromProject(project());
    act(() => useEditorStore.getState().convertSectionLayout(firstSection().id, "flex"));
    const sectionId = firstSection().id;
    act(() => useEditorStore.getState().addElement(sectionId, "text"));
    act(() => useEditorStore.getState().addElement(sectionId, "button"));
    const buttonId = firstSection().elements[1]!.id;
    render();

    const data = transfer(MOVE_MIME, buttonId);
    fireEvent.dragEnter(screen.getByRole("group", { name: "Page canvas" }), { dataTransfer: data });
    const markers = screen.getAllByRole("separator", { name: "Insert here" });
    fireEvent.drop(markers[0]!, { dataTransfer: data });

    expect(firstSection().elements.map((element) => element.type)).toEqual(["button", "text"]);
  });
});

describe("click insertion", () => {
  const clickBlock = async (user: ReturnType<typeof userEvent.setup>, type: ElementType) => {
    await openElements(user);
    await user.click(screen.getByRole("button", { name: type === "text" ? "Text" : "Container" }));
  };

  it("creates a structured section at the page bottom when nothing is selected", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();

    await openElements(user);
    expect(screen.getByText(/a new section at the end of the page/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Text" }));

    const sections = currentPage().sections;
    expect(sections).toHaveLength(2);
    expect(sections[1]?.layoutMode).toBe("flex");
    expect(sections[1]?.elements).toHaveLength(1);
  });

  it("undoes the created section and its element as one step", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();

    await clickBlock(user, "text");
    act(() => useEditorStore.getState().undo());

    expect(currentPage().sections).toHaveLength(1);
    expect(firstSection().elements).toHaveLength(0);
  });

  it("adds to the selected section", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    const sectionId = firstSection().id;
    act(() => useEditorStore.getState().select({ kind: "section", sectionId }));
    render();

    await clickBlock(user, "text");

    expect(currentPage().sections).toHaveLength(1);
    expect(firstSection().elements).toHaveLength(1);
  });

  it("adds inside the selected container", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    act(() => useEditorStore.getState().addElement(firstSection().id, "container"));
    const selection = useEditorStore.getState().ui.selection;
    if (selection?.kind !== "element") throw new Error("adding an element should select it");
    render();

    await clickBlock(user, "text");

    const container = findElement(useEditorStore.getState().history.present, selection.elementId);
    expect(container?.type === "container" && container.children).toHaveLength(1);
    expect(firstSection().elements).toHaveLength(1);
  });
});

describe("section creation on the canvas", () => {
  it("adds a section of the chosen layout at the chosen position", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    render();

    // One row above the only section, one below it.
    const rows = screen.getAllByRole("button", { name: "Add a Grid section here" });
    expect(rows).toHaveLength(2);
    await user.click(rows[0]!);

    expect(currentPage().sections.map((section) => section.layoutMode)).toEqual(["grid", "free"]);

    act(() => useEditorStore.getState().undo());
    expect(currentPage().sections).toHaveLength(1);
  });

  it("offers free, flex and grid at every position", () => {
    useEditorStore.getState().loadFromProject(project());
    render();

    for (const layout of ["Free", "Flex", "Grid"]) {
      expect(screen.getAllByRole("button", { name: `Add a ${layout} section here` })).toHaveLength(2);
    }
  });
});

describe("structure tree", () => {
  const openStructure = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole("tab", { name: "Structure" }));

  it("reorders elements with the keyboard and in one history entry", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    const sectionId = firstSection().id;
    act(() => useEditorStore.getState().addElement(sectionId, "text"));
    act(() => useEditorStore.getState().addElement(sectionId, "button"));
    render();
    await openStructure(user);

    const depth = useEditorStore.getState().history.past.length;
    const tree = screen.getByRole("navigation", { name: "Page structure" });
    await user.click(within(tree).getAllByRole("button", { name: "Move up" })[0]!);

    expect(firstSection().elements.map((element) => element.type)).toEqual(["button", "text"]);
    expect(useEditorStore.getState().history.past.length).toBe(depth + 1);
  });

  it("reorders sections by drag", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    act(() => useEditorStore.getState().addSection("grid"));
    render();
    await openStructure(user);

    const [first, second] = currentPage().sections;
    const rows = screen.getByRole("navigation", { name: "Page structure" }).querySelectorAll("li > div");
    const data = transfer(SECTION_MIME, second!.id);
    fireEvent.dragOver(rows[0]!, { dataTransfer: data });
    fireEvent.drop(rows[0]!, { dataTransfer: data });

    expect(currentPage().sections.map((section) => section.id)).toEqual([second!.id, first!.id]);
  });

  it("renames in place", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    act(() => useEditorStore.getState().addElement(firstSection().id, "text"));
    render();
    await openStructure(user);

    const tree = screen.getByRole("navigation", { name: "Page structure" });
    await user.click(within(tree).getAllByRole("button", { name: "Rename" })[1]!);
    const field = screen.getByRole("textbox", { name: "Rename" });
    await user.clear(field);
    await user.type(field, "Headline{Enter}");

    expect(firstSection().elements[0]?.name).toBe("Headline");
  });

  it("recovers a hidden element and reaches a locked one", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    act(() => useEditorStore.getState().addElement(firstSection().id, "text"));
    const elementId = firstSection().elements[0]!.id;
    act(() => useEditorStore.getState().setElementFlag(elementId, "hidden", true));
    act(() => useEditorStore.getState().setElementFlag(elementId, "locked", true));
    act(() => useEditorStore.getState().select(null));
    render();
    await openStructure(user);

    const tree = screen.getByRole("navigation", { name: "Page structure" });
    // Hidden means unpainted, locked means unclickable: neither is reachable on the canvas.
    expect(screen.queryByText("Locked")).not.toBeNull();
    await user.click(within(tree).getByRole("button", { name: "Show" }));
    expect(findElement(useEditorStore.getState().history.present, elementId)?.hidden).toBe(false);

    await user.click(within(tree).getByRole("button", { name: "Text" }));
    expect(useEditorStore.getState().ui.selection).toEqual({ kind: "element", elementId });
  });

  it("shows the page, its sections and nested containers", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    const sectionId = firstSection().id;
    act(() => useEditorStore.getState().addElement(sectionId, "container"));
    const container = useEditorStore.getState().ui.selection;
    if (container?.kind !== "element") throw new Error("adding an element should select it");
    act(() => useEditorStore.getState().insertElement("text", { sectionId, containerId: container.elementId }));
    render();
    await openStructure(user);

    const tree = screen.getByRole("navigation", { name: "Page structure" });
    expect(within(tree).getByText("Home")).toBeInTheDocument();
    expect(within(tree).getByRole("button", { name: "Container" })).toBeInTheDocument();
    expect(within(tree).getByRole("button", { name: "Text" })).toBeInTheDocument();

    await user.click(within(tree).getAllByRole("button", { name: "Collapse" })[1]!);
    expect(within(tree).queryByRole("button", { name: "Text" })).toBeNull();
  });
});

describe("canvas actions", () => {
  it("duplicates and deletes the selected element without covering it", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().loadFromProject(project());
    act(() => useEditorStore.getState().addElement(firstSection().id, "text"));
    render();

    const toolbar = screen.getByRole("toolbar", { name: "Selected element" });
    await user.click(within(toolbar).getByRole("button", { name: "Duplicate element" }));
    expect(firstSection().elements).toHaveLength(2);

    await user.click(
      within(screen.getByRole("toolbar", { name: "Selected element" })).getByRole("button", {
        name: "Delete element",
      }),
    );
    expect(firstSection().elements).toHaveLength(1);
    expect(screen.queryByRole("toolbar", { name: "Selected element" })).toBeNull();
  });

  it("stays out of the way of a locked element", () => {
    useEditorStore.getState().loadFromProject(project());
    act(() => useEditorStore.getState().addElement(firstSection().id, "text"));
    act(() => useEditorStore.getState().setElementFlag(firstSection().elements[0]!.id, "locked", true));
    render();

    expect(screen.queryByRole("toolbar", { name: "Selected element" })).toBeNull();
  });
});

describe("opening a readiness finding in the builder", () => {
  const routes = (
    <Routes>
      <Route path="/app/:workspaceId/sites/:projectId/builder" element={<EditorRoute />} />
      <Route path="/app/:workspaceId/sites/:projectId/builder/:pageId" element={<EditorRoute />} />
    </Routes>
  );

  /** The address a readiness finding produces, resolved against a loaded project. */
  async function openFinding(query: string) {
    useEditorStore.getState().loadFromProject(project());
    const page = currentPage();
    act(() => useEditorStore.getState().addElement(page.sections[0]!.id, "text"));
    const elementId = firstSection().elements[0]!.id;
    act(() => useEditorStore.getState().select(null));
    act(() => useEditorStore.getState().setEditingDevice("desktop"));

    // `load` would replace the store from the network; the fixture is already loaded, so the route
    // is rendered with a load that resolves to what is there.
    vi.spyOn(useEditorStore.getState(), "load").mockResolvedValue(undefined);
    useEditorStore.setState({ loadStatus: "ready" });

    renderWithProviders(routes, {
      route: `/app/w1/sites/aaaaaaaaaaaaaaaaaaaaaaaa/builder/${page.id}${query.replace("ELEMENT", elementId)}`,
    });

    return { pageId: page.id, elementId };
  }

  it("opens the page, the device and the element the finding names", async () => {
    const { pageId, elementId } = await openFinding("?element=ELEMENT&device=mobile");

    expect(useEditorStore.getState().ui.currentPageId).toBe(pageId);
    expect(useEditorStore.getState().ui.editingWidth).toBe(390);
    expect(useEditorStore.getState().ui.selection).toEqual({ kind: "element", elementId });
    // ...and the inspector is what the panel shows, without a second click.
    expect(screen.getByRole("tablist", { name: "Element settings" })).toBeInTheDocument();
  });

  it("ignores an element that is no longer there", async () => {
    await openFinding("?element=deleted-element&device=tablet");

    expect(useEditorStore.getState().ui.selection).toBeNull();
    expect(useEditorStore.getState().ui.editingWidth).toBe(768);
  });
});

describe("a finding opens the tab holding its field", () => {
  it("opens the inspector on the tab the address names", async () => {
    useEditorStore.getState().loadFromProject(project());
    const page = currentPage();
    act(() => useEditorStore.getState().addElement(page.sections[0]!.id, "text"));
    const elementId = firstSection().elements[0]!.id;
    act(() => useEditorStore.getState().select(null));

    vi.spyOn(useEditorStore.getState(), "load").mockResolvedValue(undefined);
    useEditorStore.setState({ loadStatus: "ready" });

    renderWithProviders(
      <Routes>
        <Route path="/app/:workspaceId/sites/:projectId/builder/:pageId" element={<EditorRoute />} />
      </Routes>,
      { route: `/app/w1/sites/aaaaaaaaaaaaaaaaaaaaaaaa/builder/${page.id}?element=${elementId}&tab=style` },
    );

    expect(screen.getByRole("tab", { name: "Style" })).toHaveAttribute("aria-selected", "true");
  });
});
