import { describe, expect, it } from "vitest";

import {
  clampPreviewWidth,
  DEVICE_PRESETS,
  diagnoseResponsive,
  formatRange,
  MAX_PREVIEW_WIDTH,
  MIN_PREVIEW_WIDTH,
} from "./diagnostics";
import type { BuilderElement } from "./elements";
import { createEmptySection, createPage, type BuilderPage } from "./project";
import { SWEEP_WIDTHS } from "./resolve";

const breakpoints = [
  { id: "desktop", name: "Desktop", maxWidth: 4000, order: 0, preset: "desktop" as const },
  { id: "mobile", name: "Mobile", maxWidth: 640, order: 1, preset: "mobile" as const },
];

const layout = {
  width: { value: 320, unit: "px" as const },
  height: { value: 64, unit: "px" as const },
  horizontalConstraint: "left" as const,
  verticalConstraint: "top" as const,
  visible: true,
};

const element = (overrides: Record<string, unknown> = {}): BuilderElement =>
  ({
    id: "e1",
    type: "text",
    name: "Text",
    tag: "p",
    content: "Hello",
    geometry: { x: 0, y: 0, width: 320, height: 64, rotation: 0 },
    responsiveLayout: layout,
    zIndex: 1,
    locked: false,
    hidden: false,
    style: {
      fontFamily: "Inter",
      fontSize: { value: 16, unit: "px" },
      fontWeight: 400,
      fontStyle: "normal",
      textAlign: "left",
      color: "#111111",
      lineHeight: 1.4,
    },
    ...overrides,
  }) as unknown as BuilderElement;

function page(elements: BuilderElement[], layoutMode: "free" | "grid" = "free"): BuilderPage {
  const base = createPage({ name: "Home", isHome: true });
  return { ...base, sections: [{ ...createEmptySection(), layoutMode, elements }] };
}

const run = (elements: BuilderElement[], layoutMode: "free" | "grid" = "free") =>
  diagnoseResponsive({ page: page(elements, layoutMode), path: "/", breakpoints });

describe("preview width", () => {
  it("stays inside the range the sweep covers", () => {
    expect(clampPreviewWidth(100)).toBe(MIN_PREVIEW_WIDTH);
    expect(clampPreviewWidth(5000)).toBe(MAX_PREVIEW_WIDTH);
    expect(clampPreviewWidth(390.4)).toBe(390);
    expect(clampPreviewWidth(Number.NaN)).toBe(MAX_PREVIEW_WIDTH);
  });

  it("offers presets that are all reachable", () => {
    for (const preset of DEVICE_PRESETS) {
      expect(clampPreviewWidth(preset.width)).toBe(preset.width);
    }
  });
});

describe("overflow", () => {
  it("reports an element wider than the narrow screens and names the widths", () => {
    const findings = run([element({ geometry: { x: 0, y: 0, width: 800, height: 64, rotation: 0 } })]);
    const overflow = findings.find((finding) => finding.code === "overflow");

    expect(overflow?.severity).toBe("error");
    expect(overflow?.elementId).toBe("e1");
    expect(overflow?.ranges[0]?.from).toBe(320);
    // Clean once the screen is wider than the element.
    expect(overflow?.ranges.at(-1)?.to).toBeLessThan(800);
  });

  it("reports nothing for an element that fits everywhere", () => {
    expect(run([element()]).filter((finding) => finding.code === "overflow")).toEqual([]);
  });

  it("merges consecutive widths into one finding rather than one per width", () => {
    const findings = run([element({ geometry: { x: 0, y: 0, width: 2000, height: 64, rotation: 0 } })]);
    const overflow = findings.filter((finding) => finding.code === "overflow");

    expect(overflow).toHaveLength(1);
    expect(overflow[0]?.ranges).toHaveLength(1);
  });

  it("ignores position in a grid section, where the layout decides placement", () => {
    const wide = element({ geometry: { x: 0, y: 0, width: 2000, height: 64, rotation: 0 } });
    expect(run([wide], "grid").filter((finding) => finding.code === "overflow")).toEqual([]);
  });

  it("respects a breakpoint override that fixes the overflow", () => {
    const fixed = element({
      geometry: { x: 0, y: 0, width: 800, height: 64, rotation: 0 },
      breakpointOverrides: { mobile: { geometry: { width: 300 } } },
    });

    const overflow = run([fixed]).find((finding) => finding.code === "overflow");
    // Nothing below the mobile boundary, because the override applies there.
    expect(overflow?.ranges.every((range) => range.from > 640)).toBe(true);
  });
});

describe("other diagnostics", () => {
  it("reports an element positioned off the left edge", () => {
    const findings = run([element({ geometry: { x: -50, y: 0, width: 100, height: 64, rotation: 0 } })]);
    expect(findings.some((finding) => finding.code === "off-canvas")).toBe(true);
  });

  it("reports a size that resolves to nothing", () => {
    const findings = run([element({ geometry: { x: 0, y: 0, width: 0, height: 64, rotation: 0 } })]);
    expect(findings.some((finding) => finding.code === "impossible-size")).toBe(true);
  });

  it("reports text too small to read on a phone", () => {
    const tiny = element({
      style: {
        fontFamily: "Inter",
        fontSize: { value: 9, unit: "px" },
        fontWeight: 400,
        fontStyle: "normal",
        textAlign: "left",
        color: "#111111",
        lineHeight: 1.4,
      },
    });

    expect(run([tiny]).some((finding) => finding.code === "small-text")).toBe(true);
  });

  it("reports an image that cannot offer a smaller version", () => {
    const external = element({
      type: "image",
      source: { kind: "url", url: "https://example.com/a.png" },
      alt: "",
      decorative: true,
      style: { objectFit: "cover", borderRadius: 0 },
    });

    expect(run([external]).some((finding) => finding.code === "missing-responsive-asset")).toBe(true);
  });

  it("skips an element hidden at a breakpoint", () => {
    const hiddenOnMobile = element({
      geometry: { x: 0, y: 0, width: 2000, height: 64, rotation: 0 },
      breakpointOverrides: { mobile: { layout: { visible: false } } },
    });

    const overflow = run([hiddenOnMobile]).find((finding) => finding.code === "overflow");
    expect(overflow?.ranges.every((range) => range.from > 640)).toBe(true);
  });
});

describe("overlaps", () => {
  const box = (id: string, x: number, zIndex: number) =>
    element({ id, geometry: { x, y: 0, width: 100, height: 64, rotation: 0 }, zIndex });

  it("reports two elements at the same depth covering each other", () => {
    expect(run([box("a", 0, 1), box("b", 50, 1)]).some((finding) => finding.code === "overlap")).toBe(true);
  });

  it("ignores deliberate layering", () => {
    // Different depths say which one is on top, so this is a design choice rather than a mistake.
    expect(run([box("a", 0, 1), box("b", 50, 2)]).some((finding) => finding.code === "overlap")).toBe(false);
  });

  it("ignores elements that merely sit next to each other", () => {
    expect(run([box("a", 0, 1), box("b", 100, 1)]).some((finding) => finding.code === "overlap")).toBe(false);
  });
});

describe("reporting", () => {
  it("changes nothing about the page", () => {
    const original = page([element({ geometry: { x: 0, y: 0, width: 2000, height: 64, rotation: 0 } })]);
    const snapshot = structuredClone(original);

    diagnoseResponsive({ page: original, path: "/", breakpoints });
    expect(original).toEqual(snapshot);
  });

  it("sweeps both sides of a breakpoint boundary", () => {
    expect(SWEEP_WIDTHS).toContain(640);
    expect(SWEEP_WIDTHS).toContain(641);
  });

  it("formats a single width and a span differently", () => {
    expect(formatRange({ from: 320, to: 320 })).toBe("320px");
    expect(formatRange({ from: 320, to: 640 })).toBe("320–640px");
  });
});
