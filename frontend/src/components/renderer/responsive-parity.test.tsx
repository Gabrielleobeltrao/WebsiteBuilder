import { compilePageCss, DEVICE_MODES } from "@websitebuilder/shared";
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
