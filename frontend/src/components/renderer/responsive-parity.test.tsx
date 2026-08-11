import { applyConstraints, DEFAULT_BREAKPOINTS, resolveLayoutAt } from "@websitebuilder/shared";
import {
  FAR_RIGHT_WIDTH,
  FAR_RIGHT_X,
  FIXTURE_WIDTHS,
  freeSectionFixture,
  overriddenProject,
  pageWith,
} from "@websitebuilder/shared/responsive-fixtures";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectPageRenderer } from "@/components/renderer/ProjectPageRenderer";
import { RendererContext } from "@/components/renderer/RendererContext";

/**
 * What a visitor receives, at the widths visitors actually use.
 *
 * These assertions are written against the shared resolver rather than against numbers copied into
 * the test, because the resolver is the contract: the editor, the preview and the published page
 * are all supposed to agree with it. A test carrying its own arithmetic would pass while the three
 * of them disagreed with each other.
 */

function renderAt(width: number) {
  const page = pageWith([freeSectionFixture()]);
  return render(
    <RendererContext.Provider value={{ resolvePagePath: () => null, resolveMediaUrl: () => "" }}>
      <ProjectPageRenderer page={page} width={width} />
    </RendererContext.Provider>,
  );
}

/** The absolute left/width the DOM actually carries for one element. */
function boxOf(container: HTMLElement, elementId: string): { left: number; width: number } {
  const node = container.querySelector(`[data-element-id="${elementId}"]`)?.parentElement;
  if (node === null || node === undefined) throw new Error(`no rendered box for ${elementId}`);

  const style = node.style;
  return { left: Number.parseFloat(style.left || "0"), width: Number.parseFloat(style.width || "0") };
}

describe("a free element at every width", () => {
  it.each(FIXTURE_WIDTHS)("stays inside the page at %ipx", (width) => {
    const { container } = renderAt(width);
    const box = boxOf(container, "far-right");

    // The failure this whole plan exists for: authored at x=1100 on a 1440 canvas, a phone puts it
    // three screens to the right, and nothing in the published output brings it back.
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.left + box.width).toBeLessThanOrEqual(width);
  });

  it("agrees with the shared resolver rather than with its own arithmetic", () => {
    const width = 390;
    const { container } = renderAt(width);
    const section = freeSectionFixture();
    const element = section.elements.find((candidate) => candidate.id === "far-right")!;

    const expected = applyConstraints({
      geometry: element.geometry,
      layout: element.responsiveLayout,
      containerWidth: width,
    });

    expect(boxOf(container, "far-right")).toEqual({ left: expected.x, width: expected.width });
  });

  it("keeps a centred element centred", () => {
    const width = 390;
    const { container } = renderAt(width);
    const box = boxOf(container, "centred");

    expect(Math.abs(box.left - (width - box.width) / 2)).toBeLessThanOrEqual(1);
  });

  it("keeps a stretched element inside both margins", () => {
    const width = 390;
    const { container } = renderAt(width);
    const box = boxOf(container, "stretched");

    expect(box.left).toBe(80);
    expect(box.left + box.width).toBeLessThanOrEqual(width);
  });

  it("holds the authored right gap for a right-anchored element", () => {
    const width = 768;
    const { container } = renderAt(width);
    const box = boxOf(container, "right-anchored");

    // Authored 80px from the right edge of a 1440 canvas.
    expect(width - (box.left + box.width)).toBe(80);
  });

  it("never renders a width at or below zero", () => {
    for (const width of FIXTURE_WIDTHS) {
      const { container } = renderAt(width);
      for (const id of ["far-right", "centred", "stretched", "right-anchored", "scaled"]) {
        expect(boxOf(container, id).width, `${id} at ${width}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("device overrides", () => {
  it("uses the mobile override a person authored instead of the desktop value", () => {
    const project = overriddenProject();
    const page = project.pages[0]!;

    const { container } = render(
      <RendererContext.Provider value={{ resolvePagePath: () => null, resolveMediaUrl: () => "" }}>
        <ProjectPageRenderer page={page} width={390} />
      </RendererContext.Provider>,
    );

    // The whole reason overrides exist: someone moved this element on mobile, and the visitor must
    // get what they moved it to.
    expect(boxOf(container, "far-right")).toEqual({ left: 16, width: 358 });
  });

  it("leaves desktop untouched when a mobile override exists", () => {
    const project = overriddenProject();
    const page = project.pages[0]!;

    const { container } = render(
      <RendererContext.Provider value={{ resolvePagePath: () => null, resolveMediaUrl: () => "" }}>
        <ProjectPageRenderer page={page} width={1440} />
      </RendererContext.Provider>,
    );

    expect(boxOf(container, "far-right")).toEqual({ left: FAR_RIGHT_X, width: FAR_RIGHT_WIDTH });
  });

  it("resolves overrides through the same chain the inspector reads", () => {
    // Guards the inheritance direction: a mobile override must not leak upward into tablet.
    const element = overriddenProject().pages[0]!.sections[0]!.elements.find((c) => c.id === "far-right")!;

    const onMobile = resolveLayoutAt({
      width: 390,
      base: element.responsiveLayout,
      geometry: element.geometry,
      breakpoints: DEFAULT_BREAKPOINTS,
      overrides: element.breakpointOverrides,
    });
    const onTablet = resolveLayoutAt({
      width: 768,
      base: element.responsiveLayout,
      geometry: element.geometry,
      breakpoints: DEFAULT_BREAKPOINTS,
      overrides: element.breakpointOverrides,
    });

    expect(onMobile.geometry.x).toBe(16);
    expect(onTablet.geometry.x).toBe(FAR_RIGHT_X);
  });
});
