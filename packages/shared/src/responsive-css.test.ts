import { describe, expect, it } from "vitest";

import { DEVICE_MODES } from "./devices";
import { compilePageCss, PUBLISHED_BASE_CSS } from "./responsive-css";
import { flexSectionFixture, freeSectionFixture, gridSectionFixture, pageWith } from "./responsive-fixtures";
import { migrateDocumentResponsive } from "./responsive-migration";
import { fixtureButton, fixtureSection } from "./responsive-fixtures";

const cssFor = (page: ReturnType<typeof pageWith>) => compilePageCss(page);

/** The declarations that apply to one element outside any media query. */
function baseRule(css: string, elementId: string): string {
  const match = css.match(new RegExp(`\\[data-element-id="${elementId}"\\]\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

/** The declarations a device's media query adds for one element. */
function deviceRule(css: string, device: "tablet" | "mobile", elementId: string): string {
  const query = `@media \\(max-width:${DEVICE_MODES[device].maxWidth}px\\)`;
  const match = css.match(new RegExp(`${query}\\{\\[data-page-id="[^"]*"\\] \\[data-element-id="${elementId}"\\]\\{([^}]*)\\}\\}`));
  return match?.[1] ?? "";
}

describe("constraints become CSS that holds at every width", () => {
  const css = cssFor(pageWith([freeSectionFixture()]));

  it("anchors a left element by its authored gap", () => {
    expect(baseRule(css, "far-right")).toContain("left:1100px");
  });

  it("anchors a right element to the other edge instead of computing a position", () => {
    // Authored 80px from the right of a 1440 canvas. Expressed as a right offset, it is 80px from
    // the right at 320 and at 1920 without anything recomputing it.
    const rule = baseRule(css, "right-anchored");
    expect(rule).toContain("right:80px");
    expect(rule).not.toContain("left:");
  });

  it("centres a centred element with a rule that is true continuously", () => {
    // Not "centred at 390 and again at 768": a browser at 500 would then use the 390 value and the
    // element would not be centred.
    const rule = baseRule(css, "centred");
    expect(rule).toContain("left:50%");
    expect(rule).toContain("transform:translateX(-50%)");
  });

  it("stretches by holding both gaps and letting the browser find the width", () => {
    const rule = baseRule(css, "stretched");
    expect(rule).toContain("left:80px");
    expect(rule).toContain("right:80px");
    expect(rule).toContain("width:auto");
  });

  it("scales in percentages of the canvas", () => {
    const rule = baseRule(css, "scaled");
    expect(rule).toMatch(/left:13\.89%/);
    expect(rule).toMatch(/width:27\.78%/);
  });
});

describe("device overrides", () => {
  it("appear only in that device's media query", () => {
    const { document } = migrateDocumentResponsive({ pages: [pageWith([freeSectionFixture()])] });
    const css = cssFor(document.pages[0]!);

    // Desktop keeps what the author drew; the phone gets the migrated placement.
    expect(baseRule(css, "far-right")).toContain("left:1100px");
    expect(deviceRule(css, "mobile", "far-right")).toContain(`left:${16}px`);
  });

  it("emits nothing for a device that resolves to the same values", () => {
    // A media query restating its parent is bytes on a visitor's connection for no visible change.
    const css = cssFor(pageWith([freeSectionFixture()]));
    expect(deviceRule(css, "tablet", "centred")).toBe("");
    expect(deviceRule(css, "mobile", "centred")).toBe("");
  });

  it("uses the device's own canvas for geometry authored there", () => {
    const section = fixtureSection("s", "free", [
      fixtureButton({
        id: "moved",
        x: 100,
        y: 0,
        width: 200,
        breakpointOverrides: { mobile: { geometry: { x: 16, width: 200 }, referenceWidth: 390 } },
      }),
    ]);

    const css = cssFor(pageWith([section]));
    expect(deviceRule(css, "mobile", "moved")).toContain("left:16px");
  });
});

describe("sections", () => {
  it("compiles grid columns and gaps", () => {
    const css = cssFor(pageWith([gridSectionFixture()]));
    expect(css).toContain("[data-section-id=\"grid-section\"]{");
    expect(css).toContain("grid-template-columns");
  });

  it("compiles flex direction and wrapping", () => {
    const css = cssFor(pageWith([flexSectionFixture()]));
    expect(css).toContain("display:flex");
  });

  it("makes a free section the positioning context its children need", () => {
    const css = cssFor(pageWith([freeSectionFixture()]));
    expect(css).toMatch(/\[data-section-id="free-section"\]\{[^}]*position:relative/);
  });

  it("skips a hidden section entirely", () => {
    const page = pageWith([{ ...freeSectionFixture(), hidden: true }]);
    expect(cssFor(page)).toBe("");
  });
});

describe("what cannot get into the stylesheet", () => {
  it("escapes an identifier that could close a selector", () => {
    const section = fixtureSection('sec"tion', "free", [fixtureButton({ id: 'el"id', x: 0, y: 0, width: 10 })]);
    const css = cssFor(pageWith([section]));

    // The quote is escaped rather than ending the attribute selector and starting a declaration.
    expect(css).toContain('\\"');
    expect(css).not.toMatch(/\[data-element-id="el"id"\]/);
  });

  it("emits only numbers and keywords for geometry", () => {
    const css = cssFor(pageWith([freeSectionFixture()]));
    const declarations = css.match(/\{([^}]*)\}/g) ?? [];

    for (const block of declarations) {
      // No value may contain a semicolon-separated injection, a url(), or an expression.
      expect(block).not.toMatch(/url\(/i);
      expect(block).not.toMatch(/expression\(/i);
      expect(block).not.toMatch(/javascript:/i);
    }
  });
});

describe("determinism", () => {
  it("produces identical bytes for the same document", () => {
    // The same page, compiled twice. Two separately built pages would differ by their generated
    // ids, which says nothing about the compiler.
    const page = pageWith([freeSectionFixture(), gridSectionFixture()]);
    expect(compilePageCss(page)).toBe(compilePageCss(page));
  });

  it("does not depend on the order sections were built in", () => {
    const free = freeSectionFixture();
    const grid = gridSectionFixture();
    const page = pageWith([free, grid]);

    expect(compilePageCss(page)).toBe(compilePageCss({ ...page, sections: [free, grid] }));
  });

  it("rounds to a stable precision", () => {
    const css = cssFor(pageWith([freeSectionFixture()]));
    // Two decimals: enough for a layout, stable enough that a content hash means something.
    for (const value of css.match(/[\d.]+%/g) ?? []) {
      const decimals = value.split(".")[1]?.replace("%", "") ?? "";
      expect(decimals.length).toBeLessThanOrEqual(2);
    }
  });
});

describe("the published defaults", () => {
  it("normalise the browser's own surprises", () => {
    expect(PUBLISHED_BASE_CSS).toContain("box-sizing:border-box");
    expect(PUBLISHED_BASE_CSS).toContain("body{margin:0}");
    expect(PUBLISHED_BASE_CSS).toContain("max-width:100%");
    expect(PUBLISHED_BASE_CSS).toContain("overflow-wrap:break-word");
  });

  it("never hide authored overflow", () => {
    // Hiding it makes a broken layout look fixed while the content stays unreachable, and nobody is
    // ever told. The diagnostics report it instead.
    expect(PUBLISHED_BASE_CSS).not.toContain("overflow-x:hidden");
    expect(PUBLISHED_BASE_CSS).not.toContain("overflow:hidden");
  });
});
