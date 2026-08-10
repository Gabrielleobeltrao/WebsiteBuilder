import { describe, expect, it } from "vitest";

import {
  breakpointInheritanceChain,
  DEFAULT_BREAKPOINTS,
  numericLengthSchema,
  resolveBreakpointAt,
  responsiveLengthSchema,
  serializeLength,
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
