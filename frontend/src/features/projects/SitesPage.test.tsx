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
    expect(screen.getByText(/3 pages/)).toBeInTheDocument();
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
    expect(screen.getByText(/1 página/)).toBeInTheDocument();
    expect(screen.getByText(/5 páginas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo site" })).toBeInTheDocument();
  });
});

describe("finding a site from the list", () => {
  it("opens the published address in one tap", async () => {
    mockFetch(() => ok([summary({ liveUrl: "https://acme-studio.example.com" })]));
    renderWithProviders(<SitesPage workspaceId="w1" />);

    const visit = await screen.findByRole("link", { name: "Visit site" });
    expect(visit).toHaveAttribute("href", "https://acme-studio.example.com");
    // Another origin, so the site opens beside the dashboard rather than replacing it.
    expect(visit).toHaveAttribute("target", "_blank");
    expect(visit.getAttribute("rel")).toContain("noopener");
  });

  it("shows the address, because it is what a customer types and shares", async () => {
    mockFetch(() => ok([summary({ liveUrl: "https://acme-studio.example.com" })]));
    renderWithProviders(<SitesPage workspaceId="w1" />);

    expect(await screen.findByText(/acme-studio\.example\.com/)).toBeInTheDocument();
  });

  it("offers no address for a site that is not serving one", async () => {
    // A button to a page that does not exist yet is worse than no button: it teaches a customer
    // that the product is broken when what happened is that they have not published.
    mockFetch(() => ok([summary()]));
    renderWithProviders(<SitesPage workspaceId="w1" />);

    expect(await screen.findByText(/Not published yet/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Visit site" })).toBeNull();
  });

  it("keeps destructive actions off the list", async () => {
    // Delete beside Open, on every row, is one mis-tap from losing a site — and on a phone it sits
    // next to the button people press most. It lives on the site's own settings now.
    mockFetch(() => ok([summary()]));
    renderWithProviders(<SitesPage workspaceId="w1" />);

    await screen.findByRole("link", { name: "Publish" });
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("says a published site has no address rather than calling it unpublished", async () => {
    // The state that used to read "Not published yet" after a successful publish. Publishing again
    // does not fix a missing address, so sending someone back to publish would waste their time.
    mockFetch(() => ok([summary({ isPublished: true })]));
    renderWithProviders(<SitesPage workspaceId="w1" />);

    expect(await screen.findByText(/Published, but has no address yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Not published yet/)).toBeNull();
  });

  it("offers publishing from the card, because it is needed after every edit", async () => {
    mockFetch(() => ok([summary()]));
    renderWithProviders(<SitesPage workspaceId="w1" />);

    const publish = await screen.findByRole("link", { name: "Publish" });
    expect(publish).toHaveAttribute("href", "/app/w1/sites/aaaaaaaaaaaaaaaaaaaaaaaa/publish");
  });

  it("emphasises publishing while a site has never been live, and stops shouting once it is", async () => {
    // The one action that turns a site nobody can reach into one they can. Once it is reachable,
    // publishing is routine and the emphasis belongs elsewhere.
    mockFetch(() => ok([summary()]));
    const { unmount } = renderWithProviders(<SitesPage workspaceId="w1" />);
    expect((await screen.findByRole("link", { name: "Publish" })).className).toContain("bg-accent-600");
    unmount();

    mockFetch(() => ok([summary({ liveUrl: "https://acme-studio.example.com" })]));
    renderWithProviders(<SitesPage workspaceId="w1" />);
    expect((await screen.findByRole("link", { name: "Publish" })).className).not.toContain("bg-accent-600");
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
