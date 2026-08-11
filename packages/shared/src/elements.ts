import { z } from "zod";

import { VISUAL_ELEMENT_SCHEMAS, type VisualElement } from "./visual-elements";

import {
  artDirectionSourceSchema,
  focalPointSchema,
  type ArtDirectionSource,
  type FocalPoint,
} from "./images";

import { safeLinkSchema, type SafeLink } from "./links";
import {
  geometrySchema,
  responsiveElementLayoutSchema,
  responsiveLengthSchema,
  type Geometry,
  type ResponsiveElementLayout,
  type ResponsiveLength,
} from "./responsive";

export const ELEMENT_TYPES = ["text", "image", "button", "container"] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const SECTION_LAYOUT_MODES = ["free", "grid", "flex"] as const;
export type SectionLayoutMode = (typeof SECTION_LAYOUT_MODES)[number];

/** Deep nesting produces documents that are slow to render and impossible to reason about. */
export const MAX_CONTAINER_DEPTH = 5;

const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$|^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/, {
    message: "must be a hex or rgb/rgba colour",
  });

const baseElementShape = {
  id: z.string().min(1),
  name: z.string().max(120),
  geometry: geometrySchema,
  responsiveLayout: responsiveElementLayoutSchema,
  breakpointOverrides: z
    .record(
      z.string(),
      z
        .object({
          layout: responsiveElementLayoutSchema.partial().optional(),
          geometry: geometrySchema.partial().optional(),
        })
        .strict(),
    )
    .optional(),
  zIndex: z.number().int(),
  locked: z.boolean(),
  hidden: z.boolean(),
};

export type BaseElement = {
  id: string;
  name: string;
  geometry: Geometry;
  responsiveLayout: ResponsiveElementLayout;
  breakpointOverrides?: Record<string, { layout?: Partial<ResponsiveElementLayout>; geometry?: Partial<Geometry> }>;
  zIndex: number;
  locked: boolean;
  hidden: boolean;
};

export const TEXT_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p"] as const;
export type TextTag = (typeof TEXT_TAGS)[number];

export type TextElement = BaseElement & {
  type: "text";
  /** Plain text. It is rendered as a text node — never as HTML. */
  content: string;
  tag: TextTag;
  style: {
    fontFamily: string;
    fontSize: ResponsiveLength;
    fontWeight: number;
    fontStyle: "normal" | "italic";
    textAlign: "left" | "center" | "right";
    color: string;
    lineHeight: number;
  };
};

export type ImageElement = BaseElement & {
  type: "image";
  source: { kind: "url"; url: string } | { kind: "media"; mediaId: string } | { kind: "empty" };
  alt: string;
  /** Decorative images render with an empty alt and are hidden from assistive technology. */
  decorative: boolean;
  focalPoint?: FocalPoint;
  artDirection?: ArtDirectionSource[];
  style: { objectFit: "cover" | "contain" | "fill"; borderRadius: number };
};

export type ButtonElement = BaseElement & {
  type: "button";
  text: string;
  link: SafeLink;
  icon?: { name: string; position: "before" | "after" };
  style: {
    fontSize: ResponsiveLength;
    fontWeight: number;
    textColor: string;
    backgroundColor: string;
    borderRadius: number;
    horizontalAlign: "left" | "center" | "right";
  };
};

export type ContainerElement = BaseElement & {
  type: "container";
  layout: SectionLayoutMode;
  children: BuilderElement[];
  layoutByBreakpoint: Record<string, Record<string, unknown>>;
};

export type BuilderElement =
  | TextElement
  | ImageElement
  | ButtonElement
  | ContainerElement
  | VisualElement;

export const textElementSchema = z
  .object({
    ...baseElementShape,
    type: z.literal("text"),
    content: z.string().max(10_000),
    tag: z.enum(TEXT_TAGS),
    style: z
      .object({
        fontFamily: z.string().min(1).max(80),
        fontSize: responsiveLengthSchema,
        fontWeight: z.number().int().min(100).max(900),
        fontStyle: z.enum(["normal", "italic"]),
        textAlign: z.enum(["left", "center", "right"]),
        color: colorSchema,
        lineHeight: z.number().positive().finite(),
      })
      .strict(),
  })
  .strict();

export const imageElementSchema = z
  .object({
    ...baseElementShape,
    type: z.literal("image"),
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("empty") }).strict(),
      z.object({ kind: z.literal("url"), url: z.string().url() }).strict(),
      z.object({ kind: z.literal("media"), mediaId: z.string().min(1) }).strict(),
    ]),
    alt: z.string().max(500),
    decorative: z.boolean(),
    /** Kept visible when a crop cuts the rest of the image. */
    focalPoint: focalPointSchema.optional(),
    /** Per-width source overrides, for a different crop on a phone rather than a smaller file. */
    artDirection: z.array(artDirectionSourceSchema).max(4).optional(),
    style: z
      .object({
        objectFit: z.enum(["cover", "contain", "fill"]),
        borderRadius: z.number().nonnegative().finite(),
      })
      .strict(),
  })
  .strict();

export const buttonElementSchema = z
  .object({
    ...baseElementShape,
    type: z.literal("button"),
    text: z.string().max(200),
    link: safeLinkSchema,
    icon: z
      .object({ name: z.string().min(1).max(60), position: z.enum(["before", "after"]) })
      .strict()
      .optional(),
    style: z
      .object({
        fontSize: responsiveLengthSchema,
        fontWeight: z.number().int().min(100).max(900),
        textColor: colorSchema,
        backgroundColor: colorSchema,
        borderRadius: z.number().nonnegative().finite(),
        horizontalAlign: z.enum(["left", "center", "right"]),
      })
      .strict(),
  })
  .strict();

/**
 * The recursion lives in `children` only. Keeping the container a real object schema is what lets
 * the union stay discriminated, so an unknown `type` fails fast instead of falling through every
 * branch and reporting a confusing error.
 */
export const containerElementSchema = z
  .object({
    ...baseElementShape,
    type: z.literal("container"),
    layout: z.enum(SECTION_LAYOUT_MODES),
    children: z.array(z.lazy((): z.ZodType<BuilderElement> => builderElementSchema)),
    layoutByBreakpoint: z.record(z.string(), z.record(z.string(), z.unknown())),
  })
  .strict();

export const builderElementSchema: z.ZodType<BuilderElement> = z.discriminatedUnion("type", [
  textElementSchema,
  imageElementSchema,
  buttonElementSchema,
  containerElementSchema,
  // The visual elements are part of the document, not a separate catalogue: they are saved,
  // reloaded, validated and rendered through exactly the same path as a text box.
  ...VISUAL_ELEMENT_SCHEMAS,
]) as unknown as z.ZodType<BuilderElement>;

/** Returns the nesting depth of an element tree, where a leaf element is depth 1. */
export function elementDepth(element: BuilderElement): number {
  if (element.type !== "container" || element.children.length === 0) return 1;
  return 1 + Math.max(...element.children.map(elementDepth));
}

/** Depth-first walk over an element and its descendants, parents before children. */
export function* walkElements(elements: readonly BuilderElement[]): Generator<BuilderElement> {
  for (const element of elements) {
    yield element;
    if (element.type === "container") yield* walkElements(element.children);
  }
}
