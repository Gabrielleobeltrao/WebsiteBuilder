import type { SiteFeatureState } from "@websitebuilder/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SiteDashboard } from "@/features/sites/SiteDashboard";
import { renderWithProviders } from "@/test/render";

const feature = (overrides: Partial<SiteFeatureState>): SiteFeatureState => ({
  feature: "blog",
  lifecycle: "unused",
  draftReferenceCount: 0,
  publishedReferenceCount: 0,
  blockingIssueCount: 0,
  warningCount: 0,
  sourceRevision: 4,
  ...overrides,
});

function mockStatus(features: SiteFeatureState[], overrides: Record<string, unknown> = {}) {
  const blocked = features.some((f) => f.lifecycle !== "unused" && f.lifecycle !== "archived" && f.blockingIssueCount > 0);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              projectId: "p1",
              revision: 4,
              features,
              blocked,
              blockingIssueCount: blocked ? 1 : 0,
              warningCount: 0,
              ...overrides,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ),
  );
}

const render = () =>
  renderWithProviders(
    <SiteDashboard
      workspaceId="w1"
      projectId="p1"
      projectName="Acme Studio"
      pageCount={3}
      updatedAt="2026-08-05T00:00:00.000Z"
    />,
  );

afterEach(() => vi.unstubAllGlobals());

describe("contextual module navigation", () => {
  it("shows no optional module for an untouched site, but offers a way into each", async () => {
    mockStatus([feature({ feature: "blog" }), feature({ feature: "forms" }), feature({ feature: "cms" })]);
    render();

    const optional = await screen.findByRole("navigation", { name: "Modules" });
    expect(within(optional).getByText(/No optional modules are in use yet/)).toBeInTheDocument();

    /*
     * Not in the permanent navigation, and not unreachable either.
     *
     * The blog could only be turned on from its own page, and nothing anywhere linked to that page —
     * so turning it on required knowing the URL. An untouched module keeps out of the navigation
     * and still has a door.
     */
    expect(within(optional).getByRole("link", { name: /Blog/ })).toHaveAttribute(
      "href",
      "/app/w1/sites/p1/blog",
    );
  });

  it("reveals a module once the server says it is in use", async () => {
    mockStatus([feature({ feature: "blog", lifecycle: "draft", draftReferenceCount: 1 })]);
    render();

    const optional = await screen.findByRole("navigation", { name: "Modules" });
    expect(within(optional).getByRole("link", { name: /Blog/ })).toHaveAttribute(
      "href",
      "/app/w1/sites/p1/blog",
    );
  });

  it("keeps an archived module reachable, because its records outlived its last page", async () => {
    mockStatus([feature({ feature: "blog", lifecycle: "archived" })]);
    render();

    // Archived means "no page references it any more", not "its posts are gone". Hiding the entry
    // was hiding the only way to reach them.
    const optional = await screen.findByRole("navigation", { name: "Modules" });
    expect(within(optional).getByRole("link", { name: /Blog/ })).toBeInTheDocument();
  });

  it("badges a module that needs setup", async () => {
    mockStatus([feature({ feature: "forms", lifecycle: "needs_setup", draftReferenceCount: 1, blockingIssueCount: 1 })]);
    render();

    const optional = await screen.findByRole("navigation", { name: "Modules" });
    expect(within(optional).getByText("Setup required")).toBeInTheDocument();
  });

  it("keeps core navigation present regardless of module state", async () => {
    mockStatus([]);
    render();
    const core = await screen.findByRole("navigation", { name: "Site" });
    expect(within(core).getByRole("link", { name: "Pages" })).toBeInTheDocument();
  });
});

describe("site status", () => {
  it("states plainly that nothing blocks publication", async () => {
    mockStatus([feature({ feature: "blog", lifecycle: "draft", draftReferenceCount: 1 })]);
    render();
    expect(await screen.findByText("Nothing is blocking publication.")).toBeInTheDocument();
  });

  it("is persistent and states the blocker count when setup is incomplete", async () => {
    mockStatus([feature({ feature: "forms", lifecycle: "needs_setup", draftReferenceCount: 1, blockingIssueCount: 1 })]);
    render();

    expect(await screen.findByText("Finish setup before publishing.")).toBeInTheDocument();
    expect(screen.getByText("1 issue")).toBeInTheDocument();
  });

  it("shows a localized error with a retry when the status cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "down" } }), { status: 503 }),
      ),
    );
    render();

    expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("localization", () => {
  it("renders in Portuguese", async () => {
    mockStatus([feature({ feature: "blog", lifecycle: "draft", draftReferenceCount: 1 })]);
    renderWithProviders(
      <SiteDashboard
        workspaceId="w1"
        projectId="p1"
        projectName="Acme"
        pageCount={2}
        updatedAt="2026-08-05T00:00:00.000Z"
      />,
      { locale: "pt-BR" },
    );

    expect(await screen.findByRole("link", { name: "Editar site" })).toBeInTheDocument();
    expect(screen.getByText("Nada está bloqueando a publicação.")).toBeInTheDocument();
  });
});

describe("the site's own settings", () => {
  it("keeps renaming and deleting here rather than on the list", async () => {
    // On the list they sat beside Open, on every row — a destructive action one mis-tap from the
    // button people press most, which on a phone is the same few millimetres.
    mockStatus([]);
    render();

    expect(await screen.findByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("states the consequence and asks before deleting", async () => {
    mockStatus([]);
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole("button", { name: "Delete" }));

    const dialog = screen.getByRole("dialog", { name: "Delete this site?" });
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it("closes on Escape without doing anything", async () => {
    mockStatus([]);
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers the current name to rename from", async () => {
    mockStatus([]);
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole("button", { name: "Rename" }));

    expect(screen.getByLabelText("Site name")).toHaveValue("Acme Studio");
  });
});
