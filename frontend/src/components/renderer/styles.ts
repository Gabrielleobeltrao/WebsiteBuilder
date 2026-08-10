import {
  serializeLength,
  type BuilderElement,
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

export function sectionStyle(section: BuilderSection, breakpointId = "desktop"): CSSProperties {
  const height = section.heightByBreakpoint[breakpointId];
  const base: CSSProperties = {
    backgroundColor: section.backgroundColor,
    position: section.layoutMode === "free" ? "relative" : undefined,
    ...(height ? { minHeight: serializeLength(height) } : {}),
  };

  if (section.layoutMode === "grid") return { ...base, display: "grid" };
  if (section.layoutMode === "flex") return { ...base, display: "flex" };
  return base;
}

/** Elements hidden in the document never reach preview or published output. */
export function isRenderable(element: BuilderElement): boolean {
  return !element.hidden;
}
