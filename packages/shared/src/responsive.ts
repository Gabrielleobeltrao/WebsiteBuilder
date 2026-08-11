import { z } from "zod";

/**
 * Responsive values are structured data, never CSS strings. `serializeLength` is the only place a
 * length becomes CSS, and it can only emit a finite number joined to an allowlisted unit — so a
 * persisted document has no way to inject an arbitrary declaration into rendered output.
 */

export const LENGTH_UNITS = ["px", "%", "vw", "vh", "rem", "em", "fr"] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

export const LENGTH_KEYWORDS = ["auto", "min-content", "max-content", "fit-content"] as const;
export type LengthKeyword = (typeof LENGTH_KEYWORDS)[number];

export type NumericLength = { value: number; unit: LengthUnit };

export type FluidLength = {
  /** Grows linearly from `minPx` at `minViewportPx` to `maxPx` at `maxViewportPx`, clamped at both ends. */
  fluid: { minPx: number; maxPx: number; minViewportPx: number; maxViewportPx: number };
};

export type ResponsiveLength =
  | NumericLength
  | { keyword: LengthKeyword }
  | { clamp: { min: NumericLength; preferred: NumericLength; max: NumericLength } }
  | FluidLength;

export const numericLengthSchema = z
  .object({ value: z.number().finite(), unit: z.enum(LENGTH_UNITS) })
  .strict();

export const responsiveLengthSchema: z.ZodType<ResponsiveLength> = z.union([
  numericLengthSchema,
  z.object({ keyword: z.enum(LENGTH_KEYWORDS) }).strict(),
  z
    .object({
      clamp: z
        .object({ min: numericLengthSchema, preferred: numericLengthSchema, max: numericLengthSchema })
        .strict(),
    })
    .strict(),
  z
    .object({
      fluid: z
        .object({
          minPx: z.number().positive().finite().max(400),
          maxPx: z.number().positive().finite().max(400),
          minViewportPx: z.number().int().min(200).max(4000),
          maxViewportPx: z.number().int().min(200).max(4000),
        })
        .strict(),
    })
    .strict(),
]);

export function isNumericLength(length: ResponsiveLength): length is NumericLength {
  return "value" in length;
}

/** Rounds to 4 decimals so serialisation is stable and content hashes stay deterministic. */
function serializeNumeric(length: NumericLength): string {
  const rounded = Math.round(length.value * 1e4) / 1e4;
  return `${rounded}${length.unit}`;
}

export function serializeLength(length: ResponsiveLength): string {
  if ("keyword" in length) return length.keyword;
  if ("fluid" in length) return serializeFluid(length);
  if ("clamp" in length) {
    const { min, preferred, max } = length.clamp;
    return `clamp(${serializeNumeric(min)}, ${serializeNumeric(preferred)}, ${serializeNumeric(max)})`;
  }
  return serializeNumeric(length);
}

export const px = (value: number): NumericLength => ({ value, unit: "px" });

/**
 * `clamp(min, calc(intercept + slope * 1vw), max)`.
 *
 * The intercept matters: a bare `vw` term equals the minimum only by coincidence, so a curve
 * without it sits pinned at the floor and then jumps. With it, the value passes through both
 * endpoints exactly and moves smoothly between them.
 */
function serializeFluid({ fluid }: FluidLength): string {
  const { minPx, maxPx, minViewportPx, maxViewportPx } = fluid;
  const slope = (maxPx - minPx) / (maxViewportPx - minViewportPx);
  const intercept = minPx - slope * minViewportPx;

  const vw = round(slope * 100);
  const base = round(intercept);
  const preferred = base === 0 ? `${vw}vw` : `calc(${base}px + ${vw}vw)`;

  return `clamp(${round(minPx)}px, ${preferred}, ${round(maxPx)}px)`;
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/** Below this, body text stops being comfortably readable on a phone. */
export const MIN_READABLE_FONT_PX = 12;

/**
 * Builds a fluid length from the two endpoints a designer actually cares about.
 *
 * Endpoints are ordered and the viewport range is normalised here, so a reversed pair describes the
 * same curve instead of one where text shrinks as the screen grows.
 */
export function fluidLength(input: {
  minPx: number;
  maxPx: number;
  minViewportPx: number;
  maxViewportPx: number;
}): ResponsiveLength {
  const minPx = Math.min(input.minPx, input.maxPx);
  const maxPx = Math.max(input.minPx, input.maxPx);
  const minViewportPx = Math.min(input.minViewportPx, input.maxViewportPx);
  const maxViewportPx = Math.max(input.minViewportPx, input.maxViewportPx);

  // Equal endpoints, or a viewport range of zero, describe no curve. A fixed length is the honest
  // answer rather than a division by zero.
  if (minPx === maxPx || minViewportPx === maxViewportPx) return px(minPx);

  return { fluid: { minPx, maxPx, minViewportPx, maxViewportPx } };
}

/**
 * True when a length can render text below the readable floor at any width.
 *
 * A fluid or clamped length is safe when its minimum is legible. Relative units depend on context
 * this function does not have, so they are reported for review rather than passed.
 */
export function isReadableFontSize(length: ResponsiveLength): boolean | "unknown" {
  if ("keyword" in length) return "unknown";
  if ("fluid" in length) return length.fluid.minPx >= MIN_READABLE_FONT_PX;
  if ("clamp" in length) {
    const { min } = length.clamp;
    return min.unit === "px" ? min.value >= MIN_READABLE_FONT_PX : "unknown";
  }
  return length.unit === "px" ? length.value >= MIN_READABLE_FONT_PX : "unknown";
}

export const HORIZONTAL_CONSTRAINTS = ["left", "right", "center", "stretch", "scale"] as const;
export const VERTICAL_CONSTRAINTS = ["top", "bottom", "center", "stretch", "scale"] as const;
export type HorizontalConstraint = (typeof HORIZONTAL_CONSTRAINTS)[number];
export type VerticalConstraint = (typeof VERTICAL_CONSTRAINTS)[number];

export const responsiveElementLayoutSchema = z
  .object({
    width: responsiveLengthSchema,
    height: responsiveLengthSchema,
    minWidth: responsiveLengthSchema.optional(),
    maxWidth: responsiveLengthSchema.optional(),
    minHeight: responsiveLengthSchema.optional(),
    maxHeight: responsiveLengthSchema.optional(),
    aspectRatio: z.number().positive().finite().optional(),
    horizontalConstraint: z.enum(HORIZONTAL_CONSTRAINTS),
    verticalConstraint: z.enum(VERTICAL_CONSTRAINTS),
    visible: z.boolean(),
  })
  .strict();

export type ResponsiveElementLayout = z.infer<typeof responsiveElementLayoutSchema>;

export const geometrySchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
    /** Persisted from the start so a future rotation UI needs no migration. The MVP keeps it at 0. */
    rotation: z.number().finite(),
  })
  .strict();

export type Geometry = z.infer<typeof geometrySchema>;

export const BREAKPOINT_PRESETS = ["desktop", "tablet", "mobile"] as const;
export type BreakpointPreset = (typeof BREAKPOINT_PRESETS)[number];

export const breakpointDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(60),
    maxWidth: z.number().int().positive().max(10_000),
    preset: z.enum(BREAKPOINT_PRESETS).optional(),
    order: z.number().int().nonnegative(),
  })
  .strict();

export type BreakpointDefinition = z.infer<typeof breakpointDefinitionSchema>;

/** Desktop is the base rule; narrower breakpoints only store explicit overrides. */
export const DEFAULT_BREAKPOINTS: BreakpointDefinition[] = [
  { id: "desktop", name: "Desktop", maxWidth: 10_000, preset: "desktop", order: 0 },
  { id: "tablet", name: "Tablet", maxWidth: 1024, preset: "tablet", order: 1 },
  { id: "mobile", name: "Mobile", maxWidth: 640, preset: "mobile", order: 2 },
];

export const DESIGN_WIDTH = 1440;
export const MOBILE_PREVIEW_WIDTH = 390;

/**
 * Resolves which breakpoint applies at a given viewport width: the narrowest definition whose
 * `maxWidth` still contains the width. Definitions are sorted here rather than trusted, so a
 * document with an out-of-order array cannot produce a different result than the editor showed.
 */
export function resolveBreakpointAt(
  width: number,
  breakpoints: readonly BreakpointDefinition[],
): BreakpointDefinition | null {
  const applicable = breakpoints
    .filter((breakpoint) => width <= breakpoint.maxWidth)
    .sort((a, b) => a.maxWidth - b.maxWidth);
  return applicable[0] ?? null;
}

/**
 * Orders breakpoints from the widest rule to the one applying at `width`. Callers merge overrides
 * in this order, which is what makes inheritance from the nearest larger rule deterministic.
 */
export function breakpointInheritanceChain(
  width: number,
  breakpoints: readonly BreakpointDefinition[],
): BreakpointDefinition[] {
  return breakpoints
    .filter((breakpoint) => width <= breakpoint.maxWidth)
    .sort((a, b) => b.maxWidth - a.maxWidth);
}
