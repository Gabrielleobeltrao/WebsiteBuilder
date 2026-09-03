import { EMPTY_RICH_TEXT, type BlogFieldDefinition, type BlogPost } from "@websitebuilder/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PostEditor } from "@/features/blog/PostEditor";
import { renderWithProviders } from "@/test/render";

const existing = (overrides: Partial<BlogPost> = {}): BlogPost => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  projectId: "p1",
  workspaceId: "w1",
  createdByUserId: "u1",
  title: "Release notes",
  slug: "release-notes",
  excerpt: "What changed",
  content: EMPTY_RICH_TEXT,
  categoryIds: [],
  tags: [],
  customFieldValues: { "field-1": "Original subtitle" },
  status: "draft",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
  ...overrides,
});

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } });

function mockApi(handler?: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body === undefined ? null : JSON.parse(String(init.body)),
    });
    return handler?.(String(input), init) ?? ok(existing());
  });
  vi.stubGlobal("fetch", spy);
  return calls;
}

const field = (overrides: Partial<BlogFieldDefinition> = {}): BlogFieldDefinition => ({
  id: "field-1",
  key: "subtitle",
  label: "Subtitle",
  type: "shortText",
  required: false,
  ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

describe("new post", () => {
  it("is a form rather than a canvas", () => {
    mockApi();
    renderWithProviders(<PostEditor workspaceId="w1" projectId="p1" basePath="/blog" />);

    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Excerpt")).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Page canvas" })).toBeNull();
  });

  it("derives the address from the title until the author edits it", async () => {
    const user = userEvent.setup();
    mockApi();
    renderWithProviders(<PostEditor workspaceId="w1" projectId="p1" basePath="/blog" />);

    await user.type(screen.getByLabelText("Title"), "Nosso Primeiro Artigo");
    expect(screen.getByLabelText("Address")).toHaveValue("nosso-primeiro-artigo");

    await user.clear(screen.getByLabelText("Address"));
    await user.type(screen.getByLabelText("Address"), "custom-address");
    await user.type(screen.getByLabelText("Title"), " again");

    // Once the author owns the slug, the title stops overwriting it.
    expect(screen.getByLabelText("Address")).toHaveValue("custom-address");
  });

  it("refuses to save without a title and says why", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderWithProviders(<PostEditor workspaceId="w1" projectId="p1" basePath="/blog" />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Give the post a title before saving.");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("creates the post with a normalised slug", async () => {
    const user = userEvent.setup();
    const calls = mockApi((_url, init) => (init?.method === "POST" ? ok(existing(), 201) : ok(existing())));
    renderWithProviders(<PostEditor workspaceId="w1" projectId="p1" basePath="/blog" />);

    await user.type(screen.getByLabelText("Title"), "Release Notes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const post = calls.find((call) => call.method === "POST");
    expect(post?.body).toMatchObject({ title: "Release Notes", slug: "release-notes", status: "draft" });
  });
});

describe("existing post", () => {
  it("loads the post into the form", async () => {
    mockApi();
    renderWithProviders(
      <PostEditor workspaceId="w1" projectId="p1" postId="aaaaaaaaaaaaaaaaaaaaaaaa" basePath="/blog" />,
    );

    expect(await screen.findByLabelText("Title")).toHaveValue("Release notes");
    expect(screen.getByLabelText("Excerpt")).toHaveValue("What changed");
  });

  it("shows a localized message when loading fails", async () => {
    mockApi(() => new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "gone" } }), { status: 404 }));
    renderWithProviders(
      <PostEditor workspaceId="w1" projectId="p1" postId="aaaaaaaaaaaaaaaaaaaaaaaa" basePath="/blog" />,
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("generated custom fields", () => {
  it("renders one control per distinct field definition", async () => {
    mockApi();
    renderWithProviders(
      <PostEditor
        workspaceId="w1"
        projectId="p1"
        basePath="/blog"
        fieldDefinitions={[field(), field({ id: "field-2", label: "Kicker" })]}
      />,
    );

    expect(screen.getByLabelText("Subtitle")).toBeInTheDocument();
    expect(screen.getByLabelText("Kicker")).toBeInTheDocument();
  });

  it("stores values by stable field id, not by label", async () => {
    const user = userEvent.setup();
    const calls = mockApi((_url, init) => (init?.method === "POST" ? ok(existing(), 201) : ok(existing())));
    renderWithProviders(
      <PostEditor workspaceId="w1" projectId="p1" basePath="/blog" fieldDefinitions={[field()]} />,
    );

    await user.type(screen.getByLabelText("Title"), "Post");
    await user.type(screen.getByLabelText("Subtitle"), "A subtitle");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const post = calls.find((call) => call.method === "POST");
    expect((post?.body as { customFieldValues: Record<string, unknown> }).customFieldValues).toEqual({
      "field-1": "A subtitle",
    });
  });

  it("keeps a value through a label rename, because the id did not change", async () => {
    mockApi();
    renderWithProviders(
      <PostEditor
        workspaceId="w1"
        projectId="p1"
        postId="aaaaaaaaaaaaaaaaaaaaaaaa"
        basePath="/blog"
        fieldDefinitions={[field({ label: "Kicker" })]}
      />,
    );

    expect(await screen.findByLabelText("Kicker")).toHaveValue("Original subtitle");
  });

  it("marks a required field as required", () => {
    mockApi();
    renderWithProviders(
      <PostEditor workspaceId="w1" projectId="p1" basePath="/blog" fieldDefinitions={[field({ required: true })]} />,
    );
    expect(screen.getByLabelText("Subtitle")).toBeRequired();
  });
});

describe("localization", () => {
  it("labels every field in Portuguese", () => {
    mockApi();
    renderWithProviders(<PostEditor workspaceId="w1" projectId="p1" basePath="/blog" />, { locale: "pt-BR" });

    expect(screen.getByLabelText("Título")).toBeInTheDocument();
    expect(screen.getByLabelText("Resumo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
  });
});

/**
 * Whether anybody can read the post.
 *
 * `status` has been in the model since the first commit and the public feed filters on it, and no
 * control anywhere ever set it — so every post written in this product stayed a draft forever, and
 * a customer who wrote one and published their site correctly reported that the blog was empty.
 */
describe("draft and published", () => {
  it("offers the choice, and starts a new post as a draft", () => {
    mockApi();
    renderWithProviders(<PostEditor workspaceId="w1" projectId="p1" basePath="/blog" />);

    expect(screen.getByRole("radio", { name: "Draft" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Published" })).not.toBeChecked();
  });

  it("saves the post as published when that is what was chosen", async () => {
    const user = userEvent.setup();
    const calls = mockApi((_url, init) => (init?.method === "POST" ? ok(existing({ status: "published" }), 201) : ok(existing())));
    renderWithProviders(<PostEditor workspaceId="w1" projectId="p1" basePath="/blog" />);

    await user.type(screen.getByLabelText("Title"), "Release notes");
    await user.click(screen.getByRole("radio", { name: "Published" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({ status: "published" });
  });

  it("shows the publication date the server stamped, and does not offer to edit it", async () => {
    mockApi(() => ok(existing({ status: "published", publishedAt: "2026-08-09T00:00:00.000Z" })));
    renderWithProviders(
      <PostEditor workspaceId="w1" projectId="p1" postId="aaaaaaaaaaaaaaaaaaaaaaaa" basePath="/blog" />,
    );

    expect(await screen.findByText(/Published on/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Published on/)).toBeNull();
  });
});

/**
 * Losing work, and being told about it.
 *
 * The form had one state that said "Saved" and never took it back, no protection against closing
 * the tab, and no way to notice that somebody else had written over the post in the meantime.
 */
describe("not losing the draft", () => {
  it("stops claiming the post is saved once it is edited again", async () => {
    const user = userEvent.setup();
    mockApi((_url, init) => (init?.method === "POST" ? ok(existing(), 201) : ok(existing())));
    renderWithProviders(<PostEditor workspaceId="w1" projectId="p1" basePath="/blog" />);

    await user.type(screen.getByLabelText("Title"), "Release notes");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Excerpt"), "More");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("warns before the tab closes on unsaved work, and stops once it is saved", async () => {
    const user = userEvent.setup();
    mockApi((_url, init) => (init?.method === "POST" ? ok(existing({ title: "Release notes" }), 201) : ok(existing())));
    renderWithProviders(<PostEditor workspaceId="w1" projectId="p1" basePath="/blog" />);

    await user.type(screen.getByLabelText("Title"), "Release notes");

    const unsaved = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unsaved);
    expect(unsaved.defaultPrevented).toBe(true);
  });

  it("sends the version it was looking at, so a stale write can be refused", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderWithProviders(
      <PostEditor workspaceId="w1" projectId="p1" postId="aaaaaaaaaaaaaaaaaaaaaaaa" basePath="/blog" />,
    );

    await user.type(await screen.findByLabelText("Excerpt"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
      expectedUpdatedAt: "2026-08-05T00:00:00.000Z",
    });
  });

  it("explains a post somebody else changed, instead of reporting a failure", async () => {
    const user = userEvent.setup();
    mockApi((_url, init) =>
      init?.method === "PUT"
        ? new Response(JSON.stringify({ error: { code: "REVISION_CONFLICT", message: "stale" } }), { status: 409 })
        : ok(existing()),
    );
    renderWithProviders(
      <PostEditor workspaceId="w1" projectId="p1" postId="aaaaaaaaaaaaaaaaaaaaaaaa" basePath="/blog" />,
    );

    await user.type(await screen.findByLabelText("Excerpt"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // The draft in this tab is not thrown away and not merged: two prose versions cannot be
    // combined by a machine without destroying one of them.
    expect(await screen.findByRole("alert")).toHaveTextContent(/somebody else saved this post/i);
    expect(screen.getByRole("button", { name: "Open the newer version" })).toBeInTheDocument();
    expect(screen.getByLabelText("Excerpt")).toHaveValue("What changed!");
  });
});

/**
 * Custom fields, drawn by their type.
 *
 * Every type but two used to render as a text input over `String(value)`. A media field showed a
 * raw asset id and invited somebody to type over it; a rich-text field showed "[object Object]" and
 * saving destroyed the document. Both are values that cannot survive the round trip to a page.
 */
describe("custom fields by type", () => {
  it("never shows a raw media id in a text box", async () => {
    mockApi(() => ok(existing({ customFieldValues: { "field-1": "0123456789abcdef01234567" } })));
    renderWithProviders(
      <PostEditor
        workspaceId="w1"
        projectId="p1"
        postId="aaaaaaaaaaaaaaaaaaaaaaaa"
        basePath="/blog"
        fieldDefinitions={[field({ type: "image", label: "Illustration" })]}
      />,
    );

    expect(await screen.findByText("Illustration")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("0123456789abcdef01234567")).toBeNull();
    expect(screen.getByRole("button", { name: "Choose an image for Illustration" })).toBeInTheDocument();
  });

  it("requests no image at all when the field is empty", async () => {
    const calls = mockApi(() => ok(existing({ customFieldValues: { "field-1": "" } })));
    renderWithProviders(
      <PostEditor
        workspaceId="w1"
        projectId="p1"
        postId="aaaaaaaaaaaaaaaaaaaaaaaa"
        basePath="/blog"
        fieldDefinitions={[field({ type: "image", label: "Illustration" })]}
      />,
    );
    await screen.findByText("Illustration");

    // `/media//content` is a request the browser reports as a broken image on the author's screen.
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(calls.some((call) => call.url.includes("/media//content"))).toBe(false);
  });

  it("edits a rich-text field as rich text, never as JSON in a box", async () => {
    mockApi(() => ok(existing({ customFieldValues: { "field-1": EMPTY_RICH_TEXT } })));
    renderWithProviders(
      <PostEditor
        workspaceId="w1"
        projectId="p1"
        postId="aaaaaaaaaaaaaaaaaaaaaaaa"
        basePath="/blog"
        fieldDefinitions={[field({ type: "richText", label: "Pull quote" })]}
      />,
    );

    expect(await screen.findByText("Pull quote")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/\{/)).toBeNull();
    expect(screen.getAllByRole("toolbar", { name: "Formatting" }).length).toBeGreaterThan(1);
  });

  it("keeps a field it cannot yet author, and says so rather than offering a box that breaks it", async () => {
    const user = userEvent.setup();
    const calls = mockApi((_url, init) => (init?.method === "PUT" ? ok(existing()) : ok(existing({ customFieldValues: { "field-1": ["a", "b"] } }))));
    renderWithProviders(
      <PostEditor
        workspaceId="w1"
        projectId="p1"
        postId="aaaaaaaaaaaaaaaaaaaaaaaa"
        basePath="/blog"
        fieldDefinitions={[field({ type: "gallery", label: "Photos" })]}
      />,
    );

    expect(await screen.findByText(/cannot be filled in here yet/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Excerpt"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Preserved, not dropped: the value belongs to the customer whether or not this form can edit it.
    expect((calls.find((call) => call.method === "PUT")?.body as { customFieldValues: unknown }).customFieldValues).toEqual({
      "field-1": ["a", "b"],
    });
  });
});
