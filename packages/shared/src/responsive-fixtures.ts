import { createEmptySection, createPage, createProjectDocument } from "./project";
import { px } from "./responsive";
import type { BuilderElement } from "./elements";
import type { BuilderPage, BuilderSection } from "./project";

/**
 * Documents that reproduce the responsive failures this work exists to fix.
 *
 * Deliberately not exported from the package index. They are shared between the frontend renderer
 * tests and the backend SSR tests because the whole point is that those two must agree — a fixture
 * defined twice is a fixture that can disagree with itself, which is the same class of bug being
 * fixed here one level down.
 *
 * Every element here is the kind a person actually makes: a headline pushed to the right of a wide
 * canvas, a centred call to action, a band stretched across the page. None of them is contrived,
 * and on a phone today most of them leave the screen.
 */

const DESIGN_WIDTH = 1440;

type ElementInput = {
  id: string;
  x: number;
  y: number;
  width: number;
  height?: number;
  horizontalConstraint?: "left" | "right" | "center" | "stretch" | "scale";
  breakpointOverrides?: BuilderElement["breakpointOverrides"];
};

/** A button, because a button is the element whose escape a visitor notices first. */
export function fixtureButton(input: ElementInput): BuilderElement {
  const height = input.height ?? 48;
  return {
    id: input.id,
    name: input.id,
    type: "button",
    text: "Read more",
    link: { kind: "external", url: "https://example.test/", newTab: false },
    geometry: { x: input.x, y: input.y, width: input.width, height, rotation: 0 },
    responsiveLayout: {
      width: px(input.width),
      height: px(height),
      horizontalConstraint: input.horizontalConstraint ?? "left",
      verticalConstraint: "top",
      visible: true,
    },
    ...(input.breakpointOverrides === undefined ? {} : { breakpointOverrides: input.breakpointOverrides }),
    zIndex: 1,
    locked: false,
    hidden: false,
    style: {
      fontSize: px(16),
      fontWeight: 600,
      textColor: "#ffffff",
      backgroundColor: "#2f6df6",
      borderRadius: 8,
      horizontalAlign: "center",
    },
  } as unknown as BuilderElement;
}

export function fixtureText(input: ElementInput & { content?: string }): BuilderElement {
  const height = input.height ?? 60;
  return {
    id: input.id,
    name: input.id,
    type: "text",
    tag: "p",
    content: input.content ?? "A line of copy long enough to need room.",
    geometry: { x: input.x, y: input.y, width: input.width, height, rotation: 0 },
    responsiveLayout: {
      width: px(input.width),
      height: px(height),
      horizontalConstraint: input.horizontalConstraint ?? "left",
      verticalConstraint: "top",
      visible: true,
    },
    ...(input.breakpointOverrides === undefined ? {} : { breakpointOverrides: input.breakpointOverrides }),
    zIndex: 1,
    locked: false,
    hidden: false,
    style: {
      fontFamily: "Inter",
      fontSize: px(18),
      fontWeight: 400,
      fontStyle: "normal",
      textAlign: "left",
      color: "#0d1424",
      lineHeight: 1.4,
    },
  } as unknown as BuilderElement;
}

export function fixtureSection(
  id: string,
  layoutMode: "free" | "grid" | "flex",
  elements: BuilderElement[],
): BuilderSection {
  return {
    ...createEmptySection(),
    id,
    name: id,
    layoutMode,
    heightByBreakpoint: { desktop: px(600) },
    elements,
  };
}

/**
 * The element that made this plan necessary.
 *
 * Authored at x=1100 on a 1440 canvas with the default `left` constraint. At 390 px its left edge
 * alone is nearly three screens out — and because the published renderer positions from base
 * geometry, that is exactly where a visitor's browser puts it.
 */
export const FAR_RIGHT_X = 1100;
export const FAR_RIGHT_WIDTH = 280;

export function freeSectionFixture(): BuilderSection {
  return fixtureSection("free-section", "free", [
    fixtureButton({ id: "far-right", x: FAR_RIGHT_X, y: 40, width: FAR_RIGHT_WIDTH }),
    fixtureButton({ id: "centred", x: 610, y: 140, width: 220, horizontalConstraint: "center" }),
    fixtureText({ id: "stretched", x: 80, y: 260, width: DESIGN_WIDTH - 160, horizontalConstraint: "stretch" }),
    fixtureButton({ id: "right-anchored", x: 1160, y: 380, width: 200, horizontalConstraint: "right" }),
    fixtureButton({ id: "scaled", x: 200, y: 470, width: 400, horizontalConstraint: "scale" }),
  ]);
}

export function gridSectionFixture(): BuilderSection {
  return fixtureSection("grid-section", "grid", [
    fixtureText({ id: "grid-one", x: 0, y: 0, width: 400 }),
    fixtureText({ id: "grid-two", x: 0, y: 0, width: 400 }),
    fixtureText({ id: "grid-three", x: 0, y: 0, width: 400 }),
  ]);
}

export function flexSectionFixture(): BuilderSection {
  return fixtureSection("flex-section", "flex", [
    fixtureText({
      id: "flex-long",
      x: 0,
      y: 0,
      width: 900,
      content: "Supercalifragilisticexpialidocious-antidisestablishmentarianism-pneumonoultramicroscopic",
    }),
    fixtureButton({ id: "flex-button", x: 0, y: 0, width: 240 }),
  ]);
}

/**
 * A document as it exists in the database today: authored on desktop, with no device overrides at
 * all, because nothing in the product has ever written one.
 */
export function legacyDesktopOnlyProject(): ReturnType<typeof createProjectDocument> {
  const project = createProjectDocument({ name: "Legacy", slug: "legacy" });
  const home = project.pages[0]!;
  home.sections = [freeSectionFixture(), gridSectionFixture(), flexSectionFixture()];
  return project;
}

/** The same document after someone refined it per device, which is what the editor must produce. */
export function overriddenProject(): ReturnType<typeof createProjectDocument> {
  const project = legacyDesktopOnlyProject();
  const free = project.pages[0]!.sections[0]!;
  free.elements = free.elements.map((element) =>
    element.id !== "far-right"
      ? element
      : ({
          ...element,
          breakpointOverrides: {
            mobile: { geometry: { x: 16, width: 358 } },
          },
        } as BuilderElement),
  );
  return project;
}

/** A page carrying one free section, for tests that want the smallest possible case. */
export function pageWith(sections: BuilderSection[]): BuilderPage {
  const page = createPage({ name: "Home", isHome: true });
  page.sections = sections;
  return page;
}

/** The widths every responsive assertion in this work is made at. */
export const FIXTURE_WIDTHS = [320, 390, 768, 1024, 1440] as const;
