import { compilePageCss, DEVICE_MODES, elementDefinition, type BuilderElement } from "@websitebuilder/shared";
import {
  FAR_RIGHT_X,
  flexSectionFixture,
  freeSectionFixture,
  gridSectionFixture,
  overriddenProject,
  pageWith,
} from "@websitebuilder/shared/responsive-fixtures";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectPageRenderer } from "@/components/renderer/ProjectPageRenderer";
import { RendererContext } from "@/components/renderer/RendererContext";

/**
 * What the renderer puts on the page.
 *
 * These assertions stop at the boundary a component test can honestly check: the markup, and the
 * stylesheet that markup carries. Whether an element actually lands inside a 390 px viewport is a
 * question for a browser with a layout engine, and it is asked there — jsdom applies no media
 * queries, so a DOM assertion here would either be vacuous or quietly wrong.
 *
 * The claim being defended is narrower and more useful: the renderer emits exactly the compiler's
 * output and nothing of its own. Every earlier responsive bug lived in the gap between those two.
 */

function renderPage(page: ReturnType<typeof pageWith>) {
  return render(
    <RendererContext.Provider value={{ resolvePagePath: () => null, resolveMediaUrl: () => "" }}>
      <ProjectPageRenderer page={page} />
    </RendererContext.Provider>,
  );
}

const styleSheets = (container: HTMLElement) => [...container.querySelectorAll("style")].map((node) => node.textContent ?? "");

describe("the page carries its own responsive stylesheet", () => {
  it("emits the compiler's output verbatim", () => {
    const page = pageWith([freeSectionFixture()]);
    const { container } = renderPage(page);

    // Verbatim, not "equivalent". A renderer that computes its own version of this is the thing
    // being removed: it is how the editor and the visitor came to see different layouts.
    expect(styleSheets(container)).toContain(compilePageCss(page));
  });

  it("places nothing inline that the stylesheet is responsible for", () => {
    const { container } = renderPage(pageWith([freeSectionFixture()]));

    for (const node of container.querySelectorAll("[data-element-id]")) {
      const style = (node as HTMLElement).style;
      // An inline `left` is a position computed at one width. That is exactly what put elements
      // three screens off the side of a phone.
      expect(style.left, node.getAttribute("data-element-id") ?? "").toBe("");
      expect(style.position).toBe("");
    }
  });
});

describe("every element is addressable", () => {
  it("carries its id in a free section", () => {
    const { container } = renderPage(pageWith([freeSectionFixture()]));

    for (const id of ["far-right", "centred", "stretched", "right-anchored", "scaled"]) {
      expect(container.querySelector(`[data-element-id="${id}"]`), id).not.toBeNull();
    }
  });

  it("carries its id in grid and flex sections too", () => {
    // The regression this guards: identity used to come from the free-layout positioning wrapper,
    // so an element in normal flow had none at all and nothing could address or attribute it.
    const { container } = renderPage(pageWith([gridSectionFixture(), flexSectionFixture()]));

    for (const id of ["grid-one", "grid-two", "grid-three", "flex-long", "flex-button"]) {
      expect(container.querySelector(`[data-element-id="${id}"]`), id).not.toBeNull();
    }
  });

  it("carries exactly one node per element", () => {
    const { container } = renderPage(pageWith([freeSectionFixture()]));
    expect(container.querySelectorAll('[data-element-id="far-right"]')).toHaveLength(1);
  });
});

describe("what the stylesheet says about a device", () => {
  const cssOf = (page: ReturnType<typeof pageWith>) => compilePageCss(page);

  it("keeps the desktop placement outside any media query", () => {
    const css = cssOf(pageWith([freeSectionFixture()]));
    const desktop = css.split("@media")[0] ?? "";

    expect(desktop).toContain(`left:${FAR_RIGHT_X}px`);
  });

  it("puts a person's mobile override in the mobile query and nowhere else", () => {
    const page = overriddenProject().pages[0]!;
    const css = cssOf(page);

    const mobile = css.slice(css.indexOf(`@media (max-width:${DEVICE_MODES.mobile.maxWidth}px)`));
    expect(mobile).toContain("left:16px");
    expect(css.split("@media")[0]).not.toContain("left:16px");
  });

  it("leaves an element that already fits with no device rules at all", () => {
    const css = cssOf(pageWith([freeSectionFixture()]));
    const centred = css.match(/\[data-element-id="centred"\]/g) ?? [];

    // One rule, unconditional. A media query restating its parent costs a visitor bytes to change
    // nothing they can see.
    expect(centred).toHaveLength(1);
  });
});

describe("what a published page draws for a block", () => {
  const element = (type: Parameters<typeof elementDefinition>[0], overrides: Record<string, unknown> = {}) =>
    ({
      id: `${type}-1`,
      name: "",
      geometry: { x: 0, y: 0, width: 100, height: 40, rotation: 0 },
      responsiveLayout: {
        width: { value: 100, unit: "px" },
        height: { value: 40, unit: "px" },
        horizontalConstraint: "left",
        verticalConstraint: "top",
        visible: true,
      },
      zIndex: 1,
      locked: false,
      hidden: false,
      type,
      version: elementDefinition(type).schemaVersion,
      ...elementDefinition(type).defaults(),
      ...overrides,
    }) as BuilderElement;

  const pageOf = (elements: BuilderElement[]) => {
    const page = pageWith([freeSectionFixture()]);
    return { ...page, sections: [{ ...page.sections[0]!, elements }] };
  };

  it("draws a real icon rather than a placeholder glyph", () => {
    const { container } = renderPage(pageOf([element("icon", { icon: "check" })]));

    // The bullet this replaced was the same mark for every icon in the set, so a page with a phone
    // icon and a mail icon showed two identical dots.
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.querySelector("path")?.getAttribute("d")).toContain("M20 6");
    expect(container.textContent).not.toContain("●");
  });

  it("renders nothing for an icon name outside the set", () => {
    // The vocabulary is closed: an unknown name draws nothing rather than anything.
    const { container } = renderPage(pageOf([element("icon", { icon: "not-an-icon" })]));
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders a button's icon beside its label", () => {
    const { container } = renderPage(
      pageOf([element("button", { text: "Download", icon: { name: "download", position: "before" } })]),
    );

    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toContain("Download");
  });

  it("builds a video frame from the provider and id, never from a stored URL", () => {
    const { container } = renderPage(pageOf([element("video", { videoId: "abc123", title: "A talk" })]));
    const frame = container.querySelector("iframe");

    expect(frame?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/abc123");
    expect(frame?.getAttribute("title")).toBe("A talk");
  });

  it("shows a placeholder for a video nobody has configured yet", () => {
    const { container } = renderPage(pageOf([element("video")]));

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector('[role="img"]')).not.toBeNull();
  });
});
