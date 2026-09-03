import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router";

import { PreviewRoute } from "@/features/preview/PreviewRoute";
import { renderWithProviders } from "@/test/render";

/**
 * The preview shell.
 *
 * The page itself is a document served by the API and framed here, so nothing in this file asserts
 * what the site looks like — that is the renderer's parity suite, and the pixels are the viewport
 * matrix in Playwright. What is asserted here is the contract of the shell: which controls exist,
 * which do not, what the frame is pointed at, and that none of it can write.
 */

let requests: string[] = [];

/** Desktop-class by default; the mobile cases override it. */
function setViewport(width: number, pointer: "fine" | "coarse" = "fine") {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("pointer: fine") ? pointer === "fine" : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

beforeEach(() => {
  requests = [];
  setViewport(1440);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
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

const frame = () => screen.getByTitle("Site preview") as HTMLIFrameElement;

describe("what the preview shell contains", () => {
  it("has Back, three devices, and the site — and nothing else", () => {
    renderPreview("/preview/w1/p1");

    expect(screen.getByRole("link", { name: "Back to the builder" })).toBeInTheDocument();
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Desktop", "Tablet", "Mobile"]);
    expect(frame()).toBeInTheDocument();
  });

  it("carries no width tool, diagnostics, save control, or editor panel", () => {
    renderPreview("/preview/w1/p1");

    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByLabelText(/width/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("region", { name: /check/i })).toBeNull();
  });

  it("frames the draft of this project, on this workspace", () => {
    renderPreview("/preview/w1/p1");

    expect(frame().getAttribute("src")).toBe(
      "/api/v1/workspaces/w1/projects/p1/publishing/preview?path=%2F",
    );
  });

  it("frames the page named by the address", () => {
    renderPreview("/preview/w1/p1/about");
    expect(frame().getAttribute("src")).toContain("path=%2Fabout");
  });

  it("returns to the builder for this project", () => {
    renderPreview("/preview/w1/p1");
    expect(screen.getByRole("link", { name: "Back to the builder" })).toHaveAttribute(
      "href",
      "/app/w1/sites/p1/builder",
    );
  });
});

describe("device viewports", () => {
  it("gives the frame the device's exact width, never the host's", async () => {
    const user = userEvent.setup();
    renderPreview("/preview/w1/p1");

    expect(frame().style.width).toBe("1440px");

    await user.click(screen.getByRole("button", { name: "Tablet" }));
    expect(frame().style.width).toBe("768px");

    await user.click(screen.getByRole("button", { name: "Mobile" }));
    expect(frame().style.width).toBe("390px");
  });

  it("marks the active device", async () => {
    const user = userEvent.setup();
    renderPreview("/preview/w1/p1");

    expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Mobile" }));
    expect(screen.getByRole("button", { name: "Mobile" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute("aria-pressed", "false");
  });

  it("takes the device from the address, so a rendering can be shared", () => {
    renderPreview("/preview/w1/p1?device=tablet");

    expect(screen.getByRole("button", { name: "Tablet" })).toHaveAttribute("aria-pressed", "true");
    expect(frame().style.width).toBe("768px");
  });

  it("changing device does not reload a different document", async () => {
    const user = userEvent.setup();
    renderPreview("/preview/w1/p1");
    const before = frame().getAttribute("src");

    await user.click(screen.getByRole("button", { name: "Mobile" }));
    // The frame keeps its source: the device changes the viewport, never the stored page.
    expect(frame().getAttribute("src")).toBe(before);
  });

  it("opens on the phone layout when the host is a phone", () => {
    setViewport(390, "coarse");
    renderPreview("/preview/w1/p1");

    expect(screen.getByRole("button", { name: "Mobile" })).toHaveAttribute("aria-pressed", "true");
    expect(frame().style.width).toBe("390px");
  });

  it("offers all three devices on a phone", () => {
    setViewport(390, "coarse");
    renderPreview("/preview/w1/p1");

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Desktop",
      "Tablet",
      "Mobile",
    ]);
  });
});

describe("preview writes nothing", () => {
  it("issues no request of its own at all", async () => {
    const user = userEvent.setup();
    renderPreview("/preview/w1/p1");

    await user.click(screen.getByRole("button", { name: "Mobile" }));
    await user.click(screen.getByRole("button", { name: "Desktop" }));

    // The document arrives through the frame, under the browser's own credentials. Every mutation
    // path in this product goes through fetch, so an empty list is the assertion that matters.
    expect(requests).toEqual([]);
  });
});

/**
 * Previewing a blog layout rather than a page.
 *
 * The template editor linked here with no parameter, so a designer who had just built an article
 * layout was shown the site's home page — the ordinary site preview, answering a question they had
 * not asked. A layout has no address of its own: it is named, and drawn against sample content.
 */
describe("previewing a blog layout", () => {
  it("frames the layout's own render, not a page of the site", () => {
    renderPreview("/preview/w1/p1?template=article");

    expect(frame().getAttribute("src")).toBe(
      "/api/v1/workspaces/w1/projects/p1/publishing/preview/blog-template/article?lang=en-US",
    );
  });

  it("asks for the index layout when that is what was open", () => {
    renderPreview("/preview/w1/p1?template=index");
    expect(frame().getAttribute("src")).toContain("/blog-template/index");
  });

  it("says the content is an example, outside the frame", () => {
    renderPreview("/preview/w1/p1?template=article");

    // Outside on purpose: the framed document has to stay exactly what publication renders, so the
    // warning cannot be written into it.
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(/sample content/i);
    expect(frame().contains(notice)).toBe(false);
  });

  it("says nothing about samples when previewing the site itself", () => {
    renderPreview("/preview/w1/p1");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("returns to the template that was open, not to the site builder", () => {
    renderPreview("/preview/w1/p1?template=index");

    expect(screen.getByRole("link", { name: "Back to the builder" })).toHaveAttribute(
      "href",
      "/app/w1/sites/p1/blog/templates/index",
    );
  });

  it("still previews at all three device widths", async () => {
    const user = userEvent.setup();
    renderPreview("/preview/w1/p1?template=article");

    expect(frame().style.width).toBe("1440px");
    await user.click(screen.getByRole("button", { name: "Tablet" }));
    expect(frame().style.width).toBe("768px");
    await user.click(screen.getByRole("button", { name: "Mobile" }));
    expect(frame().style.width).toBe("390px");
    // Switching device must not lose the layout being previewed.
    expect(frame().getAttribute("src")).toContain("/blog-template/article");
  });

  it("asks the renderer for the reader's language", () => {
    renderWithProviders(
      <Routes>
        <Route path="/preview/:workspaceId/:projectId" element={<PreviewRoute />} />
      </Routes>,
      { route: "/preview/w1/p1?template=article", locale: "pt-BR" },
    );

    expect((screen.getByTitle("Pré-visualização do site") as HTMLIFrameElement).getAttribute("src")).toContain(
      "lang=pt-BR",
    );
  });

  it("ignores a template name it does not know", () => {
    renderPreview("/preview/w1/p1?template=sidebar");

    // An unknown name is a link somebody typed. It falls back to the site preview rather than
    // framing an address the API will refuse.
    expect(frame().getAttribute("src")).toContain("/publishing/preview?path=");
  });
});
