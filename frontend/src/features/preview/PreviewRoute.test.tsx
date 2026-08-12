import { createPage, createProjectDocument, type BuilderProject } from "@websitebuilder/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router";

import { PreviewRoute } from "@/features/preview/PreviewRoute";
import { renderWithProviders } from "@/test/render";

function project(): BuilderProject {
  const document = createProjectDocument({ name: "Acme", slug: "acme" });
  const about = createPage({ name: "About", slug: "about", order: 1 });

  const home = document.pages[0];
  const homeSection = home?.sections[0];
  const aboutSection = about.sections[0];
  if (!home || !homeSection || !aboutSection) throw new Error("fixture is missing a section");

  const geometry = { x: 0, y: 0, width: 320, height: 64, rotation: 0 };
  const responsiveLayout = {
    width: { value: 320, unit: "px" as const },
    height: { value: 64, unit: "px" as const },
    horizontalConstraint: "left" as const,
    verticalConstraint: "top" as const,
    visible: true,
  };
  const textStyle = {
    fontFamily: "Inter",
    fontSize: { value: 24, unit: "px" as const },
    fontWeight: 700,
    fontStyle: "normal" as const,
    textAlign: "left" as const,
    color: "#111111",
    lineHeight: 1.2,
  };

  homeSection.elements.push(
    {
      id: "11111111-1111-4111-8111-111111111111",
      type: "text",
      name: "Title",
      tag: "h1",
      content: "Home page",
      geometry,
      responsiveLayout,
      zIndex: 1,
      locked: false,
      hidden: false,
      style: textStyle,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      type: "button",
      name: "CTA",
      text: "Go to About",
      link: { kind: "internal", pageId: about.id },
      geometry: { ...geometry, y: 100 },
      responsiveLayout,
      zIndex: 2,
      locked: false,
      hidden: false,
      style: {
        fontSize: { value: 16, unit: "px" },
        fontWeight: 600,
        textColor: "#ffffff",
        backgroundColor: "#12806f",
        borderRadius: 6,
        horizontalAlign: "center",
      },
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      type: "text",
      name: "Hidden",
      tag: "p",
      content: "Hidden from visitors",
      geometry: { ...geometry, y: 200 },
      responsiveLayout,
      zIndex: 3,
      locked: false,
      hidden: true,
      style: textStyle,
    },
  );

  aboutSection.elements.push({
    id: "44444444-4444-4444-8444-444444444444",
    type: "text",
    name: "About title",
    tag: "h1",
    content: "About page",
    geometry,
    responsiveLayout,
    zIndex: 1,
    locked: false,
    hidden: false,
    style: textStyle,
  });

  document.pages.push(about);

  return {
    id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    workspaceId: "w1",
    createdByUserId: "u1",
    revision: 2,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...document,
  };
}

let requests: string[] = [];

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response(JSON.stringify({ data: project() }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const renderPreview = (route: string) =>
  renderWithProviders(
    <Routes>
      <Route path="/preview/:workspaceId/:projectId/*" element={<PreviewRoute />} />
      <Route path="/preview/:workspaceId/:projectId" element={<PreviewRoute />} />
    </Routes>,
    { route },
  );

describe("preview routing", () => {
  it("renders the homepage at the project root", async () => {
    renderPreview("/preview/w1/aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(await screen.findByRole("heading", { level: 1, name: "Home page" })).toBeInTheDocument();
  });

  it("resolves a trailing slug to its page", async () => {
    renderPreview("/preview/w1/aaaaaaaaaaaaaaaaaaaaaaaa/about");
    expect(await screen.findByRole("heading", { level: 1, name: "About page" })).toBeInTheDocument();
  });

  it("shows a project-scoped not-found view for an unknown slug", async () => {
    renderPreview("/preview/w1/aaaaaaaaaaaaaaaaaaaaaaaa/missing");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
  });

  it("shows a localized error when the project cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "gone" } }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    renderPreview("/preview/w1/aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(await screen.findByRole("alert")).toHaveTextContent("could not find");
  });
});

describe("preview isolation", () => {
  it("contains no editor chrome", async () => {
    renderPreview("/preview/w1/aaaaaaaaaaaaaaaaaaaaaaaa");
    await screen.findByRole("heading", { level: 1, name: "Home page" });

    expect(screen.queryByRole("complementary", { name: "Builder controls" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Page canvas" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("excludes hidden elements from what a visitor sees", async () => {
    renderPreview("/preview/w1/aaaaaaaaaaaaaaaaaaaaaaaa");
    await screen.findByRole("heading", { level: 1, name: "Home page" });
    expect(screen.queryByText("Hidden from visitors")).toBeNull();
  });

  it("keeps internal navigation inside the preview route", async () => {
    renderPreview("/preview/w1/aaaaaaaaaaaaaaaaaaaaaaaa");
    const link = await screen.findByRole("link", { name: "Go to About" });
    expect(link).toHaveAttribute("href", "/preview/w1/aaaaaaaaaaaaaaaaaaaaaaaa/about");
  });

  it("never issues a write request", async () => {
    const user = userEvent.setup();
    renderPreview("/preview/w1/aaaaaaaaaaaaaaaaaaaaaaaa");
    await screen.findByRole("heading", { level: 1, name: "Home page" });

    await user.click(screen.getByRole("button", { name: "Mobile" }));
    expect(requests.every((request) => request.startsWith("GET"))).toBe(true);
  });
});

describe("desktop and mobile preview", () => {
  it("offers both viewports and marks the active one", async () => {
    const user = userEvent.setup();
    renderPreview("/preview/w1/aaaaaaaaaaaaaaaaaaaaaaaa");
    await screen.findByRole("heading", { level: 1, name: "Home page" });

    const desktop = screen.getByRole("button", { name: "Desktop" });
    const mobile = screen.getByRole("button", { name: "Mobile" });
    expect(mobile).toHaveAttribute("aria-pressed", "true");

    await user.click(desktop);
    expect(desktop).toHaveAttribute("aria-pressed", "true");
    expect(mobile).toHaveAttribute("aria-pressed", "false");
  });

  it("renders the same document under both viewports", async () => {
    const user = userEvent.setup();
    renderPreview("/preview/w1/aaaaaaaaaaaaaaaaaaaaaaaa");
    await screen.findByRole("heading", { level: 1, name: "Home page" });

    await user.click(screen.getByRole("button", { name: "Desktop" }));
    expect(screen.getByRole("heading", { level: 1, name: "Home page" })).toBeInTheDocument();
  });
});
