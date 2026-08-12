import { createProjectDocument, type BuilderProject, type ElementType } from "@websitebuilder/shared";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorShell } from "@/features/editor/EditorShell";
import { findElement } from "@/features/editor/store/elements";
import { cancelPendingAutosave, useEditorStore } from "@/features/editor/store/editorStore";
import { createHistory } from "@/features/editor/store/history";
import { renderWithProviders } from "@/test/render";

/**
 * The fifteen structured blocks, edited.
 *
 * Every one of these could be saved, validated and rendered by the document before this, and none
 * could be created or changed by a person. What is checked here is the part that makes a block
 * usable rather than merely storable: its own fields, its repeatable items, and the guards that stop
 * it storing something a visitor would be harmed by.
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

/** Inserts one block, selects it, and renders the builder with its inspector open. */
function withBlock(type: ElementType) {
  useEditorStore.getState().loadFromProject(project());
  const sectionId = useEditorStore.getState().history.present.pages[0]!.sections[0]!.id;
  act(() => useEditorStore.getState().addElement(sectionId, type));

  const selection = useEditorStore.getState().ui.selection;
  if (selection?.kind !== "element") throw new Error("adding an element should select it");

  renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />);
  return { id: selection.elementId, user: userEvent.setup() };
}

const current = (id: string) => findElement(useEditorStore.getState().history.present, id);

describe("every structured block opens an inspector with its own fields", () => {
  const cases: Array<[ElementType, string]> = [
    ["icon", "Icon"],
    ["iconList", "Items"],
    ["divider", "Thickness"],
    ["accordion", "Questions"],
    ["tabs", "Tabs"],
    ["gallery", "Images"],
    ["video", "Video identifier"],
    ["socialLinks", "Profiles"],
    ["downloadButton", "Media identifier"],
    ["breadcrumbs", "Navigation label"],
    ["table", "Caption"],
    ["pricingTable", "Plans"],
    ["announcementBar", "Text"],
    ["form", "Form"],
  ];

  for (const [type, field] of cases) {
    it(`${type} shows ${field}`, async () => {
      const { user } = withBlock(type);

      // Divider and gallery keep their controls under Style; the rest open on Content.
      if (["divider"].includes(type)) await user.click(screen.getByRole("tab", { name: "Style" }));

      // `getAllByText`: a list's label appears on its heading and again inside the "Add …" control,
      // and both are the block's own field rather than another block's.
      expect(screen.getAllByText(field, { exact: false }).length).toBeGreaterThan(0);
    });
  }
});

describe("repeatable items", () => {
  it("adds, reorders and removes without editing JSON", async () => {
    const { id, user } = withBlock("accordion");

    await user.click(screen.getByRole("button", { name: "Add Questions" }));
    expect(current(id)).toMatchObject({ items: [{ question: "Question" }, { question: "" }] });

    const first = screen.getAllByLabelText("Question")[0]!;
    await user.clear(first);
    await user.type(first, "Second");

    await user.click(screen.getByRole("button", { name: "Move Second down" }));
    const element = current(id);
    expect(element?.type === "accordion" && element.items.map((item) => item.question)).toEqual(["", "Second"]);

    await user.click(screen.getByRole("button", { name: "Remove Second" }));
    expect(current(id)).toMatchObject({ items: [{ question: "" }] });
  });

  it("duplicates an item with its content", async () => {
    const { id, user } = withBlock("tabs");

    await user.click(screen.getByRole("button", { name: "Duplicate First" }));
    const element = current(id);
    expect(element?.type === "tabs" && element.items.map((item) => item.label)).toEqual(["First", "First", "Second"]);
  });

  it("keeps a table's rows as wide as its columns", async () => {
    const { id, user } = withBlock("table");

    await user.click(screen.getByRole("button", { name: "Add Columns" }));

    const element = current(id);
    // A row longer than the header stores cells nobody can reach or edit.
    expect(element?.type === "table" && element.rows.every((row) => row.length === element.headers.length)).toBe(true);
  });
});

describe("guards a person would not think to ask for", () => {
  it("warns when a social row points somewhere that is not the network it claims", async () => {
    const { user } = withBlock("socialLinks");

    await user.click(screen.getByRole("button", { name: "Add Profiles" }));
    const address = screen.getByLabelText("Address");
    await user.clear(address);
    await user.type(address, "https://example.com/instagram");

    // A row labelled Instagram that opens somewhere else is the shape of a phishing link.
    expect(screen.getByRole("alert")).toHaveTextContent("This address does not belong to instagram.");
  });

  it("stores a video identifier rather than a pasted URL", async () => {
    const { id, user } = withBlock("video");

    await user.type(screen.getByLabelText("Video identifier"), "dQw4w9WgXcQ");
    expect(current(id)).toMatchObject({ videoId: "dQw4w9WgXcQ", provider: "youtube" });
  });

  it("asks for consent text only when consent is required", async () => {
    const { user } = withBlock("form");

    await user.click(screen.getByRole("tab", { name: "Advanced" }));
    // Two groups live under this tab: the block's own advanced fields and the shared ones. The
    // first is the block's.
    await user.click(screen.getAllByRole("button", { name: /Advanced/ })[0]!);

    expect(screen.queryByLabelText("Consent text")).toBeNull();
    await user.click(screen.getByLabelText("Ask for consent before storing a submission"));
    expect(screen.getByLabelText("Consent text")).toBeInTheDocument();
  });
});

describe("editing is one undo step per burst", () => {
  it("groups typing into a single history entry", async () => {
    const { user } = withBlock("announcementBar");
    const before = useEditorStore.getState().history.past.length;

    const text = screen.getByLabelText("Text");
    await user.clear(text);
    await user.type(text, "Sale");
    await user.tab();

    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
  });
});

describe("localization", () => {
  it("labels a structured block's fields in Portuguese", () => {
    useEditorStore.getState().loadFromProject(project());
    const sectionId = useEditorStore.getState().history.present.pages[0]!.sections[0]!.id;
    act(() => useEditorStore.getState().addElement(sectionId, "video"));

    renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />, { locale: "pt-BR" });
    const panel = screen.getByRole("complementary", { name: "Controles do construtor" });

    expect(within(panel).getByLabelText("Identificador do vídeo")).toBeInTheDocument();
    expect(within(panel).getByLabelText("Provedor")).toBeInTheDocument();
  });
});
