import { z } from "zod";

/**
 * Responsive image delivery.
 *
 * The browser picks the variant, not the server: given a `srcset` of real widths and a `sizes`
 * description of how much space the image occupies, it accounts for viewport, density and
 * connection in ways nothing here can. This module's job is to describe the options accurately.
 *
 * Explicit `width` and `height` are always emitted. Without them the browser cannot reserve space
 * before the bytes arrive, and every image on the page shifts the content below it as it loads.
 */
export type ImageVariant = { width: number; height: number };

export const focalPointSchema = z
  .object({
    /** Fractions of the image, 0–1. The point that must stay visible when a crop cuts the rest. */
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();

export type FocalPoint = z.infer<typeof focalPointSchema>;

export const DEFAULT_FOCAL_POINT: FocalPoint = { x: 0.5, y: 0.5 };

export const artDirectionSourceSchema = z
  .object({
    /** Applies at and below this width. */
    maxWidth: z.number().int().min(200).max(4000),
    mediaId: z.string().min(1),
  })
  .strict();

export type ArtDirectionSource = z.infer<typeof artDirectionSourceSchema>;

/**
 * A `srcset` from the variants that exist.
 *
 * Duplicated widths are collapsed and unresolvable variants dropped, because a `srcset` entry the
 * browser cannot fetch is worse than an absent one: it may choose it and render nothing.
 */
export function buildSrcSet(
  variants: readonly ImageVariant[],
  resolveUrl: (width: number) => string | null,
): string {
  const byWidth = new Map<number, string>();

  for (const variant of [...variants].sort((a, b) => a.width - b.width)) {
    const url = resolveUrl(variant.width);
    if (url === null || url === "") continue;
    byWidth.set(variant.width, url);
  }

  return [...byWidth.entries()].map(([width, url]) => `${url} ${width}w`).join(", ");
}

/**
 * A `sizes` value describing the space the image occupies at each width.
 *
 * Wrong here is expensive in both directions: too large and phones download desktop bytes, too
 * small and every screen renders a blurry image. Entries are emitted widest-first, which is the
 * order the browser evaluates them in.
 */
export function buildSizes(
  rules: readonly { maxWidth: number; value: string }[],
  fallback: string,
): string {
  const sorted = [...rules].sort((a, b) => a.maxWidth - b.maxWidth);
  return [...sorted.map((rule) => `(max-width: ${rule.maxWidth}px) ${rule.value}`), fallback].join(", ");
}

/**
 * Which media a width should use.
 *
 * Art direction is not the same as picking a smaller file: a phone may need a different crop, not
 * a scaled-down one. The narrowest matching rule wins, so a mobile override does not leak upward
 * into desktop.
 */
export function resolveArtDirectedMedia(
  defaultMediaId: string,
  sources: readonly ArtDirectionSource[],
  width: number,
): string {
  const match = [...sources]
    .sort((a, b) => a.maxWidth - b.maxWidth)
    .find((source) => width <= source.maxWidth);

  return match?.mediaId ?? defaultMediaId;
}

/** `object-position` from a focal point, so a crop keeps the subject rather than the centre. */
export function serializeFocalPoint(focal: FocalPoint | undefined): string {
  const point = focal ?? DEFAULT_FOCAL_POINT;
  return `${round(point.x * 100)}% ${round(point.y * 100)}%`;
}

/**
 * The intrinsic aspect ratio, used to reserve space before the image loads.
 *
 * Returns null for a degenerate size rather than emitting `x / 0`, which is invalid CSS and would
 * take the whole declaration block with it.
 */
export function aspectRatioOf(size: { width: number; height: number } | undefined): string | null {
  if (size === undefined || size.width <= 0 || size.height <= 0) return null;
  return `${round(size.width)} / ${round(size.height)}`;
}

function round(value: number): number {
  return Math.round(value * 1e2) / 1e2;
}
