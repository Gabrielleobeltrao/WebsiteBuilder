import { DESIGN_WIDTH } from "@websitebuilder/shared";
import { describe, expect, it } from "vitest";

import {
  clampZoom,
  constrainGeometry,
  fitZoom,
  handleAxes,
  logicalToScreen,
  MAX_ZOOM,
  MIN_ELEMENT_SIZE,
  MIN_ZOOM,
  pointToLogical,
  RESIZE_HANDLES,
  screenToLogical,
} from "./coordinates";

const geometry = (overrides: Partial<{ x: number; y: number; width: number; height: number }> = {}) => ({
  x: 100,
  y: 50,
  width: 320,
  height: 64,
  rotation: 0,
  ...overrides,
});

describe("zoom", () => {
  it("clamps to a usable range and survives nonsense input", () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("fits the design width without enlarging past 1:1", () => {
    expect(fitZoom(DESIGN_WIDTH + 500)).toBe(1);
    expect(fitZoom(784)).toBeCloseTo(720 / DESIGN_WIDTH, 5);
    expect(fitZoom(0)).toBe(MIN_ZOOM);
  });
});

describe("coordinate conversion", () => {
  it("round-trips at every zoom level", () => {
    for (const zoom of [0.25, 0.5, 1, 1.5, 2, 4]) {
      expect(screenToLogical(logicalToScreen(321, zoom), zoom)).toBeCloseTo(321, 6);
    }
  });

  it("maps a viewport point to logical canvas coordinates", () => {
    expect(pointToLogical({ x: 300, y: 200 }, { x: 100, y: 100 }, 2)).toEqual({ x: 100, y: 50 });
    expect(pointToLogical({ x: 300, y: 200 }, { x: 100, y: 100 }, 0.5)).toEqual({ x: 400, y: 200 });
  });

  it("produces identical logical geometry for the same gesture at different zooms", () => {
    // A 40px on-screen drag means 80 logical px at 50% and 20 logical px at 200%.
    expect(screenToLogical(40, 0.5)).toBe(80);
    expect(screenToLogical(40, 2)).toBe(20);
  });
});

describe("constrainGeometry", () => {
  it("keeps whole logical pixels so repeated drags do not drift", () => {
    const result = constrainGeometry(geometry({ x: 10.4, y: 20.6, width: 100.5, height: 50.5 }));
    expect(result).toEqual({ x: 10, y: 21, width: 101, height: 51, rotation: 0 });
  });

  it("enforces a minimum size instead of allowing an unclickable element", () => {
    const result = constrainGeometry(geometry({ width: 0, height: -20 }));
    expect(result.width).toBe(MIN_ELEMENT_SIZE);
    expect(result.height).toBe(MIN_ELEMENT_SIZE);
  });

  it("never lets an element be dragged fully off canvas", () => {
    const offLeft = constrainGeometry(geometry({ x: -5000, width: 200 }));
    expect(offLeft.x).toBe(MIN_ELEMENT_SIZE - 200);

    const offRight = constrainGeometry(geometry({ x: 99_999 }));
    expect(offRight.x).toBe(DESIGN_WIDTH - MIN_ELEMENT_SIZE);

    const offTop = constrainGeometry(geometry({ y: -400 }));
    expect(offTop.y).toBe(0);
  });

  it("does not impose a full-width size on anything", () => {
    const narrow = constrainGeometry(geometry({ width: 180, height: 48 }));
    expect(narrow.width).toBe(180);
    expect(narrow.height).toBe(48);
  });

  it("allows overlap by leaving positions untouched inside bounds", () => {
    const a = constrainGeometry(geometry({ x: 100, y: 100 }));
    const b = constrainGeometry(geometry({ x: 110, y: 110 }));
    expect(a.x).toBe(100);
    expect(b.x).toBe(110);
  });
});

describe("resize handles", () => {
  it("exposes exactly eight handles: four corners and four sides", () => {
    expect(RESIZE_HANDLES).toHaveLength(8);
    expect([...RESIZE_HANDLES].sort()).toEqual(["e", "n", "ne", "nw", "s", "se", "sw", "w"]);
  });

  it("resizes both axes from a corner and one axis from a side", () => {
    for (const corner of ["nw", "ne", "se", "sw"] as const) {
      expect(handleAxes(corner)).toEqual({ horizontal: true, vertical: true });
    }
    expect(handleAxes("n")).toEqual({ horizontal: false, vertical: true });
    expect(handleAxes("s")).toEqual({ horizontal: false, vertical: true });
    expect(handleAxes("e")).toEqual({ horizontal: true, vertical: false });
    expect(handleAxes("w")).toEqual({ horizontal: true, vertical: false });
  });
});
