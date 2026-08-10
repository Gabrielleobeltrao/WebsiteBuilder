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
} from "./layout";

describe("grid layout", () => {
  it("uses auto-fit with minmax so columns adapt without a per-width override", () => {
    const css = serializeGridLayout({ ...DEFAULT_GRID_LAYOUT, autoFit: true, minColumnWidth: 240 });
    expect(css.gridTemplateColumns).toBe("repeat(auto-fit, minmax(min(240px, 100%), 1fr))");
  });

  it("guards against horizontal overflow in a narrow container", () => {
    const css = serializeGridLayout({ ...DEFAULT_GRID_LAYOUT, autoFit: true, minColumnWidth: 900 });
    expect(css.gridTemplateColumns).toContain("min(900px, 100%)");
  });

  it("uses a fixed column count when auto-fit is off", () => {
    const css = serializeGridLayout({ ...DEFAULT_GRID_LAYOUT, autoFit: false, columns: 4 });
    expect(css.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
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
