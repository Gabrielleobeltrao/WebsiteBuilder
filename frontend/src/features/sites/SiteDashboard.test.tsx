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

/**
 * Where everything in a site is.
 *
 * The dashboard used to answer that with two lists under different rules: a row of pills for what
 * every site has, and below it a second list that only showed a module once it was already in use —
 * with the way to *start* one reduced to a sentence of underlined words beneath. So the answer to
 * "where is the blog" was a footer link, on a site with no blog yet, which is exactly the site whose
 * owner is asking.
 */
describe("the destination grid", () => {
  const grid = async () => screen.findByRole("navigation", { name: "Everything in this site" });

  it("shows the blog on an untouched site, as a card rather than a footer link", async () => {
    mockStatus([feature({ feature: "blog" }), feature({ feature: "forms" }), feature({ feature: "cms" })]);
    render();

    const blog = within(await grid()).getByRole("link", { name: /Blog/ });
    expect(blog).toHaveAttribute("href", "/app/w1/sites/p1/blog");
    // Said on the card, not by being missing from it: absence is what sent people hunting for a URL.
    expect(blog).toHaveTextContent("Not in use yet");
  });

  it("carries the module's server-decided state once it is in use", async () => {
    mockStatus([feature({ feature: "blog", lifecycle: "draft", draftReferenceCount: 1 })]);
    render();

    const blog = within(await grid()).getByRole("link", { name: /Blog/ });
    expect(blog).toHaveTextContent("Draft");
    expect(blog).not.toHaveTextContent("Not in use yet");
  });

  it("keeps an archived module reachable, because its records outlived its last page", async () => {
    mockStatus([feature({ feature: "blog", lifecycle: "archived" })]);
    render();

    // Archived means "no page references it any more", not "its posts are gone".
    expect(within(await grid()).getByRole("link", { name: /Blog/ })).toBeInTheDocument();
  });

  it("badges a module that needs setup", async () => {
    mockStatus([feature({ feature: "forms", lifecycle: "needs_setup", draftReferenceCount: 1, blockingIssueCount: 1 })]);
    render();

    expect(within(await grid()).getByText("Setup required")).toBeInTheDocument();
  });

  it("lists every destination this build actually serves", async () => {
    mockStatus([feature({ feature: "blog" }), feature({ feature: "forms" }), feature({ feature: "cms" })]);
    render();

    const links = within(await grid()).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/app/w1/sites/p1/builder",
      "/app/w1/sites/p1/blog",
      "/app/w1/sites/p1/forms",
      "/app/w1/sites/p1/cms",
      "/app/w1/sites/p1/media",
      "/app/w1/sites/p1/analytics",
      "/app/w1/sites/p1/settings/domains",
    ]);
  });

  it("offers no card for a module with nowhere to go", async () => {
    mockStatus([feature({ feature: "search", lifecycle: "draft", draftReferenceCount: 1 })]);
    render();

    // A card leading to a route this build does not serve is worse than no card.
    expect(within(await grid()).queryByRole("link", { name: /Search/ })).toBeNull();
  });

  it("puts the blog above the site's own settings", async () => {
    mockStatus([feature({ feature: "blog" })]);
    render();

    const blog = within(await grid()).getByRole("link", { name: /Blog/ });
    const rename = screen.getByRole("button", { name: "Rename" });
    // Somebody looking for the blog must not have to scroll past Delete to find it.
    expect(blog.compareDocumentPosition(rename) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/**
 * The two things somebody opens this page to do.
 *
 * Publishing was a pill in a row of six, weighted exactly like Domains — so the action that puts a
 * change in front of visitors looked like the one nobody uses twice a year.
 */
describe("the top actions", () => {
  it("offers editing and publishing before anything else", async () => {
    mockStatus([]);
    render();

    expect(await screen.findByRole("link", { name: "Edit site" })).toHaveAttribute(
      "href",
      "/app/w1/sites/p1/builder",
    );
    expect(screen.getByRole("link", { name: "Publish changes" })).toHaveAttribute(
      "href",
      "/app/w1/sites/p1/publish",
    );
  });

  it("emphasises publishing while a visitor is behind, and editing when they are not", async () => {
    mockStatus([], { pendingPublication: true, activeSourceRevision: 3 });
    const { unmount } = render();
    expect((await screen.findByRole("link", { name: "Publish changes" })).className).toContain("bg-accent-600");
    expect(screen.getByRole("link", { name: "Edit site" }).className).not.toContain("bg-accent-600");
    unmount();

    mockStatus([], { pendingPublication: false, activeSourceRevision: 4 });
    render();
    expect((await screen.findByRole("link", { name: "Edit site" })).className).toContain("bg-accent-600");
    expect(screen.getByRole("link", { name: "Publish changes" }).className).not.toContain("bg-accent-600");
  });

  it("says whether visitors have this work, from the revision the live snapshot was built from", async () => {
    mockStatus([], { pendingPublication: true, activeSourceRevision: 3 });
    render();
    expect(await screen.findByText(/visitors have not received yet/)).toBeInTheDocument();
  });

  it("says a site has never been published rather than calling it out of date", async () => {
    mockStatus([], { pendingPublication: false, activeSourceRevision: null });
    render();
    expect(await screen.findByText(/never been published/)).toBeInTheDocument();
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

describe("a module that is on and healthy", () => {
  it("says it is ready rather than demanding setup that does not exist", async () => {
    // Turning the blog on used to land it in needs_setup whatever its state, so it read "Setup
    // required" forever while naming no action — because there was none to name.
    mockStatus([feature({ feature: "blog", lifecycle: "ready" })]);
    render();

    const grid = await screen.findByRole("navigation", { name: "Everything in this site" });
    const row = within(grid).getByRole("link", { name: /Blog/ });
    expect(row).toHaveTextContent("Ready");
    expect(row).not.toHaveTextContent("Setup required");
  });
});

/**
 * The same page on a phone, a tablet and a desktop.
 *
 * The grid is one column, then two, then three — asserted through the classes that decide it,
 * because jsdom has no layout engine and a screenshot test would answer a different question. What
 * matters here is that nothing is pinned to a width a phone does not have.
 */
describe("across widths", () => {
  it("goes from one column to three without a fixed width anywhere", async () => {
    mockStatus([feature({ feature: "blog" })]);
    render();

    const grid = (await screen.findByRole("navigation", { name: "Everything in this site" })).querySelector("ul")!;
    expect(grid.className).toContain("sm:grid-cols-2");
    expect(grid.className).toContain("lg:grid-cols-3");
    // A phone gets the single-column default rather than a min-width that forces sideways scrolling.
    expect(grid.className).not.toMatch(/\bw-\[\d/);
  });

  it("lets the top actions wrap instead of pushing the page sideways", async () => {
    mockStatus([]);
    render();

    const actions = (await screen.findByRole("link", { name: "Edit site" })).parentElement!;
    expect(actions.className).toContain("flex-wrap");
  });

  it("separates the site's own settings from the destinations", async () => {
    mockStatus([]);
    render();

    // Renaming and deleting are not destinations, and a delete button among them is one mis-tap
    // from losing the site.
    const settings = (await screen.findByRole("button", { name: "Delete" })).closest("section")!;
    expect(settings.className).toContain("border-t");
    expect(within(settings).queryByRole("link", { name: /Blog/ })).toBeNull();
  });
});

describe("localization of the grid", () => {
  it("names every destination in Portuguese", async () => {
    mockStatus([feature({ feature: "blog" }), feature({ feature: "forms" }), feature({ feature: "cms" })]);
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

    const grid = await screen.findByRole("navigation", { name: "Tudo neste site" });
    for (const name of ["Páginas", "Blog", "Formulários", "CMS", "Mídia", "Análises", "Domínios"]) {
      expect(within(grid).getByText(name), name).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Publicar alterações" })).toBeInTheDocument();
  });
});
