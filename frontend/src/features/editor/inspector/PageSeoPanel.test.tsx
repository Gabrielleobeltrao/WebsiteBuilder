import { createProjectDocument, type BuilderProject } from "@websitebuilder/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorShell } from "@/features/editor/EditorShell";
import { cancelPendingAutosave, useEditorStore } from "@/features/editor/store/editorStore";
import { createHistory } from "@/features/editor/store/history";
import { renderWithProviders } from "@/test/render";

const project = (): BuilderProject => {
  const document = createProjectDocument({ name: "Acme", slug: "acme" });
  document.seo = {
    ...document.seo,
    siteName: "Acme",
    titleTemplate: "%s | %site%",
    defaultDescription: "A site about things that matter.",
    canonicalBaseUrl: "https://acme.example",
  };
  return {
    id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    workspaceId: "w1",
    createdByUserId: "u1",
    revision: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...document,
  };
};

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

async function openSeoPanel() {
  useEditorStore.getState().loadFromProject(project());
  renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "SEO" }));
  return user;
}

const currentSeo = () => useEditorStore.getState().history.present.pages[0]?.seo;

describe("page SEO panel", () => {
  it("is a mode of the same right panel, not a separate screen", async () => {
    await openSeoPanel();
    expect(screen.getByRole("tab", { name: "SEO" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("group", { name: "Page canvas" })).toBeInTheDocument();
  });

  it("edits the title and description of the current page", async () => {
    const user = await openSeoPanel();

    await user.type(screen.getByLabelText("SEO title"), "About us");
    await user.type(screen.getByLabelText("Meta description"), "Who we are.");

    expect(currentSeo()?.title).toBe("About us");
    expect(currentSeo()?.description).toBe("Who we are.");
  });

  it("previews the resolved title through the shared resolver, including the site template", async () => {
    const user = await openSeoPanel();
    await user.type(screen.getByLabelText("SEO title"), "About us");

    const preview = screen.getByText("Search result preview").closest("div");
    expect(preview).not.toBeNull();
    expect(within(preview!).getByText("About us | Acme")).toBeInTheDocument();
    expect(within(preview!).getByText("https://acme.example/")).toBeInTheDocument();
  });

  it("falls back to the site description in the preview when the page has none", async () => {
    await openSeoPanel();
    const preview = screen.getByText("Search result preview").closest("div");
    expect(within(preview!).getByText("A site about things that matter.")).toBeInTheDocument();
  });

  it("labels the preview as advisory rather than a promise about ranking", async () => {
    await openSeoPanel();
    expect(screen.getByText(/Appearance is decided by search engines/)).toBeInTheDocument();
  });

  it("toggles indexing and following independently", async () => {
    const user = await openSeoPanel();
    await user.click(screen.getByRole("button", { name: /Advanced/ }));

    await user.click(screen.getByLabelText("Allow search engines to index this page"));
    expect(currentSeo()?.robots.index).toBe(false);
    expect(currentSeo()?.robots.follow).toBe(true);
  });

  it("states that the checks do not predict ranking", async () => {
    const user = await openSeoPanel();
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(screen.getByText(/do not predict search ranking/)).toBeInTheDocument();
  });

  it("groups an editing burst into one undo step", async () => {
    const user = await openSeoPanel();
    const before = useEditorStore.getState().history.past.length;

    await user.type(screen.getByLabelText("SEO title"), "About");
    await user.tab();

    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
  });

  it("renders in Portuguese", async () => {
    useEditorStore.getState().loadFromProject(project());
    renderWithProviders(<EditorShell workspaceId="w1" projectId="aaaaaaaaaaaaaaaaaaaaaaaa" />, { locale: "pt-BR" });

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "SEO" }));
    expect(screen.getByLabelText("Título de SEO")).toBeInTheDocument();
  });
});
