import {
  breakpointInheritanceChain,
  DESIGN_WIDTH,
  serializeLength,
  type BreakpointDefinition,
  type Geometry,
  type ResponsiveElementLayout,
} from "./responsive";

/**
 * The one resolver shared by the editor, the preview and the public renderer.
 *
 * Everything about a responsive value at a given width is decided here. A second implementation is
 * exactly how an editor starts showing a layout that visitors never receive, so nothing else in the
 * product is allowed to interpret breakpoint overrides.
 */

/**
 * A breakpoint override carries layout and geometry separately.
 *
 * Section 5 of the plan writes this as `Partial<ResponsiveElementLayout & Geometry>`, which cannot
 * be satisfied: both sides declare `width` and `height`, so the intersection demands a value that
 * is simultaneously a structured length and a number. Naming the two parts keeps the same
 * expressive power with a type that can actually hold a value.
 */
export type BreakpointOverride = {
  layout?: Partial<ResponsiveElementLayout>;
  geometry?: Partial<Geometry>;
};

/**
 * Layout and geometry stay separate rather than being merged.
 *
 * Both carry `width` and `height`, but a layout width is a structured `ResponsiveLength` and a
 * geometry width is a number of logical pixels. Flattening them into one object silently lets the
 * number win and destroys the responsive value.
 */
export type ResolvedLayout = {
  layout: ResponsiveElementLayout;
  geometry: Geometry;
  /** Breakpoint IDs that contributed a value, widest first. Drives the inherited/overridden badges. */
  appliedFrom: string[];
};

/**
 * Merges the base layout with every override that applies at `width`, from the widest applicable
 * rule down to the narrowest. Later (narrower) rules win, so a mobile override beats a tablet one
 * and both beat the desktop base — deterministically, whatever order the array is stored in.
 */
export function resolveLayoutAt(input: {
  width: number;
  base: ResponsiveElementLayout;
  geometry: Geometry;
  breakpoints: readonly BreakpointDefinition[];
  overrides?: Record<string, BreakpointOverride> | undefined;
}): ResolvedLayout {
  const chain = breakpointInheritanceChain(input.width, input.breakpoints);
  const applied: string[] = [];

  let layout: ResponsiveElementLayout = { ...input.base };
  let geometry: Geometry = { ...input.geometry };

  for (const breakpoint of chain) {
    const override = input.overrides?.[breakpoint.id];
    if (override === undefined) continue;

    // Only keys the override actually set are applied; an absent key inherits rather than resetting.
    for (const [key, value] of Object.entries(override.layout ?? {})) {
      if (value !== undefined) (layout as Record<string, unknown>)[key] = value;
    }
    for (const [key, value] of Object.entries(override.geometry ?? {})) {
      if (value !== undefined) (geometry as unknown as Record<string, unknown>)[key] = value;
    }
    if (override.layout !== undefined || override.geometry !== undefined) applied.push(breakpoint.id);
  }

  return { layout, geometry, appliedFrom: applied };
}

/** Where a single property's value came from, so the inspector can label it honestly. */
export type ValueOrigin = "base" | "inherited" | "override";

export function originOf(input: {
  property: keyof ResponsiveElementLayout | keyof Geometry;
  width: number;
  breakpoints: readonly BreakpointDefinition[];
  overrides?: Record<string, BreakpointOverride> | undefined;
}): { origin: ValueOrigin; breakpointId: string | null } {
  const chain = breakpointInheritanceChain(input.width, input.breakpoints);
  const narrowest = chain[chain.length - 1];

  let source: string | null = null;
  for (const breakpoint of chain) {
    const override = input.overrides?.[breakpoint.id];
    if (override === undefined) continue;
    const inLayout = (override.layout as Record<string, unknown> | undefined)?.[input.property] !== undefined;
    const inGeometry = (override.geometry as Record<string, unknown> | undefined)?.[input.property] !== undefined;
    if (inLayout || inGeometry) source = breakpoint.id;
  }

  if (source === null) return { origin: "base", breakpointId: null };
  if (narrowest !== undefined && source === narrowest.id) return { origin: "override", breakpointId: source };
  return { origin: "inherited", breakpointId: source };
}

/**
 * Applies free-layout constraints to produce geometry at an arbitrary container width.
 *
 * The stored geometry is authored against the design width; this maps it to any other width without
 * mutating what is stored. That separation is what lets a user drag at 1440 and still get an
 * intentional result at 390 without the document changing underneath them.
 */
export function applyConstraints(input: {
  geometry: Geometry;
  layout: Pick<ResponsiveElementLayout, "horizontalConstraint" | "verticalConstraint" | "aspectRatio">;
  containerWidth: number;
  designWidth?: number;
}): Geometry {
  const designWidth = input.designWidth ?? DESIGN_WIDTH;
  const { geometry, layout, containerWidth } = input;
  const scale = containerWidth / designWidth;
  const rightGap = designWidth - (geometry.x + geometry.width);

  let x = geometry.x;
  let width = geometry.width;

  switch (layout.horizontalConstraint) {
    case "left":
      break;
    case "right":
      x = containerWidth - rightGap - width;
      break;
    case "center":
      x = (containerWidth - width) / 2;
      break;
    case "stretch":
      // Both gaps are held, so the element grows and shrinks with its container.
      width = Math.max(1, containerWidth - geometry.x - rightGap);
      break;
    case "scale":
      x = geometry.x * scale;
      width = geometry.width * scale;
      break;
  }

  let height = geometry.height;
  if (layout.verticalConstraint === "scale") height = geometry.height * scale;
  if (layout.aspectRatio !== undefined && layout.aspectRatio > 0) height = width / layout.aspectRatio;

  return {
    x: Math.round(x),
    y: Math.round(geometry.y),
    width: Math.round(Math.max(1, width)),
    height: Math.round(Math.max(1, height)),
    rotation: geometry.rotation,
  };
}

/** Serialises a resolved layout into the small set of CSS properties the renderer applies. */
export function serializeResolvedLayout(resolved: ResolvedLayout): Record<string, string> {
  const layout = resolved.layout;
  const css: Record<string, string> = {
    width: serializeLength(layout.width),
    height: serializeLength(layout.height),
  };
  if (layout.minWidth) css.minWidth = serializeLength(layout.minWidth);
  if (layout.maxWidth) css.maxWidth = serializeLength(layout.maxWidth);
  if (layout.minHeight) css.minHeight = serializeLength(layout.minHeight);
  if (layout.maxHeight) css.maxHeight = serializeLength(layout.maxHeight);
  if (layout.aspectRatio !== undefined) css.aspectRatio = String(layout.aspectRatio);
  if (!layout.visible) css.display = "none";
  return css;
}

export type ResponsiveDiagnostic = {
  code: "horizontal-overflow" | "off-canvas" | "impossible-constraint" | "tiny-text" | "small-tap-target";
  elementId: string;
  /** Width range where the problem occurs, so the report can point at it precisely. */
  fromWidth: number;
  toWidth: number;
};

/**
 * Detects layout problems across a width range instead of only at the preset breakpoints, because
 * a layout that is correct at 390 and 1440 can still break at 700.
 */
export function diagnoseWidths(input: {
  elementId: string;
  geometry: Geometry;
  layout: Pick<ResponsiveElementLayout, "horizontalConstraint" | "verticalConstraint" | "aspectRatio" | "minWidth" | "maxWidth">;
  widths: readonly number[];
}): ResponsiveDiagnostic[] {
  const findings: ResponsiveDiagnostic[] = [];

  const min = input.layout.minWidth;
  const max = input.layout.maxWidth;
  if (min && max && "value" in min && "value" in max && min.unit === max.unit && min.value > max.value) {
    findings.push({
      code: "impossible-constraint",
      elementId: input.elementId,
      fromWidth: Math.min(...input.widths),
      toWidth: Math.max(...input.widths),
    });
  }

  let overflowFrom: number | null = null;
  let offCanvasFrom: number | null = null;

  for (const width of [...input.widths].sort((a, b) => a - b)) {
    const resolved = applyConstraints({ geometry: input.geometry, layout: input.layout, containerWidth: width });
    const overflows = resolved.x + resolved.width > width;
    const offCanvas = resolved.x + resolved.width <= 0 || resolved.x >= width;

    if (overflows && overflowFrom === null) overflowFrom = width;
    if (!overflows && overflowFrom !== null) {
      findings.push({ code: "horizontal-overflow", elementId: input.elementId, fromWidth: overflowFrom, toWidth: width });
      overflowFrom = null;
    }
    if (offCanvas && offCanvasFrom === null) offCanvasFrom = width;
    if (!offCanvas && offCanvasFrom !== null) {
      findings.push({ code: "off-canvas", elementId: input.elementId, fromWidth: offCanvasFrom, toWidth: width });
      offCanvasFrom = null;
    }
  }

  const widest = Math.max(...input.widths);
  if (overflowFrom !== null) {
    findings.push({ code: "horizontal-overflow", elementId: input.elementId, fromWidth: overflowFrom, toWidth: widest });
  }
  if (offCanvasFrom !== null) {
    findings.push({ code: "off-canvas", elementId: input.elementId, fromWidth: offCanvasFrom, toWidth: widest });
  }

  return findings;
}

/**
 * Widths the audit sweeps: the presets, enough intermediates to catch between-breakpoint breaks,
 * and both sides of the default breakpoint boundaries — 640/641 and 1024/1025 — because a layout
 * that breaks one pixel past a boundary is exactly what a preset-only sweep misses.
 */
export const SWEEP_WIDTHS = [
  320, 375, 390, 480, 640, 641, 768, 834, 1024, 1025, 1180, 1280, 1440, 1600, 1920,
] as const;
