import {
  DEFAULT_BREAKPOINTS,
  DESIGN_WIDTH,
  serializeFocalPoint,
  resolveSectionLayout,
  serializeFlexLayout,
  serializeGridLayout,
  serializeLength,
  type BuilderElement,
  type BreakpointDefinition,
  type BuilderSection,
  type ButtonElement,
  type Geometry,
  type ImageElement,
  type TextElement,
} from "@websitebuilder/shared";
import type { CSSProperties } from "react";

/**
 * The one place a document value becomes CSS.
 *
 * Every property here comes from a validated enum, a finite number, or `serializeLength`, which can
 * only emit an allowlisted unit. Nothing accepts a raw string, so a persisted document has no path
 * to inject a declaration into rendered output. A second conversion elsewhere is how the editor and
 * the published site start disagreeing, so there is deliberately only this one.
 */

/** Absolute placement inside a free section. */
export function freeGeometryStyle(geometry: Geometry): CSSProperties {
  return {
    position: "absolute",
    left: geometry.x,
    top: geometry.y,
    width: geometry.width,
    height: geometry.height,
    ...(geometry.rotation === 0 ? {} : { transform: `rotate(${geometry.rotation}deg)` }),
  };
}

/** How a container lays its children out. Shared so the editor's copy cannot drift from output. */
export function containerStyle(element: { layout: "free" | "flex" | "grid" }): CSSProperties {
  if (element.layout === "grid") return { display: "grid" };
  if (element.layout === "flex") return { display: "flex" };
  return { position: "relative" };
}

export function textStyle(element: TextElement): CSSProperties {
  return {
    fontFamily: element.style.fontFamily,
    fontSize: serializeLength(element.style.fontSize),
    fontWeight: element.style.fontWeight,
    fontStyle: element.style.fontStyle,
    textAlign: element.style.textAlign,
    color: element.style.color,
    lineHeight: element.style.lineHeight,
    margin: 0,
  };
}

export function imageStyle(element: ImageElement): CSSProperties {
  return {
    objectFit: element.style.objectFit,
    // Keeps the subject of a cropped image in frame instead of whatever happens to be centred.
    objectPosition: serializeFocalPoint(element.focalPoint),
    borderRadius: element.style.borderRadius,
    width: "100%",
    height: "100%",
    display: "block",
  };
}

export function buttonStyle(element: ButtonElement): CSSProperties {
  return {
    fontSize: serializeLength(element.style.fontSize),
    fontWeight: element.style.fontWeight,
    color: element.style.textColor,
    backgroundColor: element.style.backgroundColor,
    borderRadius: element.style.borderRadius,
    display: "inline-flex",
    alignItems: "center",
    justifyContent:
      element.style.horizontalAlign === "left"
        ? "flex-start"
        : element.style.horizontalAlign === "right"
          ? "flex-end"
          : "center",
    gap: 8,
    width: "100%",
    height: "100%",
    border: "none",
    cursor: "pointer",
    textDecoration: "none",
    padding: "0 16px",
  };
}

export function sectionStyle(
  section: BuilderSection,
  breakpointId = "desktop",
  options: { width?: number; breakpoints?: readonly BreakpointDefinition[] } = {},
): CSSProperties {
  const height = section.heightByBreakpoint[breakpointId];
  const base: CSSProperties = {
    backgroundColor: section.backgroundColor,
    position: section.layoutMode === "free" ? "relative" : undefined,
    ...(height ? { minHeight: serializeLength(height) } : {}),
  };

  // Always resolved through the breakpoint chain, so a desktop value applies at every narrower
  // width unless something overrides it. With no explicit width the named breakpoint's own maximum
  // is used, which keeps the editor canvas showing exactly what a visitor at that width receives —
  // reading a single breakpoint's stored values here is how a canvas starts disagreeing with the
  // published site. Stored values are untrusted document input: they are parsed, and anything that
  // fails validation falls back to the defaults rather than reaching the style object.
  const breakpoints = options.breakpoints ?? DEFAULT_BREAKPOINTS;
  const width =
    options.width ?? breakpoints.find((breakpoint) => breakpoint.id === breakpointId)?.maxWidth ?? DESIGN_WIDTH;

  const resolved = resolveSectionLayout({
    layoutMode: section.layoutMode,
    layoutByBreakpoint: section.layoutByBreakpoint,
    width,
    breakpoints,
  });

  if (section.layoutMode === "grid") {
    return { ...base, ...(serializeGridLayout(resolved.grid) as CSSProperties) };
  }
  if (section.layoutMode === "flex") {
    return { ...base, ...(serializeFlexLayout(resolved.flex) as CSSProperties) };
  }
  return base;
}

/** Elements hidden in the document never reach preview or published output. */
export function isRenderable(element: BuilderElement): boolean {
  return !element.hidden;
}

/**
 * The colours a block was given, as a style object.
 *
 * Applied by each renderer to the box it actually draws, never to the generic element wrapper: a
 * background on the wrapper would paint a full-width band behind an inline control like the download
 * button, which is not what anyone choosing "background" is asking for.
 *
 * Absent keys are omitted rather than set to a default, so a block with no appearance produces an
 * empty object and renders exactly as it did before this existed.
 */
export function appearanceStyle(element: BuilderElement): CSSProperties {
  const appearance = element.appearance;
  if (appearance === undefined) return {};

  return {
    ...(appearance.textColor === undefined ? {} : { color: appearance.textColor }),
    ...(appearance.backgroundColor === undefined ? {} : { backgroundColor: appearance.backgroundColor }),
  };
}
