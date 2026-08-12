import { DESIGN_WIDTH, type Geometry } from "@websitebuilder/shared";

/**
 * Screen and logical coordinates are converted in exactly one place.
 *
 * The document stores logical pixels on a fixed 1440px design width. Zoom and fit are display
 * concerns only — a drag at 50% zoom must persist the same geometry as the identical drag at 200%.
 * Every drag, resize and hit test routes through here, which is what keeps that true.
 */

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const MIN_ELEMENT_SIZE = 8;

/**
 * A number, or a stated fallback.
 *
 * Pointer coordinates arrive from the DOM, and a synthetic or malformed event carries `undefined`
 * where a number belongs. Arithmetic on it produces `NaN`, which reaches the document as a geometry
 * the schema then refuses to save — the failure surfaces far from its cause, as a rejected save or
 * a React warning about `left="NaN"`. Every conversion in this file funnels through here instead.
 */
function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Zoom that fits the design width into the available workspace, never enlarging beyond 1:1. */
export function fitZoom(availableWidth: number, padding = 64): number {
  const usable = availableWidth - padding;
  if (usable <= 0) return MIN_ZOOM;
  return clampZoom(Math.min(1, usable / DESIGN_WIDTH));
}

export function screenToLogical(value: number, zoom: number): number {
  return value / clampZoom(zoom);
}

export function logicalToScreen(value: number, zoom: number): number {
  return value * clampZoom(zoom);
}

export type Point = { x: number; y: number };

/** Converts a viewport point into logical canvas coordinates, given the canvas origin on screen. */
export function pointToLogical(point: Point, canvasOrigin: Point, zoom: number): Point {
  const scale = clampZoom(zoom);
  return {
    x: (finite(point.x, 0) - finite(canvasOrigin.x, 0)) / scale,
    y: (finite(point.y, 0) - finite(canvasOrigin.y, 0)) / scale,
  };
}

/** Rounds to whole logical pixels so repeated drags cannot accumulate sub-pixel drift. */
export function roundGeometry(geometry: Geometry): Geometry {
  return {
    x: Math.round(geometry.x),
    y: Math.round(geometry.y),
    width: Math.round(geometry.width),
    height: Math.round(geometry.height),
    rotation: geometry.rotation,
  };
}

/**
 * Keeps an element inside sensible canvas bounds and above a usable minimum size. Elements may
 * overlap and may sit anywhere horizontally within the design width, but they cannot be dragged
 * fully off-canvas or resized into something unclickable.
 */
export function constrainGeometry(
  geometry: Geometry,
  bounds: { width: number; height: number } = { width: DESIGN_WIDTH, height: Number.POSITIVE_INFINITY },
): Geometry {
  const width = Math.max(MIN_ELEMENT_SIZE, finite(geometry.width, MIN_ELEMENT_SIZE));
  const height = Math.max(MIN_ELEMENT_SIZE, finite(geometry.height, MIN_ELEMENT_SIZE));

  // At least a sliver must remain reachable, otherwise an element becomes unrecoverable on canvas.
  const maxX = bounds.width - MIN_ELEMENT_SIZE;
  const maxY = Number.isFinite(bounds.height) ? bounds.height - MIN_ELEMENT_SIZE : Number.POSITIVE_INFINITY;

  return roundGeometry({
    x: Math.min(Math.max(finite(geometry.x, 0), MIN_ELEMENT_SIZE - width), maxX),
    y: Math.min(Math.max(finite(geometry.y, 0), 0), maxY),
    width,
    height,
    rotation: finite(geometry.rotation, 0),
  });
}

/** The eight resize handles: four corners resize both axes, four sides resize one. */
export const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

export function handleAxes(handle: ResizeHandle): { horizontal: boolean; vertical: boolean } {
  return {
    horizontal: handle !== "n" && handle !== "s",
    vertical: handle !== "e" && handle !== "w",
  };
}
