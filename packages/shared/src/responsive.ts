import { z } from "zod";

import { DEVICE_MODES, DEVICE_ORDER } from "./devices";

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

/**
 * The style properties a device may override, per element type.
 *
 * A discriminated union rather than an open bag: the type says which element it belongs to, and a
 * text override cannot be written onto a button. That matters because these values reach a
 * stylesheet — an untyped `Record<string, string>` here would be a hole through which a persisted
 * document could put an arbitrary declaration into a published page, which is the one thing the
 * responsive model exists to make impossible.
 *
 * The set is deliberately small. It is the properties whose right value genuinely differs between a
 * phone and a desktop, not every property an element has.
 */
export const responsiveStyleOverrideSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      fontSize: responsiveLengthSchema.optional(),
      lineHeight: z.number().positive().finite().max(10).optional(),
      textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("button"),
      fontSize: responsiveLengthSchema.optional(),
      horizontalAlign: z.enum(["left", "center", "right"]).optional(),
      /** `fill` lets a button take the width it is given, which is usually right on a phone. */
      widthBehavior: z.enum(["auto", "fill"]).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("image"),
      objectFit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
      objectPosition: z.enum(["top", "center", "bottom", "left", "right"]).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("container"),
      direction: z.enum(["row", "column", "row-reverse", "column-reverse"]).optional(),
      wrap: z.enum(["nowrap", "wrap", "wrap-reverse"]).optional(),
      gap: responsiveLengthSchema.optional(),
      padding: responsiveLengthSchema.optional(),
      align: z.enum(["start", "center", "end", "stretch", "baseline"]).optional(),
      justify: z.enum(["start", "center", "end", "space-between", "space-around", "space-evenly"]).optional(),
    })
    .strict(),
]);

export type ResponsiveStyleOverride = z.infer<typeof responsiveStyleOverrideSchema>;

/**
 * True when a style override belongs to the element carrying it.
 *
 * The schema alone cannot check this: an element's overrides are validated by the shared base
 * shape, which does not know the element's own type. This is the check that closes the gap, and the
 * document validator runs it over every element.
 */
export function styleOverrideMatchesElement(elementType: string, override: ResponsiveStyleOverride): boolean {
  return override.type === elementType;
}

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

/**
 * Desktop is the base rule; narrower breakpoints only store explicit overrides.
 *
 * Derived from `DEVICE_MODES` rather than restated, so a device ceiling cannot mean one thing to
 * the breakpoint chain and another to the device switcher.
 */
export const DEFAULT_BREAKPOINTS: BreakpointDefinition[] = DEVICE_ORDER.map((device) => ({
  id: device,
  name: `${device[0]!.toUpperCase()}${device.slice(1)}`,
  maxWidth: DEVICE_MODES[device].maxWidth,
  preset: device,
  order: DEVICE_MODES[device].order,
}));

/** The canvas a document's geometry is authored against. */
export const DESIGN_WIDTH: number = DEVICE_MODES.desktop.referenceWidth;
export const MOBILE_PREVIEW_WIDTH = DEVICE_MODES.mobile.referenceWidth;
export const TABLET_PREVIEW_WIDTH = DEVICE_MODES.tablet.referenceWidth;

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

/**
 * The fields every element carries, wherever its type is declared.
 *
 * It lives here rather than beside the element union so a module that adds element types can use it
 * without importing the union it is about to be part of. Every element gets breakpoint overrides
 * for the same reason: responsiveness is not a property of some element types.
 */
/**
 * A colour a document may store.
 *
 * Hex or rgb/rgba only, never an arbitrary CSS string: a value that reaches a `style` attribute is
 * a value that must not be able to carry anything but a colour.
 */
export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$|^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/, {
    message: "must be a hex or rgb/rgba colour",
  });

/**
 * Text and background, for any block that does not already own its colours.
 *
 * Both optional, and the whole object optional: absent means the block draws exactly as it always
 * has. That is what lets this reach twenty-three block types without a migration and without
 * changing a single published page.
 *
 * Blocks that already carry their own colours — text, button, icon, divider, the announcement bar —
 * keep them and do not get this as well. Two controls for one colour is worse than one.
 */
export const appearanceSchema = z
  .object({ textColor: colorSchema.optional(), backgroundColor: colorSchema.optional() })
  .strict();

export type ElementAppearance = z.infer<typeof appearanceSchema>;

export const elementBaseShape = {
  id: z.string().min(1),
  name: z.string().max(120),
  appearance: appearanceSchema.optional(),
  /**
   * The payload version this element was written as. Absent means 1, which is what every document
   * written before element versioning existed means. Migration is a pure function on read; nothing
   * rewrites a stored document until its owner saves.
   */
  version: z.number().int().min(1).max(1000).optional(),
  geometry: geometrySchema,
  responsiveLayout: responsiveElementLayoutSchema,
  breakpointOverrides: z
    .record(
      z.string(),
      z
        .object({
          layout: responsiveElementLayoutSchema.partial().optional(),
          geometry: geometrySchema.partial().optional(),
          style: responsiveStyleOverrideSchema.optional(),
          /**
           * The canvas width this device's geometry was authored against.
           *
           * Only meaningful where a person dragged an element while that device was selected: the
           * numbers are pixels on *that* canvas, and interpreting them against the desktop design
           * width would move the element. Absent means the desktop design width, which is what
           * every document written before device-aware editing existed means.
           */
          referenceWidth: z.number().int().positive().max(10_000).optional(),
        })
        .strict(),
    )
    .optional(),
  zIndex: z.number().int(),
  locked: z.boolean(),
  hidden: z.boolean(),
};
