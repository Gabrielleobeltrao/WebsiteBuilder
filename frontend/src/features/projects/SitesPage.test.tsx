import type { ProjectSummary } from "@websitebuilder/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SitesPage } from "@/features/projects/SitesPage";
import { renderWithProviders } from "@/test/render";

const summary = (overrides: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  name: "Acme Studio",
  slug: "acme-studio",
  pageCount: 3,
  revision: 4,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-10T10:00:00.000Z",
  isPublished: false,
  ...overrides,
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } });

const fail = (code: string, status: number) =>
  new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SitesPage states", () => {
  it("shows a loading state, then the list", async () => {
    mockFetch(() => ok([summary()]));
    renderWithProviders(<SitesPage workspaceId="w1" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading sites…");
    expect(await screen.findByRole("heading", { level: 2, name: "Acme Studio" })).toBeInTheDocument();
    // Collapsed: a name and one honest word about where the site is. The counts are a disclosure away.
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("shows an empty state rather than a blank page", async () => {
    mockFetch(() => ok([]));
    renderWithProviders(<SitesPage workspaceId="w1" />);
    expect(await screen.findByRole("heading", { level: 2, name: "No sites yet" })).toBeInTheDocument();
  });

  it("shows a localized error message and lets the user retry", async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      return calls === 1 ? fail("SERVICE_UNAVAILABLE", 503) : ok([summary()]);
    });
    const user = userEvent.setup();
    renderWithProviders(<SitesPage workspaceId="w1" />);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/temporarily unavailable/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Acme Studio" })).toBeInTheDocument();
  });

  it("scopes every request to the workspace in the URL", async () => {
    const spy = mockFetch(() => ok([]));
    renderWithProviders(<SitesPage workspaceId="w with space" />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]?.[0])).toBe("/api/v1/workspaces/w%20with%20space/projects");
  });
});

describe("SitesPage actions", () => {
  it("creates a site and reloads the list", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    mockFetch((url, init) => {
      requests.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "POST") return ok({ id: "x", name: "New site" }, 201);
      return ok(requests.some((r) => r.method === "POST") ? [summary({ name: "New site" })] : []);
    });

    const user = userEvent.setup();
    renderWithProviders(<SitesPage workspaceId="w1" />);
    await screen.findByRole("heading", { level: 2, name: "No sites yet" });

    await user.click(screen.getByRole("button", { name: "New site" }));
    const dialog = screen.getByRole("dialog", { name: "Name the site" });
    await user.type(within(dialog).getByLabelText("Site name"), "New site");
    await user.click(within(dialog).getByRole("button", { name: "Create site" }));

    expect(await screen.findByRole("heading", { level: 2, name: "New site" })).toBeInTheDocument();
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("does not submit an empty name", async () => {
    const spy = mockFetch(() => ok([]));
    const user = userEvent.setup();
    renderWithProviders(<SitesPage workspaceId="w1" />);
    await screen.findByRole("heading", { level: 2, name: "No sites yet" });

    await user.click(screen.getByRole("button", { name: "New site" }));
    await user.click(screen.getByRole("button", { name: "Create site" }));

    expect(spy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
  });
});

describe("SitesPage localization", () => {
  it("renders in Portuguese including pluralisation", async () => {
    mockFetch(() => ok([summary({ pageCount: 1 }), summary({ id: "b", name: "Outro", pageCount: 5 })]));
    renderWithProviders(<SitesPage workspaceId="w1" />, { locale: "pt-BR" });

    expect(await screen.findByRole("heading", { level: 1, name: "Sites" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo site" })).toBeInTheDocument();

    const user = userEvent.setup();
    for (const name of ["Acme Studio", "Outro"]) {
      await user.click(screen.getByRole("button", { name: `Detalhes de ${name}` }));
    }
    expect(screen.getByText(/1 página/)).toBeInTheDocument();
    expect(screen.getByText(/5 páginas/)).toBeInTheDocument();
  });
});

describe("finding a site from the list", () => {
  it("offers the site's own page as a button, not only as its name", async () => {
    mockFetch(() => ok([summary()]));
    renderWithProviders(<SitesPage workspaceId="w1" />);

    // Everything that is not a page — the blog, forms, the CMS — is reached through here, and an
    // underlined title was a link people looked straight past while asking where the blog was.
    const panel = await screen.findByRole("link", { name: "Dashboard" });
    expect(panel).toHaveAttribute("href", "/app/w1/sites/aaaaaaaaaaaaaaaaaaaaaaaa/dashboard");

    // The name keeps working: this adds a way in rather than moving the one that existed.
    expect(screen.getByRole("link", { name: "Acme Studio" })).toHaveAttribute(
      "href",
      "/app/w1/sites/aaaaaaaaaaaaaaaaaaaaaaaa/dashboard",
    );
  });

  /** Opens one card's disclosure and hands back the panel it revealed. */
  async function disclose(name = "Acme Studio") {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `Details for ${name}` }));
    return user;
  }

  it("opens the published address in one tap, from the disclosure", async () => {
    mockFetch(() => ok([summary({ liveUrl: "https://acme-studio.example.com" })]));
    renderWithProviders(<SitesPage workspaceId="w1" />);
    await disclose();

    const visit = screen.getByRole("link", { name: "Visit site" });
    expect(visit).toHaveAttribute("href", "https://acme-studio.example.com");
    // Another origin, so the site opens beside the dashboard rather than replacing it.
    expect(visit).toHaveAttribute("target", "_blank");
    expect(visit.getAttribute("rel")).toContain("noopener");
  });

  it("offers no address for a site that is not serving one", async () => {
    // A button to a page that does not exist yet is worse than no button: it teaches a customer
    // that the product is broken when what happened is that they have not published.
    mockFetch(() => ok([summary()]));
    renderWithProviders(<SitesPage workspaceId="w1" />);
    await disclose();

    expect(screen.queryByRole("link", { name: "Visit site" })).toBeNull();
  });

  it("keeps destructive actions off the list, open or closed", async () => {
    // Delete beside Open, on every row, is one mis-tap from losing a site — and on a phone it sits
    // next to the button people press most. It lives on the site's own settings now.
    mockFetch(() => ok([summary()]));
    renderWithProviders(<SitesPage workspaceId="w1" />);
    await disclose();

    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("says a published site with no address needs attention, not that it is unpublished", async () => {
    // The state that used to read "Not published yet" after a successful publish. Publishing again
    // does not fix a missing address, so sending someone back to publish would waste their time.
    mockFetch(() =>
      ok([
        summary({
          isPublished: true,
          summary: { publicationState: "up-to-date", knownBlockers: ["no-address"], traffic: { state: "measured", days: 30, views: 0, visitors: null } },
        }),
      ]),
    );
    renderWithProviders(<SitesPage workspaceId="w1" />);

    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).toBeNull();

    await disclose();
    expect(screen.getByText(/no address points at it yet/)).toBeInTheDocument();
  });

  it("offers publishing from the disclosure, because it is needed after every edit", async () => {
    mockFetch(() => ok([summary()]));
    renderWithProviders(<SitesPage workspaceId="w1" />);
    await disclose();

    expect(screen.getByRole("link", { name: "Publish" })).toHaveAttribute(
      "href",
      "/app/w1/sites/aaaaaaaaaaaaaaaaaaaaaaaa/publish",
    );
  });

  it("keeps one emphasised action on a collapsed card, and it is the dashboard", async () => {
    // Four buttons on every row is forty controls in a list of ten sites, and on a phone they wrap
    // into a block taller than the card. Everything else is reached through the one destination.
    mockFetch(() => ok([summary({ liveUrl: "https://acme-studio.example.com" })]));
    renderWithProviders(<SitesPage workspaceId="w1" />);

    const card = (await screen.findByRole("heading", { level: 2, name: "Acme Studio" })).closest("li")!;
    const visible = within(card)
      .getAllByRole("link")
      .filter((link) => link.closest("[hidden]") === null);

    expect(visible.map((link) => link.textContent)).toEqual(["Acme Studio", "Dashboard"]);
    expect(within(card).getByRole("link", { name: "Dashboard" }).className).toContain("bg-accent-600");
  });

  it("shows the site's own page as a link a touch device can see", async () => {
    mockFetch(() => ok([summary()]));
    // Underlined always rather than on hover: a phone has no hover, and a link that reveals itself
    // only to a pointer is invisible to everyone holding one of these.
    renderWithProviders(<SitesPage workspaceId="w1" />);

    const name = await screen.findByRole("link", { name: "Acme Studio" });
    expect(name).toHaveAttribute("href", "/app/w1/sites/aaaaaaaaaaaaaaaaaaaaaaaa/dashboard");
    expect(name.className).toContain("underline");
    expect(name.className).not.toContain("hover:underline");
  });
});

/**
 * The disclosure itself.
 *
 * It carries everything the card used to shout, so the two things that decide whether it is usable
 * at all are the ones asserted here: it can be operated without a pointer, and what it says is
 * announced rather than merely drawn.
 */
describe("the card's disclosure", () => {
  const measured = (overrides: Partial<ProjectSummary["summary"] & object> = {}) =>
    summary({
      isPublished: true,
      liveUrl: "https://acme-studio.example.com",
      summary: {
        publicationState: "pending",
        knownBlockers: [],
        traffic: { state: "measured", days: 30, views: 120, visitors: 45 },
        ...overrides,
      },
    });

  it("is closed to begin with, and says so where a screen reader can hear it", async () => {
    mockFetch(() => ok([measured()]));
    renderWithProviders(<SitesPage workspaceId="w1" />);

    const toggle = await screen.findByRole("button", { name: "Details for Acme Studio" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toHaveAttribute("hidden");
  });

  it("opens from the keyboard alone", async () => {
    mockFetch(() => ok([measured()]));
    renderWithProviders(<SitesPage workspaceId="w1" />);
    const user = userEvent.setup();

    const toggle = await screen.findByRole("button", { name: "Details for Acme Studio" });
    toggle.focus();
    await user.keyboard("{Enter}");

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).not.toHaveAttribute("hidden");
  });

  it("states what the request already measured, without asking again", async () => {
    const fetchSpy = mockFetch(() => ok([measured()]));
    renderWithProviders(<SitesPage workspaceId="w1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Details for Acme Studio" }));

    expect(screen.getByText("120 views")).toBeInTheDocument();
    expect(screen.getByText("45 visitors")).toBeInTheDocument();
    expect(screen.getByText(/the live site is behind the draft/)).toBeInTheDocument();
    // One request for the whole list, and opening a card is not a second one.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("labels visitors nobody is measuring as unmeasured rather than as zero", async () => {
    mockFetch(() => ok([measured({ traffic: { state: "measured", days: 30, views: 8, visitors: null } })]));
    renderWithProviders(<SitesPage workspaceId="w1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Details for Acme Studio" }));

    expect(screen.getByText("Visitors are not being measured")).toBeInTheDocument();
    expect(screen.queryByText("0 visitors")).toBeNull();
  });

  it("says nothing was measured at all on a site that was never published", async () => {
    mockFetch(() =>
      ok([summary({ summary: { publicationState: "up-to-date", knownBlockers: [], traffic: { state: "unavailable" } } })]),
    );
    renderWithProviders(<SitesPage workspaceId="w1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Details for Acme Studio" }));

    expect(screen.getByText(/never been published/)).toBeInTheDocument();
    expect(screen.queryByText("0 views")).toBeNull();
  });

  it("admits that the blockers it lists are only the ones it checked", async () => {
    mockFetch(() => ok([measured({ knownBlockers: [] })]));
    renderWithProviders(<SitesPage workspaceId="w1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Details for Acme Studio" }));

    // A list cannot run the full pre-publish audit for every site without loading every document.
    // Claiming a clean bill of health from a partial check would be the more expensive lie.
    expect(screen.getByText("None found in this list")).toBeInTheDocument();
    expect(screen.getByText(/full check/)).toBeInTheDocument();
  });

  it("renders on a phone without pushing the card sideways", async () => {
    mockFetch(() => ok([measured()]));
    renderWithProviders(<SitesPage workspaceId="w1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Details for Acme Studio" }));

    // The panel is a one-column grid until there is room for two, and the row above it wraps.
    const card = screen.getByRole("heading", { level: 2, name: "Acme Studio" }).closest("li")!;
    expect(card.querySelector("dl")?.className).toContain("sm:grid-cols-2");
    expect(card.querySelector("div")?.className).toContain("flex-wrap");
  });
});

/**
 * What the disclosure says about unpublished work.
 *
 * The number behind it now covers posts, blog settings and layouts as well as the document, so the
 * card and the site's own dashboard answer the same question the same way. The sentence has to stay
 * true in the one case where "behind the live site" is meaningless.
 */
describe("unpublished work on a card", () => {
  it("says everything is waiting when the site has never been published", async () => {
    mockFetch(() =>
      ok([summary({ summary: { publicationState: "pending", knownBlockers: [], traffic: { state: "unavailable" } } })]),
    );
    renderWithProviders(<SitesPage workspaceId="w1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Details for Acme Studio" }));

    expect(screen.getByText("Everything is waiting for a first publication")).toBeInTheDocument();
    expect(screen.queryByText(/behind the draft/)).toBeNull();
  });

  it("says the live site is behind once there is a live site", async () => {
    mockFetch(() =>
      ok([
        summary({
          isPublished: true,
          summary: {
            publicationState: "pending",
            knownBlockers: [],
            traffic: { state: "measured", days: 30, views: 1, visitors: null },
          },
        }),
      ]),
    );
    renderWithProviders(<SitesPage workspaceId="w1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Details for Acme Studio" }));

    expect(screen.getByText(/behind the draft/)).toBeInTheDocument();
  });
});
