import { z } from "zod";

import {
  breakpointInheritanceChain,
  serializeLength,
  type BreakpointDefinition,
  type ResponsiveLength,
} from "./responsive";

/**
 * Structured grid and flex configuration.
 *
 * Like every other visual value in this product, these are typed fields rather than CSS strings.
 * `serializeGridLayout` and `serializeFlexLayout` are the only places they become CSS, and they can
 * only emit values built from validated numbers and enums — there is no path from a stored document
 * to an arbitrary declaration.
 */

const spacing = z.number().finite().nonnegative().max(400);

export const JUSTIFY_VALUES = ["start", "center", "end", "space-between", "space-around", "space-evenly"] as const;
export const ALIGN_VALUES = ["start", "center", "end", "stretch"] as const;
export const FLEX_DIRECTIONS = ["row", "row-reverse", "column", "column-reverse"] as const;
export const FLEX_WRAPS = ["nowrap", "wrap", "wrap-reverse"] as const;

export const gridLayoutSchema = z
  .object({
    columns: z.number().int().min(1).max(12),
    /**
     * `fixed` keeps the declared column count at every width. `auto-fit` collapses empty tracks so
     * the remaining items stretch; `auto-fill` keeps the empty tracks, which holds alignment across
     * rows with differing item counts. Both adapt without an override at every width.
     */
    autoMode: z.enum(["fixed", "auto-fit", "auto-fill"]),
    minColumnWidth: z.number().int().min(40).max(2000),
    rowGap: spacing,
    columnGap: spacing,
    paddingX: spacing,
    paddingY: spacing,
    justifyItems: z.enum(ALIGN_VALUES),
    alignItems: z.enum(ALIGN_VALUES),
  })
  .strict();

export type GridLayout = z.infer<typeof gridLayoutSchema>;

export const flexLayoutSchema = z
  .object({
    direction: z.enum(FLEX_DIRECTIONS),
    wrap: z.enum(FLEX_WRAPS),
    gap: spacing,
    paddingX: spacing,
    paddingY: spacing,
    justifyContent: z.enum(JUSTIFY_VALUES),
    alignItems: z.enum(ALIGN_VALUES),
  })
  .strict();

export type FlexLayout = z.infer<typeof flexLayoutSchema>;

export const DEFAULT_GRID_LAYOUT: GridLayout = {
  columns: 3,
  autoMode: "auto-fit",
  minColumnWidth: 240,
  rowGap: 24,
  columnGap: 24,
  paddingX: 24,
  paddingY: 48,
  justifyItems: "stretch",
  alignItems: "start",
};

export const DEFAULT_FLEX_LAYOUT: FlexLayout = {
  direction: "row",
  wrap: "wrap",
  gap: 24,
  paddingX: 24,
  paddingY: 48,
  justifyContent: "start",
  alignItems: "start",
};

/**
 * `auto-fit` with `minmax` is what keeps a grid usable between breakpoints: columns collapse as the
 * container narrows without needing an override at every width. The `min()` guard stops a wide
 * minimum from forcing horizontal overflow in a narrow container.
 */
export function serializeGridLayout(layout: GridLayout): Record<string, string> {
  return {
    display: "grid",
    gridTemplateColumns:
      layout.autoMode === "fixed"
        ? `repeat(${layout.columns}, minmax(0, 1fr))`
        : `repeat(${layout.autoMode}, minmax(min(${layout.minColumnWidth}px, 100%), 1fr))`,
    rowGap: `${layout.rowGap}px`,
    columnGap: `${layout.columnGap}px`,
    padding: `${layout.paddingY}px ${layout.paddingX}px`,
    justifyItems: layout.justifyItems,
    alignItems: layout.alignItems,
  };
}

export function serializeFlexLayout(layout: FlexLayout): Record<string, string> {
  return {
    display: "flex",
    flexDirection: layout.direction,
    flexWrap: layout.wrap,
    gap: `${layout.gap}px`,
    padding: `${layout.paddingY}px ${layout.paddingX}px`,
    justifyContent: layout.justifyContent === "start" || layout.justifyContent === "end"
      ? `flex-${layout.justifyContent}`
      : layout.justifyContent,
    alignItems: layout.alignItems,
  };
}

export const gridChildSchema = z
  .object({
    columnSpan: z.number().int().min(1).max(12),
    rowSpan: z.number().int().min(1).max(12),
    order: z.number().int().min(-100).max(100),
  })
  .strict();

export type GridChild = z.infer<typeof gridChildSchema>;

export const flexChildSchema = z
  .object({
    grow: z.number().min(0).max(100),
    shrink: z.number().min(0).max(100),
    /** `auto` keeps intrinsic sizing; a length pins the basis. */
    basis: z.union([z.literal("auto"), z.object({ value: z.number().finite(), unit: z.enum(["px", "%"]) }).strict()]),
    order: z.number().int().min(-100).max(100),
  })
  .strict();

export type FlexChild = z.infer<typeof flexChildSchema>;

export function serializeFlexChild(child: FlexChild): Record<string, string | number> {
  return {
    flexGrow: child.grow,
    flexShrink: child.shrink,
    flexBasis: child.basis === "auto" ? "auto" : `${child.basis.value}${child.basis.unit}`,
    order: child.order,
    // Without this a flex child refuses to shrink below its content and forces overflow.
    minWidth: 0,
  };
}

export function serializeGridChild(child: GridChild): Record<string, string> {
  return {
    // `min(span, 100%)` is not valid for grid-column, so the span is clamped where it is read.
    // Without `minWidth: 0` a grid item refuses to shrink below its content and forces the whole
    // row to overflow horizontally.
    gridColumn: `span ${child.columnSpan}`,
    gridRow: `span ${child.rowSpan}`,
    order: String(child.order),
    minWidth: "0",
  };
}

/**
 * Resolves a section's layout for a width by walking the breakpoint chain.
 *
 * A value set on desktop applies to tablet and mobile unless one of them overrides it, which is
 * what stops a design from needing an entry at every breakpoint for every property.
 */
export function resolveSectionLayout(input: {
  layoutMode: "free" | "grid" | "flex";
  layoutByBreakpoint: Record<string, Record<string, unknown>>;
  width: number;
  breakpoints: readonly BreakpointDefinition[];
}): { grid: GridLayout; flex: FlexLayout; appliedFrom: string[] } {
  // Already widest first, which is the order values must be applied in: the narrowest matching
  // breakpoint is applied last and therefore wins.
  const chain = breakpointInheritanceChain(input.width, input.breakpoints);

  const merged: Record<string, unknown> = {};
  const appliedFrom: string[] = [];

  for (const breakpoint of chain) {
    const values = input.layoutByBreakpoint[breakpoint.id];
    if (values === undefined) continue;
    Object.assign(merged, values);
    appliedFrom.push(breakpoint.id);
  }

  return { grid: readGridLayout(merged), flex: readFlexLayout(merged), appliedFrom };
}

/**
 * A grid item may never claim more columns than the grid has, whatever the document says.
 *
 * A stored span of 6 in a 2-column grid pushes the item onto its own implicit row and breaks the
 * layout; clamping keeps a stale value harmless rather than visibly broken.
 */
export function clampGridChild(child: GridChild, columns: number): GridChild {
  return { ...child, columnSpan: Math.min(child.columnSpan, Math.max(1, columns)) };
}

/** Reads a section's stored layout for a breakpoint, falling back to the defaults. */
export function readGridLayout(stored: Record<string, unknown> | undefined): GridLayout {
  // Merged with the defaults first: a partial override for one breakpoint is the normal case, and
  // it must not fall all the way back to the defaults for the properties it did set.
  const parsed = gridLayoutSchema.safeParse({ ...DEFAULT_GRID_LAYOUT, ...(stored ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_GRID_LAYOUT;
}

export function readFlexLayout(stored: Record<string, unknown> | undefined): FlexLayout {
  const parsed = flexLayoutSchema.safeParse({ ...DEFAULT_FLEX_LAYOUT, ...(stored ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_FLEX_LAYOUT;
}

/** Convenience for section height, which is a responsive length rather than a plain number. */
export function serializeSectionHeight(height: ResponsiveLength | undefined): string | undefined {
  return height === undefined ? undefined : serializeLength(height);
}
