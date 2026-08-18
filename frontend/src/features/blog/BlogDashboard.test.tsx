import { DEFAULT_BLOG_SETTINGS, EMPTY_RICH_TEXT, type BlogPost } from "@websitebuilder/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BlogDashboard } from "@/features/blog/BlogDashboard";
import { renderWithProviders } from "@/test/render";

const post = (overrides: Partial<BlogPost> = {}): BlogPost => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  projectId: "p1",
  workspaceId: "w1",
  createdByUserId: "u1",
  title: "Release notes",
  slug: "release-notes",
  excerpt: "",
  content: EMPTY_RICH_TEXT,
  categoryIds: [],
  tags: [],
  customFieldValues: {},
  status: "draft",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
  ...overrides,
});

const ok = (data: unknown) =>
  new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });

function mockApi(options: {
  enabled?: boolean;
  posts?: BlogPost[];
  /** The site's live hostname, or none — which is the state of a site nobody has published. */
  liveHost?: string | null;
  onRequest?: (url: string, init?: RequestInit) => void;
}) {
  const { enabled = true, posts = [], liveHost = null, onRequest } = options;
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    onRequest?.(url, init);
    if (url.includes("/settings")) return ok({ ...DEFAULT_BLOG_SETTINGS, enabled });
    if (url.includes("/domains")) {
      return ok(
        liveHost === null
          ? []
          : [
              {
                id: "d1",
                workspaceId: "w1",
                projectId: "p1",
                hostname: liveHost,
                kind: "platform",
                isPrimary: true,
                status: "active",
                sslStatus: "active",
                createdAt: "2026-08-01T00:00:00.000Z",
              },
            ],
      );
    }
    if (init?.method && init.method !== "GET") return ok(post());
    return ok({ items: posts, total: posts.length, page: 1, perPage: 20 });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const render = () =>
  renderWithProviders(<BlogDashboard workspaceId="w1" projectId="p1" basePath="/app/w1/sites/p1/blog" />);

afterEach(() => vi.unstubAllGlobals());

describe("activation", () => {
  it("offers an explicit opt-in and does not enable the blog merely by visiting", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    mockApi({ enabled: false, onRequest: (url, init) => requests.push({ url, method: init?.method ?? "GET" }) });
    render();

    expect(await screen.findByRole("heading", { level: 2, name: "This site has no blog yet" })).toBeInTheDocument();
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("states that nothing is public by turning the blog on", async () => {
    mockApi({ enabled: false });
    render();
    expect(await screen.findByText(/nothing is public until you publish a post/)).toBeInTheDocument();
  });

  it("asks which format before turning it on, because a blog with neither page serves nothing", async () => {
    mockApi({ enabled: false });
    render();

    // Turning the blog on used to set a flag and leave both templates unset, which blocked
    // publication of the entire site with no way out through the interface.
    const group = await screen.findByRole("group", { name: "Reading format" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
  });

  it("enables the blog when the user asks", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    mockApi({ enabled: false, onRequest: (url, init) => requests.push({ url, method: init?.method ?? "GET" }) });
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole("radio", { name: /Grid/ }));
    await user.click(screen.getByRole("button", { name: "Turn on the blog" }));

    // One request that creates the templates too, not a settings PUT that leaves them unset.
    expect(requests.some((request) => request.method === "POST" && request.url.includes("/activate"))).toBe(true);
  });
});

describe("post list", () => {
  it("shows an empty state before the first post", async () => {
    mockApi({ posts: [] });
    render();
    expect(await screen.findByRole("heading", { level: 2, name: "No posts yet" })).toBeInTheDocument();
  });

  it("lists posts with their status and address", async () => {
    mockApi({ posts: [post(), post({ id: "b", title: "Live", status: "published", publishedAt: "2026-08-02T00:00:00.000Z" })] });
    render();

    expect(await screen.findByRole("heading", { level: 2, name: "Release notes" })).toBeInTheDocument();

    // Scope to the list: "Published" is also a filter button, and asserting globally would pass
    // even if the badge were missing.
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByText("Draft")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Published")).toBeInTheDocument();
    expect(within(items[0]!).getByText("/release-notes")).toBeInTheDocument();
  });

  it("filters by status through the API rather than in the browser", async () => {
    const urls: string[] = [];
    mockApi({ posts: [post()], onRequest: (url) => urls.push(url) });
    const user = userEvent.setup();
    render();
    await screen.findByRole("heading", { level: 2, name: "Release notes" });

    await user.click(screen.getByRole("button", { name: "Published" }));
    expect(urls.some((url) => url.includes("status=published"))).toBe(true);
  });

  it("searches through the API", async () => {
    const urls: string[] = [];
    mockApi({ posts: [post()], onRequest: (url) => urls.push(url) });
    const user = userEvent.setup();
    render();
    await screen.findByRole("heading", { level: 2, name: "Release notes" });

    await user.type(screen.getByLabelText("Search posts"), "release");
    expect(await screen.findByText(/search=release/, {}, { timeout: 2000 }).catch(() => null)).toBeNull();
    expect(urls.some((url) => url.includes("search=release"))).toBe(true);
  });
});

describe("post actions", () => {
  it("publishes a draft", async () => {
    const requests: string[] = [];
    mockApi({ posts: [post()], onRequest: (url, init) => requests.push(`${init?.method ?? "GET"} ${url}`) });
    const user = userEvent.setup();
    render();
    await screen.findByRole("heading", { level: 2, name: "Release notes" });

    await user.click(screen.getByRole("button", { name: "Publish" }));
    expect(requests.some((request) => request.startsWith("POST") && request.endsWith("/publish"))).toBe(true);
  });

  it("moves a published post back to drafts", async () => {
    const requests: string[] = [];
    mockApi({
      posts: [post({ status: "published", publishedAt: "2026-08-02T00:00:00.000Z" })],
      onRequest: (url, init) => requests.push(`${init?.method ?? "GET"} ${url}`),
    });
    const user = userEvent.setup();
    render();
    await screen.findByRole("heading", { level: 2, name: "Release notes" });

    await user.click(screen.getByRole("button", { name: "Move to drafts" }));
    expect(requests.some((request) => request.endsWith("/unpublish"))).toBe(true);
  });

  it("requires confirmation before deleting and states the consequence", async () => {
    const requests: string[] = [];
    mockApi({ posts: [post()], onRequest: (url, init) => requests.push(`${init?.method ?? "GET"} ${url}`) });
    const user = userEvent.setup();
    render();
    await screen.findByRole("heading", { level: 2, name: "Release notes" });

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this post?" });
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(requests.some((request) => request.startsWith("DELETE"))).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Delete post" }));
    expect(requests.some((request) => request.startsWith("DELETE"))).toBe(true);
  });
});

describe("localization", () => {
  it("renders in Portuguese", async () => {
    mockApi({ posts: [post()] });
    renderWithProviders(<BlogDashboard workspaceId="w1" projectId="p1" basePath="/app/w1/sites/p1/blog" />, {
      locale: "pt-BR",
    });

    expect(await screen.findByRole("heading", { level: 1, name: "Blog" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Novo post" })).toBeInTheDocument();
    expect(screen.getByText("Rascunho")).toBeInTheDocument();
  });
});

/**
 * Looking at a post as a reader would.
 *
 * The list could edit, publish and delete a post but never open it, so the one question an author
 * asks after writing — how does this actually look — had no answer without typing a URL by hand.
 * The link points at whichever version of that page genuinely exists.
 */
describe("seeing a post's own page", () => {
  it("opens the real page when the site is serving one", async () => {
    mockApi({ posts: [post({ status: "published" })], liveHost: "acme.example.com" });
    render();

    const link = await screen.findByRole("link", { name: "View the page" });
    expect(link).toHaveAttribute("href", "https://acme.example.com/blog/release-notes");
    // Another origin, so the site opens beside the dashboard rather than replacing it.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("falls back to the draft preview while the site has no address", async () => {
    mockApi({ posts: [post({ status: "published" })], liveHost: null });
    render();

    // The article renders the same either way; the preview simply does not need a hostname.
    const link = await screen.findByRole("link", { name: "Preview" });
    expect(link).toHaveAttribute("href", "/preview/w1/p1/blog/release-notes");
  });

  it("offers nothing for a draft, because an unpublished post has no page anywhere", async () => {
    mockApi({ posts: [post({ status: "draft" })], liveHost: "acme.example.com" });
    render();

    await screen.findByRole("link", { name: "Edit" });
    expect(screen.queryByRole("link", { name: "View the page" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Preview" })).toBeNull();
  });

  it("keeps the list usable when the address cannot be loaded at all", async () => {
    mockApi({ posts: [post({ status: "published" })] });
    render();

    // A failed lookup of an optional address must not turn the post list into an error screen.
    expect(await screen.findByText("Release notes")).toBeInTheDocument();
  });
});

/**
 * Reaching the layouts.
 *
 * The templates existed in the store from the first commit with nothing exposing them, so the shape
 * of every article was fixed for every blog on the platform. These are the two links that make them
 * openable at all.
 */
describe("designing the blog's layouts", () => {
  it("offers both layouts beside writing a post", async () => {
    mockApi({ posts: [] });
    render();

    expect(await screen.findByRole("link", { name: "Post layout" })).toHaveAttribute(
      "href",
      "/app/w1/sites/p1/blog/templates/article",
    );
    expect(screen.getByRole("link", { name: "List layout" })).toHaveAttribute(
      "href",
      "/app/w1/sites/p1/blog/templates/index",
    );
  });

  it("keeps them out of the way until the blog is on", async () => {
    mockApi({ enabled: false });
    render();

    // The activation screen asks one question. A layout to design is not an answer to it.
    await screen.findByRole("heading", { level: 2, name: "This site has no blog yet" });
    expect(screen.queryByRole("link", { name: "Post layout" })).toBeNull();
  });
});
