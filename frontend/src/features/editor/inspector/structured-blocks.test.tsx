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
    ["downloadButton", "File"],
    ["breadcrumbs", "Navigation label"],
    ["table", "Caption"],
    ["pricingTable", "Plans"],
    ["announcementBar", "Text"],
    ["form", "Form"],
    ["richText", "Bold"],
    ["navigationMenu", "Menu items"],
    ["siteLogo", "Text when there is no image"],
    ["testimonial", "Quote"],
    ["carousel", "Slides"],
    ["contactInfo", "Details"],
    ["counter", "Display"],
    ["countdown", "Target moment"],
  ];

  for (const [type, field] of cases) {
    it(`${type} shows ${field}`, async () => {
      const { user } = withBlock(type);

      // A form block makes the shell load the project's definitions. Settled inside act so the
      // state it sets belongs to the test rather than arriving after it.
      if (type === "form") await act(async () => undefined);

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

  it("gives the rich-text block somewhere to actually write", () => {
    withBlock("richText");

    // It used to offer a sentence pointing at a canvas toolbar that does not exist, which left it
    // as the one block in the catalog whose content could not be changed by anybody.
    //
    // Asserted as a surface rather than by typing: ProseMirror measures its own document, which
    // needs layout jsdom does not do. What can regress here — and did — is the editor not being
    // mounted at all.
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    for (const control of ["Bold", "Italic", "Heading", "Quote"]) {
      expect(within(toolbar).getByRole("button", { name: control })).toBeInTheDocument();
    }

    expect(screen.getByLabelText("Text").getAttribute("contenteditable")).toBe("true");
  });

  it("keeps a form block to presentation, and never to what the form says", async () => {
    const { id, user } = withBlock("form");
    await act(async () => undefined);

    // Consent, the submit label and the messages moved to the definition, where one edit reaches
    // every page that shows the form. A copy here would drift from the copy that validates.
    expect(screen.queryByLabelText("Ask for consent before storing a submission")).toBeNull();
    expect(screen.queryByLabelText("Submit button")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Style" }));
    await user.selectOptions(screen.getByLabelText("Arrangement"), "twoColumn");

    const element = current(id);
    expect(element?.type === "form" && element.presentation.preset).toBe("twoColumn");
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

describe("the core blocks keep their own controls", () => {
  it("caps how wide any block may grow", async () => {
    const { id, user } = withBlock("text");

    await user.click(screen.getByRole("tab", { name: "Style" }));
    await user.click(screen.getByRole("button", { name: /Responsive/ }));

    // `clear` on a number input leaves the browser's own empty state, which the field renders as
    // its current value; typing appends to it unless the selection is replaced.
    const field = screen.getByLabelText("Maximum width");
    await user.tripleClick(field);
    await user.keyboard("60");

    // A line of text stays readable when its section is wider than a comfortable measure.
    const element = current(id);
    expect(element?.responsiveLayout.maxWidth).toMatchObject({ value: 60 });
  });

  it("lets a container choose how it lays its children out", async () => {
    const { id, user } = withBlock("container");

    await user.click(screen.getByRole("tab", { name: "Style" }));
    await user.selectOptions(screen.getByLabelText("Layout mode"), "flex");

    expect(current(id)).toMatchObject({ layout: "flex" });
  });

  it("offers a semantic heading level rather than a font size that looks like one", async () => {
    const { id, user } = withBlock("text");

    await user.selectOptions(screen.getByLabelText("Tag"), "h2");
    expect(current(id)).toMatchObject({ tag: "h2" });
  });
});

describe("the blocks that carry their own meaning", () => {
  it("refuses to let a countdown mean a different moment for every visitor", async () => {
    const { user } = withBlock("countdown");

    await user.type(screen.getByLabelText("Target moment"), "2026-12-24T18:00");

    // A wall-clock time is midnight somewhere. Storing one is how a launch counts down to the
    // wrong instant for half the people watching it.
    expect(screen.getByRole("alert")).toHaveTextContent("no timezone");

    await user.type(screen.getByLabelText("Target moment"), "-03:00");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks for a maximum only when a counter is a bar", async () => {
    const { user } = withBlock("counter");

    expect(screen.queryByLabelText("Maximum")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Display"), "bar");
    expect(screen.getByLabelText("Maximum")).toBeInTheDocument();
  });

  it("binds a menu item to a page rather than to a typed address", async () => {
    const { id, user } = withBlock("navigationMenu");

    await user.click(screen.getByRole("button", { name: "Add Menu items" }));
    await user.selectOptions(screen.getByLabelText("Link to"), "internal");

    const element = current(id);
    const home = useEditorStore.getState().history.present.pages[0]?.id;
    // Renaming or moving that page updates the menu; a stored address would not.
    expect(element?.type === "navigationMenu" && element.items[0]?.link).toEqual({ kind: "internal", pageId: home });
  });

  it("treats no rating as absent rather than as zero stars", async () => {
    const { id, user } = withBlock("testimonial");

    await user.selectOptions(screen.getByLabelText("Rating"), "4");
    expect(current(id)).toMatchObject({ rating: 4 });

    await user.selectOptions(screen.getByLabelText("Rating"), "none");
    // A zero-star rating is a claim about the person quoted. Absence is not.
    expect(current(id)).not.toHaveProperty("rating", 0);
  });
});
