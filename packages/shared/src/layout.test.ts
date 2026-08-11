import { describe, expect, it } from "vitest";

import {
  DEFAULT_FLEX_LAYOUT,
  DEFAULT_GRID_LAYOUT,
  flexLayoutSchema,
  gridLayoutSchema,
  readFlexLayout,
  readGridLayout,
  serializeFlexChild,
  serializeFlexLayout,
  serializeGridChild,
  serializeGridLayout,
  resolveSectionLayout,
  clampGridChild,
} from "./layout";

describe("grid layout", () => {
  it("uses auto-fit with minmax so columns adapt without a per-width override", () => {
    const css = serializeGridLayout({ ...DEFAULT_GRID_LAYOUT, autoMode: "auto-fit" as const, minColumnWidth: 240 });
    expect(css.gridTemplateColumns).toBe("repeat(auto-fit, minmax(min(240px, 100%), 1fr))");
  });

  it("guards against horizontal overflow in a narrow container", () => {
    const css = serializeGridLayout({ ...DEFAULT_GRID_LAYOUT, autoMode: "auto-fit" as const, minColumnWidth: 900 });
    expect(css.gridTemplateColumns).toContain("min(900px, 100%)");
  });

  it("uses a fixed column count when the mode is fixed", () => {
    const css = serializeGridLayout({ ...DEFAULT_GRID_LAYOUT, autoMode: "fixed", columns: 4 });
    expect(css.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
  });

  it("keeps empty tracks with auto-fill, so rows with fewer items stay aligned", () => {
    const css = serializeGridLayout({ ...DEFAULT_GRID_LAYOUT, autoMode: "auto-fill", minColumnWidth: 240 });
    expect(css.gridTemplateColumns).toBe("repeat(auto-fill, minmax(min(240px, 100%), 1fr))");
  });

  it("rejects values outside the allowed range instead of emitting them", () => {
    expect(gridLayoutSchema.safeParse({ ...DEFAULT_GRID_LAYOUT, columns: 0 }).success).toBe(false);
    expect(gridLayoutSchema.safeParse({ ...DEFAULT_GRID_LAYOUT, columns: 99 }).success).toBe(false);
    expect(gridLayoutSchema.safeParse({ ...DEFAULT_GRID_LAYOUT, rowGap: -5 }).success).toBe(false);
  });

  it("rejects an arbitrary CSS string smuggled into a field", () => {
    expect(gridLayoutSchema.safeParse({ ...DEFAULT_GRID_LAYOUT, justifyItems: "url(evil)" }).success).toBe(false);
    expect(gridLayoutSchema.safeParse({ ...DEFAULT_GRID_LAYOUT, rowGap: "24px; color: red" }).success).toBe(false);
  });

  it("falls back to defaults for stored data it cannot trust", () => {
    expect(readGridLayout(undefined)).toEqual(DEFAULT_GRID_LAYOUT);
    expect(readGridLayout({ columns: "many" })).toEqual(DEFAULT_GRID_LAYOUT);
  });

  it("spans children by whole columns and rows", () => {
    expect(serializeGridChild({ columnSpan: 2, rowSpan: 1, order: 0 })).toEqual({
      gridColumn: "span 2",
      gridRow: "span 1",
      order: "0",
      minWidth: "0",
    });
  });
});

describe("flex layout", () => {
  it("maps start and end to flex-start and flex-end", () => {
    expect(serializeFlexLayout({ ...DEFAULT_FLEX_LAYOUT, justifyContent: "start" }).justifyContent).toBe("flex-start");
    expect(serializeFlexLayout({ ...DEFAULT_FLEX_LAYOUT, justifyContent: "end" }).justifyContent).toBe("flex-end");
    expect(serializeFlexLayout({ ...DEFAULT_FLEX_LAYOUT, justifyContent: "space-between" }).justifyContent).toBe(
      "space-between",
    );
  });

  it("wraps by default, so a row does not force horizontal overflow", () => {
    expect(DEFAULT_FLEX_LAYOUT.wrap).toBe("wrap");
  });

  it("gives flex children minWidth 0 so they can shrink below their content", () => {
    expect(serializeFlexChild({ grow: 1, shrink: 1, basis: "auto", order: 0 }).minWidth).toBe(0);
  });

  it("serializes a pinned basis", () => {
    expect(serializeFlexChild({ grow: 0, shrink: 1, basis: { value: 33, unit: "%" }, order: 0 }).flexBasis).toBe("33%");
  });

  it("rejects an unknown direction or wrap", () => {
    expect(flexLayoutSchema.safeParse({ ...DEFAULT_FLEX_LAYOUT, direction: "diagonal" }).success).toBe(false);
    expect(flexLayoutSchema.safeParse({ ...DEFAULT_FLEX_LAYOUT, wrap: "sometimes" }).success).toBe(false);
  });

  it("falls back to defaults for untrusted stored data", () => {
    expect(readFlexLayout({ direction: "diagonal" })).toEqual(DEFAULT_FLEX_LAYOUT);
  });
});

describe("breakpoint resolution", () => {
  const breakpoints = [
    { id: "desktop", name: "Desktop", maxWidth: 4000, order: 0, preset: "desktop" as const },
    { id: "tablet", name: "Tablet", maxWidth: 1024, order: 1, preset: "tablet" as const },
    { id: "mobile", name: "Mobile", maxWidth: 640, order: 2, preset: "mobile" as const },
  ];

  const resolve = (width: number, layoutByBreakpoint: Record<string, Record<string, unknown>>) =>
    resolveSectionLayout({ layoutMode: "grid", layoutByBreakpoint, width, breakpoints });

  it("inherits a desktop value at every narrower width", () => {
    const stored = { desktop: { columns: 4, autoMode: "fixed" } };

    for (const width of [1920, 1440, 1280, 1024, 768, 390, 320]) {
      expect(resolve(width, stored).grid.columns).toBe(4);
    }
  });

  it("lets a narrower breakpoint override only what it sets", () => {
    const stored = {
      desktop: { columns: 4, autoMode: "fixed", rowGap: 40 },
      mobile: { columns: 1 },
    };

    // Above the mobile boundary the desktop value still applies.
    expect(resolve(768, stored).grid.columns).toBe(4);

    const mobile = resolve(390, stored).grid;
    expect(mobile.columns).toBe(1);
    // rowGap was never set on mobile, so it keeps the inherited value rather than the default.
    expect(mobile.rowGap).toBe(40);
  });

  it("applies a breakpoint exactly at its boundary width", () => {
    const stored = { desktop: { columns: 4, autoMode: "fixed" }, mobile: { columns: 1 } };

    expect(resolve(640, stored).grid.columns).toBe(1);
    expect(resolve(641, stored).grid.columns).toBe(4);
  });

  it("reports which breakpoints contributed, widest first", () => {
    const stored = { desktop: { columns: 4 }, tablet: { columns: 3 }, mobile: { columns: 1 } };
    expect(resolve(390, stored).appliedFrom).toEqual(["desktop", "tablet", "mobile"]);
  });

  it("falls back to the defaults when nothing is stored", () => {
    expect(resolve(1440, {}).grid).toEqual(DEFAULT_GRID_LAYOUT);
  });
});

describe("overflow safety", () => {
  it("clamps a span that claims more columns than the grid has", () => {
    const child = { columnSpan: 6, rowSpan: 1, order: 0 };
    expect(clampGridChild(child, 2).columnSpan).toBe(2);
    expect(clampGridChild(child, 12).columnSpan).toBe(6);
  });

  it("lets grid and flex children shrink below their content", () => {
    // Without this a long word inside a column forces the whole row wider than the viewport.
    expect(serializeGridChild({ columnSpan: 1, rowSpan: 1, order: 0 }).minWidth).toBe("0");
    expect(serializeFlexChild({ grow: 1, shrink: 1, basis: "auto", order: 0 }).minWidth).toBe(0);
  });
});
