import {
  createId,
  createPage,
  type ButtonElement,
  type ImageElement,
  type TextElement,
} from "@websitebuilder/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ElementRenderer } from "./ElementRenderer";
import { ProjectPageRenderer } from "./ProjectPageRenderer";
import { RendererContext, type RendererContextValue } from "./RendererContext";

const context: RendererContextValue = {
  resolvePagePath: (pageId) => (pageId === "about" ? "/about" : null),
  resolveMediaUrl: (mediaId) => (mediaId === "m1" ? "/api/v1/media/m1/content" : null),
};

function renderElement(element: Parameters<typeof ElementRenderer>[0]["element"], positioned = true) {
  return render(
    <RendererContext.Provider value={context}>
      <ElementRenderer element={element} positioned={positioned} />
    </RendererContext.Provider>,
  );
}

const baseGeometry = { x: 10, y: 20, width: 320, height: 64, rotation: 0 };
const baseLayout = {
  width: { value: 320, unit: "px" as const },
  height: { value: 64, unit: "px" as const },
  horizontalConstraint: "left" as const,
  verticalConstraint: "top" as const,
  visible: true,
};

const text = (overrides: Partial<TextElement> = {}): TextElement => ({
  id: createId(),
  type: "text",
  name: "Heading",
  tag: "h2",
  content: "Hello world",
  geometry: baseGeometry,
  responsiveLayout: baseLayout,
  zIndex: 1,
  locked: false,
  hidden: false,
  style: {
    fontFamily: "Inter",
    fontSize: { value: 32, unit: "px" },
    fontWeight: 700,
    fontStyle: "normal",
    textAlign: "left",
    color: "#111111",
    lineHeight: 1.2,
  },
  ...overrides,
});

const image = (overrides: Partial<ImageElement> = {}): ImageElement => ({
  id: createId(),
  type: "image",
  name: "Photo",
  source: { kind: "media", mediaId: "m1" },
  alt: "A photo",
  decorative: false,
  geometry: baseGeometry,
  responsiveLayout: baseLayout,
  zIndex: 1,
  locked: false,
  hidden: false,
  style: { objectFit: "cover", borderRadius: 8 },
  ...overrides,
});

const button = (overrides: Partial<ButtonElement> = {}): ButtonElement => ({
  id: createId(),
  type: "button",
  name: "CTA",
  text: "Go",
  link: { kind: "internal", pageId: "about" },
  geometry: baseGeometry,
  responsiveLayout: baseLayout,
  zIndex: 1,
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
  ...overrides,
});

describe("TextRenderer", () => {
  it("renders the configured semantic tag", () => {
    renderElement(text({ tag: "h1" }));
    expect(screen.getByRole("heading", { level: 1, name: "Hello world" })).toBeInTheDocument();
  });

  it("renders markup in user content as literal text, never as HTML", () => {
    const { container } = renderElement(text({ content: "<img src=x onerror=alert(1)> & <b>bold</b>" }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)> & <b>bold</b>")).toBeInTheDocument();
  });

  it("maps typography onto allowlisted CSS only", () => {
    const { container } = renderElement(text());
    const heading = container.querySelector("h2");
    expect(heading).toHaveStyle({ fontSize: "32px", fontWeight: "700", color: "rgb(17, 17, 17)" });
  });
});

describe("ImageRenderer", () => {
  it("resolves an owned media asset", () => {
    renderElement(image());
    expect(screen.getByRole("img", { name: "A photo" })).toHaveAttribute("src", "/api/v1/media/m1/content");
  });

  it("renders a neutral placeholder for a missing asset instead of a broken image", () => {
    const { container } = renderElement(image({ source: { kind: "media", mediaId: "gone" } }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[role="presentation"]')).toBeInTheDocument();
  });

  it("hides a decorative image from assistive technology", () => {
    renderElement(image({ decorative: true }));
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("lazy loads by default", () => {
    renderElement(image());
    expect(screen.getByRole("img")).toHaveAttribute("loading", "lazy");
  });
});

describe("ButtonRenderer", () => {
  it("links to an internal page", () => {
    renderElement(button());
    expect(screen.getByRole("link", { name: "Go" })).toHaveAttribute("href", "/about");
  });

  it("adds noopener noreferrer to a new-tab external link", () => {
    renderElement(button({ link: { kind: "external", url: "https://example.com", newTab: true } }));
    const link = screen.getByRole("link", { name: "Go" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders a non-navigating button for an unconfigured link", () => {
    renderElement(button({ link: { kind: "none" } }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
  });

  it("renders a non-navigating button when the internal target was deleted", () => {
    renderElement(button({ link: { kind: "internal", pageId: "deleted" } }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
  });

  it("never produces an href for a dangerous stored URL", () => {
    renderElement(button({ link: { kind: "external", url: "javascript:alert(1)", newTab: false } }));
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("visibility", () => {
  it("excludes a hidden element entirely", () => {
    const { container } = renderElement(text({ hidden: true }));
    expect(container).toBeEmptyDOMElement();
  });

  it("excludes a hidden section from the page", () => {
    const page = createPage({ name: "Home", isHome: true });
    const section = page.sections[0];
    if (!section) throw new Error("fixture is missing its section");
    section.elements.push(text({ content: "Visible" }));

    const hidden = { ...structuredClone(section), id: createId(), hidden: true };
    hidden.elements = [text({ content: "Should not render" })];
    page.sections.push(hidden);

    render(
      <RendererContext.Provider value={context}>
        <ProjectPageRenderer page={page} />
      </RendererContext.Provider>,
    );

    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.queryByText("Should not render")).toBeNull();
  });
});

describe("renderer purity", () => {
  it("renders without any editor state and produces no editor-only affordance", () => {
    const page = createPage({ name: "Home", isHome: true });
    page.sections[0]?.elements.push(text({ content: "Body" }), button());

    const { container } = render(
      <RendererContext.Provider value={context}>
        <ProjectPageRenderer page={page} />
      </RendererContext.Provider>,
    );

    expect(screen.getByText("Body")).toBeInTheDocument();
    // Selection outlines, handles and labels belong to the editor's interaction layer only.
    expect(container.querySelector("[data-selected]")).toBeNull();
    expect(container.querySelector(".moveable-control")).toBeNull();
  });

  it("respects z-order from the document", () => {
    const { container } = renderElement(text({ zIndex: 7 }));
    expect(container.firstElementChild).toHaveStyle({ zIndex: "7" });
  });
});
