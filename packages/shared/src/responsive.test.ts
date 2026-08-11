import { describe, expect, it } from "vitest";

import {
  breakpointInheritanceChain,
  DEFAULT_BREAKPOINTS,
  fluidLength,
  isReadableFontSize,
  numericLengthSchema,
  px,
  resolveBreakpointAt,
  responsiveLengthSchema,
  serializeLength,
  type ResponsiveLength,
} from "./responsive";

describe("responsive length validation", () => {
  it("rejects units outside the allowlist", () => {
    expect(numericLengthSchema.safeParse({ value: 10, unit: "pt" }).success).toBe(false);
    expect(numericLengthSchema.safeParse({ value: 10, unit: "px" }).success).toBe(true);
  });

  it("rejects non-finite numbers that would serialise into invalid CSS", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(numericLengthSchema.safeParse({ value, unit: "px" }).success).toBe(false);
    }
  });

  it("rejects an arbitrary CSS string in place of a structured value", () => {
    expect(responsiveLengthSchema.safeParse("100px; background: url(evil)").success).toBe(false);
    expect(responsiveLengthSchema.safeParse({ keyword: "expression(alert(1))" }).success).toBe(false);
  });

  it("rejects extra properties smuggled beside a valid value", () => {
    expect(numericLengthSchema.safeParse({ value: 10, unit: "px", important: true }).success).toBe(false);
  });
});

describe("serializeLength", () => {
  it("emits only allowlisted output", () => {
    expect(serializeLength({ value: 24, unit: "px" })).toBe("24px");
    expect(serializeLength({ keyword: "auto" })).toBe("auto");
    expect(
      serializeLength({
        clamp: { min: { value: 16, unit: "px" }, preferred: { value: 2, unit: "vw" }, max: { value: 32, unit: "px" } },
      }),
    ).toBe("clamp(16px, 2vw, 32px)");
  });

  it("rounds to a stable precision so content hashes do not drift", () => {
    expect(serializeLength({ value: 1 / 3, unit: "rem" })).toBe("0.3333rem");
  });
});

describe("breakpoint resolution", () => {
  it("resolves the narrowest breakpoint containing the width", () => {
    expect(resolveBreakpointAt(390, DEFAULT_BREAKPOINTS)?.id).toBe("mobile");
    expect(resolveBreakpointAt(768, DEFAULT_BREAKPOINTS)?.id).toBe("tablet");
    expect(resolveBreakpointAt(1440, DEFAULT_BREAKPOINTS)?.id).toBe("desktop");
  });

  it("treats maxWidth as inclusive at the boundary", () => {
    expect(resolveBreakpointAt(640, DEFAULT_BREAKPOINTS)?.id).toBe("mobile");
    expect(resolveBreakpointAt(641, DEFAULT_BREAKPOINTS)?.id).toBe("tablet");
    expect(resolveBreakpointAt(1024, DEFAULT_BREAKPOINTS)?.id).toBe("tablet");
    expect(resolveBreakpointAt(1025, DEFAULT_BREAKPOINTS)?.id).toBe("desktop");
  });

  it("does not depend on the stored array order", () => {
    const shuffled = [...DEFAULT_BREAKPOINTS].reverse();
    expect(resolveBreakpointAt(390, shuffled)?.id).toBe("mobile");
  });

  it("inherits from the widest applicable rule down to the narrowest", () => {
    expect(breakpointInheritanceChain(390, DEFAULT_BREAKPOINTS).map((b) => b.id)).toEqual([
      "desktop",
      "tablet",
      "mobile",
    ]);
    expect(breakpointInheritanceChain(1440, DEFAULT_BREAKPOINTS).map((b) => b.id)).toEqual(["desktop"]);
  });
});

describe("fluid lengths", () => {
  const at = (length: ResponsiveLength, width: number): number => {
    // Evaluates the generated clamp the way a browser would, so the assertions test the CSS that
    // actually ships rather than the inputs that produced it.
    const css = serializeLength(length);
    const match = /^clamp\((-?[\d.]+)px, (?:calc\((-?[\d.]+)px \+ (-?[\d.]+)vw\)|(-?[\d.]+)vw), (-?[\d.]+)px\)$/.exec(css);
    if (match === null) throw new Error(`not a fluid clamp: ${css}`);

    const [, min, base = "0", vwWithBase, vwAlone, max] = match;
    const vw = Number(vwWithBase ?? vwAlone ?? 0);
    const preferred = Number(base) + (vw / 100) * width;
    return Math.min(Math.max(preferred, Number(min)), Number(max));
  };

  const body = fluidLength({ minPx: 16, maxPx: 24, minViewportPx: 320, maxViewportPx: 1440 });

  it("passes through both endpoints exactly", () => {
    expect(at(body, 320)).toBeCloseTo(16, 2);
    expect(at(body, 1440)).toBeCloseTo(24, 2);
  });

  it("grows monotonically between them", () => {
    const widths = [320, 375, 390, 640, 768, 1024, 1280, 1440];
    const sizes = widths.map((width) => at(body, width));

    for (let index = 1; index < sizes.length; index += 1) {
      expect(sizes[index]!).toBeGreaterThanOrEqual(sizes[index - 1]!);
    }
  });

  it("never falls below the minimum or exceeds the maximum outside the range", () => {
    expect(at(body, 200)).toBeCloseTo(16, 2);
    expect(at(body, 1920)).toBeCloseTo(24, 2);
  });

  it("treats reversed endpoints as the same curve rather than shrinking as the screen grows", () => {
    const reversed = fluidLength({ minPx: 24, maxPx: 16, minViewportPx: 1440, maxViewportPx: 320 });
    expect(serializeLength(reversed)).toBe(serializeLength(body));
  });

  it("returns a fixed length when there is no curve to describe", () => {
    expect(fluidLength({ minPx: 18, maxPx: 18, minViewportPx: 320, maxViewportPx: 1440 })).toEqual(px(18));
    expect(fluidLength({ minPx: 16, maxPx: 24, minViewportPx: 800, maxViewportPx: 800 })).toEqual(px(16));
  });

  it("emits only allowlisted CSS", () => {
    expect(serializeLength(body)).toMatch(/^clamp\([\d.]+px, calc\(-?[\d.]+px \+ [\d.]+vw\), [\d.]+px\)$/);
  });
});

describe("readable font sizes", () => {
  it("judges a fluid size by its minimum, which is what a phone gets", () => {
    expect(isReadableFontSize(fluidLength({ minPx: 16, maxPx: 24, minViewportPx: 320, maxViewportPx: 1440 }))).toBe(true);
    expect(isReadableFontSize(fluidLength({ minPx: 9, maxPx: 24, minViewportPx: 320, maxViewportPx: 1440 }))).toBe(false);
  });

  it("judges a fixed pixel size directly", () => {
    expect(isReadableFontSize(px(16))).toBe(true);
    expect(isReadableFontSize(px(10))).toBe(false);
  });

  it("reports a relative unit for review rather than passing it", () => {
    // Whether 1rem is readable depends on a root size this function cannot see.
    expect(isReadableFontSize({ value: 1, unit: "rem" })).toBe("unknown");
    expect(isReadableFontSize({ keyword: "auto" })).toBe("unknown");
  });
});
