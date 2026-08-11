import {
  createId,
  createPage,
  type BuilderElement,
  type BuilderSection,
  type ButtonElement,
  type ImageElement,
  type TextElement,
} from "@websitebuilder/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ElementRenderer } from "./ElementRenderer";
import { ProjectPageRenderer, SectionRenderer } from "./ProjectPageRenderer";
import { RendererContext, type RendererContextValue } from "./RendererContext";
import { sectionStyle } from "./styles";

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

describe("responsive section layout", () => {
  const breakpoints = [
    { id: "desktop", name: "Desktop", maxWidth: 4000, order: 0, preset: "desktop" as const },
    { id: "mobile", name: "Mobile", maxWidth: 640, order: 1, preset: "mobile" as const },
  ];

  const gridSection = (): BuilderSection => ({
    id: "section-1",
    name: "Grid",
    role: "content",
    layoutMode: "grid",
    heightByBreakpoint: {},
    layoutByBreakpoint: {
      desktop: { columns: 4, autoMode: "fixed" },
      mobile: { columns: 1 },
    },
    elements: [],
    backgroundColor: "#ffffff",
    hidden: false,
  });

  it("applies the desktop layout at every width above the mobile boundary", () => {
    for (const width of [1920, 1440, 1280, 1024, 768, 641]) {
      const style = sectionStyle(gridSection(), "desktop", { width, breakpoints });
      expect(style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
    }
  });

  it("applies the mobile override at and below its boundary", () => {
    for (const width of [640, 390, 375, 320]) {
      const style = sectionStyle(gridSection(), "desktop", { width, breakpoints });
      expect(style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
    }
  });

  it("never emits a column minimum that could force horizontal overflow", () => {
    const section = gridSection();
    section.layoutByBreakpoint = { desktop: { autoMode: "auto-fit", minColumnWidth: 900 } };

    const style = sectionStyle(section, "desktop", { width: 320, breakpoints });
    // The min() guard is what keeps a 900px minimum from overflowing a 320px screen.
    expect(style.gridTemplateColumns).toContain("min(900px, 100%)");
  });

  it("shows the editor exactly what a visitor at that breakpoint receives", () => {
    // No explicit width: the breakpoint's own maximum is used, so the canvas resolves through the
    // same chain as the published site rather than reading one breakpoint's stored values.
    const canvas = sectionStyle(gridSection(), "mobile", { breakpoints });
    const visitor = sectionStyle(gridSection(), "mobile", { width: 640, breakpoints });

    expect(canvas.gridTemplateColumns).toBe(visitor.gridTemplateColumns);
    expect(canvas.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
  });
});

describe("container queries", () => {
  const containerSection = (overrides: Partial<BuilderSection> = {}): BuilderSection => ({
    id: "section-c",
    name: "Card",
    role: "content",
    layoutMode: "flex",
    heightByBreakpoint: {},
    layoutByBreakpoint: {},
    elements: [],
    backgroundColor: "#ffffff",
    hidden: false,
    ...overrides,
  });

  it("declares a container only when the section opts in", () => {
    const { container: plain } = render(<SectionRenderer section={containerSection()} />);
    expect(plain.querySelector("section")?.style.containerType).toBe("");

    const { container: opted } = render(
      <SectionRenderer section={containerSection({ container: { enabled: true, name: "card" } })} />,
    );
    expect(opted.querySelector("section")?.style.containerType).toBe("inline-size");
  });

  it("emits container rules scoped to the section", () => {
    const { container } = render(
      <SectionRenderer
        section={containerSection({
          containerRules: [{ minWidth: 400, flex: { direction: "column" } }],
        })}
      />,
    );

    const css = container.querySelector("style")?.textContent ?? "";
    expect(css).toContain('[data-section-id="section-c"]');
    expect(css).toContain("@container (min-width: 400px)");
    expect(css).toContain("flex-direction: column;");
  });

  it("emits no style element when a section has no rules", () => {
    const { container } = render(<SectionRenderer section={containerSection()} />);
    expect(container.querySelector("style")).toBeNull();
  });

  it("lets one component answer to its container rather than the viewport", () => {
    // The same section markup, rendered twice. What differs at the same viewport width is the
    // container it sits in, which is the whole point of the feature.
    const section = containerSection({
      containerRules: [{ container: "main", minWidth: 700, flex: { direction: "row" } }],
    });

    const { container } = render(<SectionRenderer section={section} />);
    const css = container.querySelector("style")?.textContent ?? "";
    expect(css).toContain("@container main (min-width: 700px)");
  });
});

describe("responsive images", () => {
  const image = (overrides: Partial<ImageElement> = {}): ImageElement =>
    ({
      id: "img-1",
      type: "image",
      name: "Image",
      source: { kind: "media", mediaId: "m1" },
      alt: "A description",
      decorative: false,
      geometry: { x: 0, y: 0, width: 320, height: 200, rotation: 0 },
      responsiveLayout: {
        width: { value: 320, unit: "px" },
        height: { value: 200, unit: "px" },
        horizontalConstraint: "left",
        verticalConstraint: "top",
        visible: true,
      },
      zIndex: 1,
      locked: false,
      hidden: false,
      style: { objectFit: "cover", borderRadius: 0 },
      ...overrides,
    }) as ImageElement;

  const withVariants: RendererContextValue = {
    resolvePagePath: () => null,
    resolveMediaUrl: (id) => `/media/${id}/1440.webp`,
    resolveMediaVariants: () => [
      { width: 320, height: 200 },
      { width: 768, height: 480 },
      { width: 1440, height: 900 },
    ],
    resolveMediaVariantUrl: (id, width) => `/media/${id}/${width}.webp`,
  };

  const renderImage = (element: ImageElement, context: RendererContextValue = withVariants) =>
    render(
      <RendererContext.Provider value={context}>
        <ElementRenderer element={element} />
      </RendererContext.Provider>,
    );

  it("lets the browser choose from the variants that exist", () => {
    renderImage(image());
    const img = screen.getByAltText("A description");

    expect(img.getAttribute("srcset")).toBe(
      "/media/m1/320.webp 320w, /media/m1/768.webp 768w, /media/m1/1440.webp 1440w",
    );
    expect(img.getAttribute("sizes")).toContain("(max-width: 640px) 100vw");
  });

  it("emits explicit dimensions so content below does not shift as it loads", () => {
    renderImage(image());
    const img = screen.getByAltText("A description");

    expect(img.getAttribute("width")).toBe("1440");
    expect(img.getAttribute("height")).toBe("900");
  });

  it("falls back to a plain source when an asset has no variants", () => {
    renderImage(image(), { resolvePagePath: () => null, resolveMediaUrl: () => "/external.png" });
    const img = screen.getByAltText("A description");

    expect(img.getAttribute("srcset")).toBeNull();
    expect(img.getAttribute("src")).toBe("/external.png");
  });

  it("keeps the chosen subject in frame when the image is cropped", () => {
    renderImage(image({ focalPoint: { x: 0.2, y: 0.75 } }));
    expect(screen.getByAltText("A description").style.objectPosition).toBe("20% 75%");
  });

  it("centres by default", () => {
    renderImage(image());
    expect(screen.getByAltText("A description").style.objectPosition).toBe("50% 50%");
  });
});

describe("visual elements in the document", () => {
  const visual = (overrides: Record<string, unknown>): BuilderElement =>
    ({
      id: "v1",
      name: "Element",
      geometry: { x: 0, y: 0, width: 320, height: 64, rotation: 0 },
      responsiveLayout: {
        width: { value: 320, unit: "px" },
        height: { value: 64, unit: "px" },
        horizontalConstraint: "left",
        verticalConstraint: "top",
        visible: true,
      },
      zIndex: 1,
      locked: false,
      hidden: false,
      ...overrides,
    }) as unknown as BuilderElement;

  const renderOne = (element: BuilderElement) =>
    render(
      <RendererContext.Provider value={{ resolvePagePath: () => null, resolveMediaUrl: (id) => `/media/${id}` }}>
        <ElementRenderer element={element} />
      </RendererContext.Provider>,
    );

  it("renders a table the same renderer produces for a published page", () => {
    renderOne(
      visual({
        type: "table",
        headers: ["Plan", "Price"],
        rows: [["Basic", "10"]],
        hasHeaderRow: true,
        caption: "Plans",
      }),
    );

    expect(screen.getByRole("table", { name: "Plans" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Plan" })).toHaveAttribute("scope", "col");
  });

  it("renders an FAQ that works with no script at all", () => {
    renderOne(visual({ type: "accordion", allowMultiple: true, items: [{ question: "Q", answer: "A" }] }));

    // `<details>` is operable as served, which is what a published page must be.
    expect(screen.getByText("Q").tagName).toBe("SUMMARY");
  });

  it("shows every tab panel without scripting rather than none", () => {
    renderOne(
      visual({
        type: "tabs",
        items: [
          { label: "One", content: "First" },
          { label: "Two", content: "Second" },
        ],
      }),
    );

    // Content a visitor cannot reach is worse than content shown all at once.
    expect(screen.getByText("First")).toBeVisible();
    expect(screen.getByText("Second")).toBeVisible();
  });

  it("names a breadcrumb landmark in the site's language, not the editor's", () => {
    renderOne(visual({ type: "breadcrumbs", separator: "chevron", label: "Trilha" }));
    expect(screen.getByRole("navigation", { name: "Trilha" })).toBeInTheDocument();
  });

  it("hides a spacer from assistive technology instead of announcing an empty region", () => {
    const { container } = renderOne(visual({ type: "spacer" }));
    expect(container.querySelector("[aria-hidden]")).not.toBeNull();
  });

  it("does not make a social link hand over the opener", () => {
    renderOne(
      visual({
        type: "socialLinks",
        items: [{ network: "instagram", url: "https://instagram.com/acme" }],
        iconSize: 24,
        gap: 8,
      }),
    );

    expect(screen.getByRole("link", { name: "instagram" })).toHaveAttribute(
      "rel",
      expect.stringContaining("noopener"),
    );
  });
});
