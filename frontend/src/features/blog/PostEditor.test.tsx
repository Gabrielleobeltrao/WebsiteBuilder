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
    expect(screen.getByRole("toolbar", { name: "Content" })).toBeInTheDocument();
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
