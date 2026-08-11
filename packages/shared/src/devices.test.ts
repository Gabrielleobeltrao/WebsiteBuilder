import { describe, expect, it } from "vitest";

import {
  DEFAULT_BREAKPOINTS,
  DESIGN_WIDTH,
  MOBILE_PREVIEW_WIDTH,
  TABLET_PREVIEW_WIDTH,
} from "./responsive";
import {
  DEVICE_MODES,
  DEVICE_ORDER,
  DEVICE_SAFE_PADDING,
  deviceForWidth,
  deviceInheritanceChain,
  deviceReferenceWidth,
  inheritsFrom,
} from "./devices";

describe("the three devices", () => {
  it("are exactly three, in inheritance order", () => {
    expect(DEVICE_ORDER).toEqual(["desktop", "tablet", "mobile"]);
    expect(Object.keys(DEVICE_MODES).sort()).toEqual(["desktop", "mobile", "tablet"]);
  });

  it("are the only source of the reference widths", () => {
    // The values other modules used to restate. Derived, so a change here moves everything at once.
    expect(DESIGN_WIDTH).toBe(deviceReferenceWidth("desktop"));
    expect(TABLET_PREVIEW_WIDTH).toBe(deviceReferenceWidth("tablet"));
    expect(MOBILE_PREVIEW_WIDTH).toBe(deviceReferenceWidth("mobile"));
  });

  it("produce the breakpoint definitions the resolver uses", () => {
    expect(DEFAULT_BREAKPOINTS.map((breakpoint) => breakpoint.id)).toEqual([...DEVICE_ORDER]);
    for (const breakpoint of DEFAULT_BREAKPOINTS) {
      expect(breakpoint.maxWidth).toBe(DEVICE_MODES[breakpoint.id as keyof typeof DEVICE_MODES].maxWidth);
    }
  });
});

describe("which device a width is", () => {
  it.each([
    [320, "mobile"],
    [390, "mobile"],
    [640, "mobile"],
    [641, "tablet"],
    [768, "tablet"],
    [1024, "tablet"],
    [1025, "desktop"],
    [1440, "desktop"],
    [1920, "desktop"],
  ])("calls %ipx %s", (width, expected) => {
    expect(deviceForWidth(width)).toBe(expected);
  });

  it("treats a screen wider than the canvas as a desktop, not an unhandled case", () => {
    expect(deviceForWidth(3840)).toBe("desktop");
  });
});

describe("inheritance", () => {
  it("flows widest to narrowest and never back", () => {
    expect(deviceInheritanceChain("desktop")).toEqual(["desktop"]);
    expect(deviceInheritanceChain("tablet")).toEqual(["desktop", "tablet"]);
    expect(deviceInheritanceChain("mobile")).toEqual(["desktop", "tablet", "mobile"]);
  });

  it("knows which device is the ancestor", () => {
    expect(inheritsFrom("mobile", "desktop")).toBe(true);
    expect(inheritsFrom("mobile", "tablet")).toBe(true);
    // The direction that must never be true: editing mobile cannot reach desktop.
    expect(inheritsFrom("desktop", "mobile")).toBe(false);
    expect(inheritsFrom("tablet", "mobile")).toBe(false);
  });
});

describe("safe padding", () => {
  it("gives narrower devices more breathing room, and desktop none", () => {
    // An element flush against a phone's edge is one a thumb covers.
    expect(DEVICE_SAFE_PADDING.mobile).toBeGreaterThan(0);
    expect(DEVICE_SAFE_PADDING.tablet).toBeGreaterThan(DEVICE_SAFE_PADDING.mobile);
    expect(DEVICE_SAFE_PADDING.desktop).toBe(0);
  });
});
