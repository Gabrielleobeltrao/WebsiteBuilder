import { createProjectDocument, type BuilderProject } from "@websitebuilder/shared";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorShell } from "@/features/editor/EditorShell";
import { cancelPendingAutosave, selectCurrentPage, useEditorStore } from "@/features/editor/store/editorStore";
import { createHistory } from "@/features/editor/store/history";
import { MOVE_MIME, SECTION_MIME } from "@/features/editor/canvas/dnd";
import { renderWithProviders } from "@/test/render";

/**
 * Structure, as the place where anything on the page can be removed.
 *
 * It could already rename, hide and reorder everything, but not delete — so a section whose
 * inspector was awkward to reach, or an element the canvas would not select, had no removal path at
 * all from here. Deleting the *last* section had no path anywhere: the store refused it silently,
 * and the Delete button in the inspector simply did nothing on a one-section page.
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
    ui: { currentPageId: null, selection: null, lastPanelMode: "pages", panelMode: "pages", panelIntent: "destination", zoom: 1, zoomChosen: false, editingWidth: 1440 },
    clipboard: null,
  });
});

afterEach(() => {
  cancelPendingAutosave();
  vi.unstubAllGlobals();
});

/** Seeds the document before rendering: adding a block selects it, which would open the inspector. */
async function openStructure(seed?: () => void) {
  useEditorStore.getState().loadFromProject(project());
  seed?.();
  renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "Structure" }));
  return user;
}

const tree = () => screen.getByRole("navigation", { name: "Page structure" });
const sections = () => selectCurrentPage(useEditorStore.getState())?.sections ?? [];

describe("deleting from the structure tree", () => {
  it("removes a section", async () => {
    const user = await openStructure(() => useEditorStore.getState().addSection("flex"));
    expect(sections()).toHaveLength(2);

    await user.click(within(tree()).getAllByRole("button", { name: "Delete section" })[0]!);

    expect(sections()).toHaveLength(1);
  });

  it("removes the last section too, and the canvas can still add one back", async () => {
    const user = await openStructure();
    expect(sections()).toHaveLength(1);

    await user.click(within(tree()).getByRole("button", { name: "Delete section" }));

    // Silently refusing this was the bug: the button was there, it was enabled, and it did nothing.
    expect(sections()).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /Add a .* section here/ }).length).toBeGreaterThan(0);
  });

  it("removes an element without touching the section holding it", async () => {
    const user = await openStructure(() =>
      useEditorStore.getState().insertElement("text", { sectionId: sections()[0]!.id, index: 0 }),
    );
    expect(sections()[0]?.elements).toHaveLength(1);

    await user.click(within(tree()).getByRole("button", { name: "Delete element" }));

    expect(sections()).toHaveLength(1);
    expect(sections()[0]?.elements).toHaveLength(0);
  });

  it("puts back what was deleted, because a delete with no warning needs an undo", async () => {
    const user = await openStructure();
    await user.click(within(tree()).getByRole("button", { name: "Delete section" }));
    expect(sections()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(sections()).toHaveLength(1);
  });
});

/**
 * Moving a block from one section to another.
 *
 * The tree could reorder sections and reorder elements inside one, and had no way to move an element
 * *between* them — least of all into an empty section, which has no element row to aim at. On the
 * canvas the only target was a four-pixel band, which is why the honest report was "you cannot do
 * this at all".
 */
describe("moving a block between sections", () => {
  /** A drag whose payload the drop handler will read, as the DOM would carry it. */
  const transfer = (mime: string, value: string) => {
    const data: Record<string, string> = { [mime]: value };
    return { types: [mime], getData: (key: string) => data[key] ?? "" };
  };

  it("drops an element onto another section and lands it there", async () => {
    const user = await openStructure(() => {
      const store = useEditorStore.getState();
      store.insertElement("text", { sectionId: sections()[0]!.id, index: 0 });
      store.addSection("flex");
    });
    void user;

    const [first, second] = sections();
    expect(first!.elements).toHaveLength(1);
    expect(second!.elements).toHaveLength(0);

    const rows = within(tree()).getAllByRole("button", { name: "Delete section" });
    const target = rows[1]!.closest("div")!;
    fireEvent.dragOver(target, { dataTransfer: transfer(MOVE_MIME, first!.elements[0]!.id) });
    fireEvent.drop(target, { dataTransfer: transfer(MOVE_MIME, first!.elements[0]!.id) });

    expect(sections()[0]?.elements).toHaveLength(0);
    expect(sections()[1]?.elements).toHaveLength(1);
  });

  it("still reorders sections, which is what that row meant before", async () => {
    await openStructure(() => useEditorStore.getState().addSection("flex"));

    const before = sections().map((section) => section.id);
    const rows = within(tree()).getAllByRole("button", { name: "Delete section" });
    const target = rows[0]!.closest("div")!;
    fireEvent.dragOver(target, { dataTransfer: transfer(SECTION_MIME, before[1]!) });
    fireEvent.drop(target, { dataTransfer: transfer(SECTION_MIME, before[1]!) });

    expect(sections().map((section) => section.id)).toEqual([before[1], before[0]]);
  });
});
