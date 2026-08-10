import { describe, expect, it } from "vitest";

import {
  applyConstraints,
  diagnoseWidths,
  originOf,
  resolveLayoutAt,
  serializeResolvedLayout,
  SWEEP_WIDTHS,
} from "./resolve";
import { DEFAULT_BREAKPOINTS, DESIGN_WIDTH, type Geometry, type ResponsiveElementLayout } from "./responsive";

const base: ResponsiveElementLayout = {
  width: { value: 320, unit: "px" },
  height: { value: 64, unit: "px" },
  horizontalConstraint: "left",
  verticalConstraint: "top",
  visible: true,
};

const geometry: Geometry = { x: 100, y: 50, width: 320, height: 64, rotation: 0 };

describe("resolveLayoutAt", () => {
  it("returns the base layout when no override applies", () => {
    const resolved = resolveLayoutAt({ width: 1440, base, geometry, breakpoints: DEFAULT_BREAKPOINTS });
    expect(resolved.layout.width).toEqual({ value: 320, unit: "px" });
    expect(resolved.geometry.width).toBe(320);
    expect(resolved.appliedFrom).toEqual([]);
  });

  it("applies the narrowest matching override, and lets it beat wider ones", () => {
    const resolved = resolveLayoutAt({
      width: 390,
      base,
      geometry,
      breakpoints: DEFAULT_BREAKPOINTS,
      overrides: {
        tablet: { layout: { width: { value: 200, unit: "px" } } },
        mobile: { layout: { width: { value: 100, unit: "px" } } },
      },
    });
    expect(resolved.layout.width).toEqual({ value: 100, unit: "px" });
    expect(resolved.appliedFrom).toEqual(["tablet", "mobile"]);
  });

  it("inherits from the nearest larger rule for keys the narrower one did not set", () => {
    const resolved = resolveLayoutAt({
      width: 390,
      base,
      geometry,
      breakpoints: DEFAULT_BREAKPOINTS,
      overrides: {
        tablet: { layout: { width: { value: 200, unit: "px" }, horizontalConstraint: "center" } },
        mobile: { layout: { width: { value: 100, unit: "px" } } },
      },
    });
    expect(resolved.layout.width).toEqual({ value: 100, unit: "px" });
    expect(resolved.layout.horizontalConstraint).toBe("center");
  });

  it("does not depend on the stored order of the breakpoint array", () => {
    const shuffled = [...DEFAULT_BREAKPOINTS].reverse();
    const overrides = { mobile: { layout: { width: { value: 100, unit: "px" as const } } } };

    expect(resolveLayoutAt({ width: 390, base, geometry, breakpoints: shuffled, overrides }).layout.width).toEqual(
      resolveLayoutAt({ width: 390, base, geometry, breakpoints: DEFAULT_BREAKPOINTS, overrides }).layout.width,
    );
  });

  it("never mutates the base or the geometry it was given", () => {
    const frozenBase = { ...base };
    const frozenGeometry = { ...geometry };
    resolveLayoutAt({
      width: 390,
      base: frozenBase,
      geometry: frozenGeometry,
      breakpoints: DEFAULT_BREAKPOINTS,
      overrides: { mobile: { layout: { width: { value: 100, unit: "px" } }, geometry: { x: 0 } } },
    });
    expect(frozenBase).toEqual(base);
    expect(frozenGeometry).toEqual(geometry);
  });

  it("applies geometry overrides alongside layout ones", () => {
    const resolved = resolveLayoutAt({
      width: 390,
      base,
      geometry,
      breakpoints: DEFAULT_BREAKPOINTS,
      overrides: { mobile: { geometry: { x: 8, height: 120 } } },
    });
    expect(resolved.geometry.x).toBe(8);
    expect(resolved.geometry.height).toBe(120);
    expect(resolved.geometry.y).toBe(50);
    // The structured layout width is untouched by a geometry override.
    expect(resolved.layout.width).toEqual({ value: 320, unit: "px" });
  });
});

describe("originOf", () => {
  const overrides = { tablet: { layout: { width: { value: 200, unit: "px" as const } } } };

  it("reports base when nothing overrode the property", () => {
    expect(originOf({ property: "height", width: 390, breakpoints: DEFAULT_BREAKPOINTS, overrides })).toEqual({
      origin: "base",
      breakpointId: null,
    });
  });

  it("reports an override at the breakpoint currently being edited", () => {
    expect(originOf({ property: "width", width: 768, breakpoints: DEFAULT_BREAKPOINTS, overrides })).toEqual({
      origin: "override",
      breakpointId: "tablet",
    });
  });

  it("reports inherited when the value came from a wider rule", () => {
    expect(originOf({ property: "width", width: 390, breakpoints: DEFAULT_BREAKPOINTS, overrides })).toEqual({
      origin: "inherited",
      breakpointId: "tablet",
    });
  });
});

describe("applyConstraints", () => {
  it("pins a left-constrained element to its original offset", () => {
    expect(applyConstraints({ geometry, layout: base, containerWidth: 390 }).x).toBe(100);
  });

  it("holds the right gap for a right-constrained element", () => {
    const resolved = applyConstraints({
      geometry,
      layout: { ...base, horizontalConstraint: "right" },
      containerWidth: 800,
    });
    const rightGap = DESIGN_WIDTH - (geometry.x + geometry.width);
    expect(resolved.x + resolved.width).toBe(800 - rightGap);
  });

  it("centres a centre-constrained element in any container", () => {
    for (const width of [390, 768, 1440]) {
      const resolved = applyConstraints({
        geometry,
        layout: { ...base, horizontalConstraint: "center" },
        containerWidth: width,
      });
      expect(resolved.x).toBe(Math.round((width - geometry.width) / 2));
    }
  });

  it("stretches by holding both gaps", () => {
    // Left gap 24, right gap 24 against the design width.
    const wide: Geometry = { x: 24, y: 0, width: DESIGN_WIDTH - 48, height: 200, rotation: 0 };
    const resolved = applyConstraints({
      geometry: wide,
      layout: { ...base, horizontalConstraint: "stretch" },
      containerWidth: 800,
    });
    expect(resolved.x).toBe(24);
    expect(resolved.width).toBe(800 - 48);
  });

  it("clamps rather than going negative when the gaps cannot fit", () => {
    const resolved = applyConstraints({
      geometry,
      layout: { ...base, horizontalConstraint: "stretch" },
      containerWidth: 200,
    });
    expect(resolved.width).toBeGreaterThan(0);
  });

  it("scales position and size proportionally", () => {
    const resolved = applyConstraints({
      geometry,
      layout: { ...base, horizontalConstraint: "scale" },
      containerWidth: DESIGN_WIDTH / 2,
    });
    expect(resolved.x).toBe(50);
    expect(resolved.width).toBe(160);
  });

  it("honours an aspect ratio lock", () => {
    const resolved = applyConstraints({
      geometry,
      layout: { ...base, horizontalConstraint: "stretch", aspectRatio: 2 },
      containerWidth: 800,
    });
    expect(resolved.height).toBe(Math.round(resolved.width / 2));
  });

  it("never produces a zero or negative size", () => {
    const resolved = applyConstraints({
      geometry: { ...geometry, x: 0, width: 1440 },
      layout: { ...base, horizontalConstraint: "stretch" },
      containerWidth: 10,
    });
    expect(resolved.width).toBeGreaterThan(0);
  });

  it("leaves the stored geometry untouched at every width", () => {
    const stored = { ...geometry };
    for (const width of SWEEP_WIDTHS) {
      applyConstraints({ geometry: stored, layout: base, containerWidth: width });
    }
    expect(stored).toEqual(geometry);
  });
});

describe("diagnoseWidths", () => {
  it("reports the width range where an element overflows", () => {
    const findings = diagnoseWidths({
      elementId: "e1",
      geometry: { x: 1200, y: 0, width: 400, height: 80, rotation: 0 },
      layout: { ...base, horizontalConstraint: "left" },
      widths: SWEEP_WIDTHS,
    });

    const overflow = findings.find((finding) => finding.code === "horizontal-overflow");
    expect(overflow).toBeDefined();
    expect(overflow?.fromWidth).toBe(320);
  });

  it("reports nothing for a layout that holds across the whole sweep", () => {
    const findings = diagnoseWidths({
      elementId: "e1",
      geometry: { x: 0, y: 0, width: 100, height: 40, rotation: 0 },
      layout: { ...base, horizontalConstraint: "left" },
      widths: SWEEP_WIDTHS,
    });
    expect(findings).toEqual([]);
  });

  it("flags impossible min and max constraints", () => {
    const findings = diagnoseWidths({
      elementId: "e1",
      geometry,
      layout: {
        ...base,
        minWidth: { value: 500, unit: "px" },
        maxWidth: { value: 100, unit: "px" },
      },
      widths: SWEEP_WIDTHS,
    });
    expect(findings.some((finding) => finding.code === "impossible-constraint")).toBe(true);
  });

  it("sweeps intermediate widths, not only the presets", () => {
    expect(SWEEP_WIDTHS).toContain(834);
    expect(SWEEP_WIDTHS).toContain(1180);
    expect(Math.min(...SWEEP_WIDTHS)).toBe(320);
    expect(Math.max(...SWEEP_WIDTHS)).toBe(1920);
  });
});

describe("serializeResolvedLayout", () => {
  it("emits only allowlisted lengths", () => {
    const css = serializeResolvedLayout({
      layout: { ...base, minWidth: { value: 10, unit: "rem" } },
      geometry,
      appliedFrom: [],
    });
    expect(css.width).toBe("320px");
    expect(css.minWidth).toBe("10rem");
  });

  it("hides an element whose resolved visibility is false", () => {
    const css = serializeResolvedLayout({ layout: { ...base, visible: false }, geometry, appliedFrom: [] });
    expect(css.display).toBe("none");
  });
});
