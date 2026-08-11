import { describe, expect, it } from "vitest";

import { DEVICE_MODES } from "./devices";
import { px } from "./responsive";
import { deviceOriginOf, resolveElementForDevice, resolveSectionForDevice } from "./resolve";

const base = {
  width: px(280),
  height: px(48),
  horizontalConstraint: "left" as const,
  verticalConstraint: "top" as const,
  visible: true,
};

const geometry = { x: 1100, y: 40, width: 280, height: 48, rotation: 0 };

describe("resolving an element for a device", () => {
  it("returns the desktop values when nothing overrides them", () => {
    const resolved = resolveElementForDevice({ device: "desktop", base, geometry });

    expect(resolved.authoredGeometry).toEqual(geometry);
    expect(resolved.origins).toEqual({ geometry: "desktop", layout: "desktop", style: null });
  });

  it("prefers a mobile override over a tablet one, and tablet over desktop", () => {
    const overrides = {
      tablet: { geometry: { x: 400 } },
      mobile: { geometry: { x: 16 } },
    };

    expect(resolveElementForDevice({ device: "tablet", base, geometry, overrides }).authoredGeometry.x).toBe(400);
    expect(resolveElementForDevice({ device: "mobile", base, geometry, overrides }).authoredGeometry.x).toBe(16);
    expect(resolveElementForDevice({ device: "desktop", base, geometry, overrides }).authoredGeometry.x).toBe(1100);
  });

  it("inherits a tablet override on mobile when mobile sets nothing", () => {
    const overrides = { tablet: { geometry: { x: 400 } } };
    const resolved = resolveElementForDevice({ device: "mobile", base, geometry, overrides });

    expect(resolved.authoredGeometry.x).toBe(400);
    expect(resolved.origins.geometry).toBe("tablet");
  });

  it("applies only the keys an override actually sets", () => {
    const overrides = { mobile: { geometry: { x: 16 } } };
    const resolved = resolveElementForDevice({ device: "mobile", base, geometry, overrides });

    // Width was never overridden, so it inherits rather than resetting to a default.
    expect(resolved.authoredGeometry.width).toBe(280);
  });

  it("reads device geometry against that device's canvas, not the desktop one", () => {
    // Someone dragged this to x=16 while looking at a 390px canvas. Interpreting those pixels
    // against 1440 would put it somewhere they never placed it.
    const overrides = { mobile: { geometry: { x: 16, width: 358 } } };
    const resolved = resolveElementForDevice({ device: "mobile", base, geometry, overrides });

    expect(resolved.referenceWidth).toBe(DEVICE_MODES.mobile.referenceWidth);
    expect(resolved.geometry).toMatchObject({ x: 16, width: 358 });
  });

  it("honours an explicitly recorded reference width", () => {
    const overrides = { mobile: { geometry: { x: 100 }, referenceWidth: 320 } };
    const resolved = resolveElementForDevice({ device: "mobile", width: 320, base, geometry, overrides });

    expect(resolved.referenceWidth).toBe(320);
    expect(resolved.geometry.x).toBe(100);
  });

  it("brings a far-right element back inside a phone when the constraint says to", () => {
    const resolved = resolveElementForDevice({
      device: "mobile",
      base: { ...base, horizontalConstraint: "right" },
      geometry,
    });

    expect(resolved.geometry.x).toBeGreaterThanOrEqual(0);
    expect(resolved.geometry.x + resolved.geometry.width).toBeLessThanOrEqual(
      DEVICE_MODES.mobile.referenceWidth,
    );
  });

  it("reports which device supplied a style override", () => {
    const overrides = { tablet: { style: { type: "text" as const, lineHeight: 1.2 } } };
    const onMobile = resolveElementForDevice({ device: "mobile", base, geometry, overrides });

    expect(onMobile.style).toEqual({ type: "text", lineHeight: 1.2 });
    expect(onMobile.origins.style).toBe("tablet");
  });
});

describe("resolving a section for a device", () => {
  it("inherits height down the chain and reports where it came from", () => {
    const resolved = resolveSectionForDevice({
      device: "mobile",
      heightByBreakpoint: { desktop: px(600), tablet: px(400) },
      layoutByBreakpoint: {},
    });

    expect(resolved.height).toEqual(px(400));
    expect(resolved.origins.height).toBe("tablet");
  });

  it("merges layout rather than replacing it", () => {
    // A device that changes only the gap must keep the columns it inherited, or every narrow
    // override would silently reset everything it did not mention.
    const resolved = resolveSectionForDevice({
      device: "mobile",
      heightByBreakpoint: {},
      layoutByBreakpoint: { desktop: { columns: 3, rowGap: 24 }, mobile: { rowGap: 8 } },
    });

    expect(resolved.layout).toEqual({ columns: 3, rowGap: 8 });
  });

  it("reports nothing where nothing was ever set", () => {
    const resolved = resolveSectionForDevice({ device: "desktop", heightByBreakpoint: {}, layoutByBreakpoint: {} });
    expect(resolved).toEqual({ height: null, layout: {}, origins: { height: null, layout: null } });
  });
});

describe("labelling where a value came from", () => {
  it("distinguishes base, inherited and overridden", () => {
    expect(deviceOriginOf("mobile", null)).toBe("base");
    expect(deviceOriginOf("mobile", "desktop")).toBe("inherited");
    expect(deviceOriginOf("mobile", "tablet")).toBe("inherited");
    expect(deviceOriginOf("mobile", "mobile")).toBe("override");
    // Only an override can be reset, so desktop's own value counts as one.
    expect(deviceOriginOf("desktop", "desktop")).toBe("override");
  });
});
