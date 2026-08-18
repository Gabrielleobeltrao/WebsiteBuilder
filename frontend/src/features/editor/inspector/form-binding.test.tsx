import { createProjectDocument, type BuilderProject } from "@websitebuilder/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorShell } from "@/features/editor/EditorShell";
import { findElement } from "@/features/editor/store/elements";
import { cancelPendingAutosave, useEditorStore } from "@/features/editor/store/editorStore";
import { createHistory } from "@/features/editor/store/history";
import { renderWithProviders } from "@/test/render";

/**
 * Binding a form block to a form.
 *
 * The control this replaced was a text box for a 24-character identifier. Everything asserted here
 * is about that: a person picks from a list or makes a form and is bound to it, and never needs to
 * know an id exists.
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

const summary = (overrides: Record<string, unknown> = {}) => ({
  id: "f1",
  workspaceId: "w1",
  projectId: "p1",
  name: "Contact",
  fields: [{ id: "name", type: "shortText", label: "Your name", required: true }],
  submitLabel: "Send",
  successBehavior: { type: "message", message: "Thanks" },
  notificationRecipients: [],
  status: "ready",
  archived: false,
  revision: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  submissionCount: 0,
  unreadCount: 0,
  lastSubmissionAt: null,
  usages: [],
  ...overrides,
});

let posted: Array<Record<string, unknown>> = [];

beforeEach(() => {
  cancelPendingAutosave();
  posted = [];
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

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

      if (init?.method === "POST" && url.endsWith("/forms")) {
        posted.push(body);
        return new Response(JSON.stringify({ data: { ...summary(), id: "created-1", name: body.name } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/forms")) {
        return new Response(JSON.stringify({ data: [summary()] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );

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

async function withFormBlock() {
  useEditorStore.getState().loadFromProject(project());
  const sectionId = useEditorStore.getState().history.present.pages[0]!.sections[0]!.id;
  act(() => useEditorStore.getState().addElement(sectionId, "form"));

  const selection = useEditorStore.getState().ui.selection;
  if (selection?.kind !== "element") throw new Error("adding an element should select it");

  renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />);
  await act(async () => undefined);

  return { id: selection.elementId, user: userEvent.setup() };
}

const current = (id: string) => findElement(useEditorStore.getState().history.present, id);

describe("choosing a form", () => {
  it("offers the project's forms by name rather than asking for an identifier", async () => {
    const { id, user } = await withFormBlock();

    const picker = await screen.findByLabelText("Form");
    expect(picker.tagName).toBe("SELECT");

    await user.selectOptions(picker, "f1");
    expect(current(id)).toMatchObject({ formId: "f1" });
  });

  it("says a block is bound to nothing before it is bound", async () => {
    await withFormBlock();
    expect(await screen.findByText("No form chosen")).toBeInTheDocument();
  });
});

describe("creating one from the block", () => {
  it("gives the new form questions rather than binding an empty one", async () => {
    const { id, user } = await withFormBlock();

    await user.click(await screen.findByRole("button", { name: "Create a form" }));

    // Scoped to the panel: the builder's top bar has a Save of its own.
    const panel = within(screen.getByRole("group", { name: "Create a form" }));
    await user.type(panel.getByLabelText("Form name"), "Get in touch");
    await user.click(panel.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(current(id)).toMatchObject({ formId: "created-1" }));

    // A form created empty binds a block that immediately reports "this form asks nothing", which
    // is a dead end two clicks after somebody asked for a contact form.
    expect(posted[0]).toMatchObject({ name: "Get in touch" });
    expect((posted[0]?.fields as unknown[]).length).toBeGreaterThan(0);
  });
});
