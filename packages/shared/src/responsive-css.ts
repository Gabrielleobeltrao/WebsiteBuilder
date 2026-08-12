import { DEVICE_MODES, DEVICE_ORDER, deviceReferenceWidth, type DeviceMode } from "./devices";
import { serializeFlexLayout, serializeGridLayout, readFlexLayout, readGridLayout } from "./layout";
import { DESIGN_WIDTH, serializeLength, type Geometry, type ResponsiveElementLayout } from "./responsive";
import { resolveElementForDevice, resolveSectionForDevice } from "./resolve";
import type { BuilderElement } from "./elements";
import type { BuilderPage, BuilderSection } from "./project";

/**
 * Compiles a page's responsive behaviour into CSS.
 *
 * This is the layer that makes the editor, the preview and the published site the same thing. All
 * three render the same markup and apply the same stylesheet produced here, so "it looked right in
 * the builder" and "it looks right to a visitor" stop being two separate claims.
 *
 * Two rules shape everything below.
 *
 * **Constraints become relative CSS, not positions computed at three widths.** A centred element is
 * `left: 50%`, not "centred at 390 and again at 768" — because a browser at 500 px would then be
 * using the 390 value and the element would not be centred. Media queries carry only what an author
 * explicitly overrode for a device; the constraint itself holds at every width in between, with no
 * JavaScript and nothing to repair after paint.
 *
 * **Nothing here accepts a string.** Every value is a number the compiler formats or a keyword from
 * a closed enum. A persisted document therefore has no path to an arbitrary declaration, which is
 * the property that lets this stylesheet be inlined into a published page under a policy that
 * forbids inline scripts and trusts inline styles.
 */

/** Two decimals: enough for a layout, and stable enough that the output hashes identically. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const percent = (value: number, of: number) => `${round((value / of) * 100)}%`;

/** Only the characters that could end an attribute selector. Ids are generated, but ids are data. */
function escapeSelector(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * The declarations that place one free-positioned element, in a form that holds at every width.
 *
 * Each constraint maps to CSS that is correct continuously rather than at sampled widths — that is
 * the whole reason the published output needs no script and no resize listener.
 */
function freePlacement(geometry: Geometry, layout: ResponsiveElementLayout, canvasWidth: number): string[] {
  const rightGap = canvasWidth - (geometry.x + geometry.width);
  const declarations = [`position:absolute`, `top:${round(geometry.y)}px`];

  /**
   * The width an element may never exceed: what is left of the screen after its own offset.
   *
   * A fixed width is an authored intention, not a promise that the screen is that wide. Without this
   * ceiling an element authored at 358px inside a 390px canvas pushes a 320px phone sideways — and
   * the published stylesheet deliberately carries no `overflow-x: hidden` to conceal that. Expressed
   * as a percentage of the containing section, so it stays true at every width with no JavaScript
   * and nothing to repair after paint.
   */
  let containment: string | null = null;

  switch (layout.horizontalConstraint) {
    case "left":
      declarations.push(`left:${round(geometry.x)}px`, `width:${round(geometry.width)}px`);
      containment = `calc(100% - ${round(geometry.x)}px)`;
      break;
    case "right":
      // Anchored to the other edge, so the gap the author left is the gap a visitor sees.
      declarations.push(`right:${round(rightGap)}px`, `width:${round(geometry.width)}px`);
      containment = `calc(100% - ${round(rightGap)}px)`;
      break;
    case "center":
      declarations.push(`left:50%`, `width:${round(geometry.width)}px`, `transform:translateX(-50%)`);
      containment = `100%`;
      break;
    case "stretch":
      // Both gaps held and the width left to the browser: the element grows and shrinks with the page.
      declarations.push(`left:${round(geometry.x)}px`, `right:${round(rightGap)}px`, `width:auto`);
      break;
    case "scale":
      declarations.push(`left:${percent(geometry.x, canvasWidth)}`, `width:${percent(geometry.width, canvasWidth)}`);
      break;
  }

  if (layout.verticalConstraint === "scale") {
    declarations.push(`height:${percent(geometry.height, canvasWidth)}`);
  } else if (layout.aspectRatio !== undefined && layout.aspectRatio > 0) {
    declarations.push(`aspect-ratio:${round(layout.aspectRatio)}`);
  } else {
    declarations.push(`height:${round(geometry.height)}px`);
  }

  if (layout.minWidth) declarations.push(`min-width:${serializeLength(layout.minWidth)}`);

  // An authored maximum and the containment ceiling are both real limits, so the effective one is
  // whichever is smaller — expressed once, because two `max-width` declarations would just mean the
  // later one wins and the other was decoration.
  const authoredMax = layout.maxWidth ? serializeLength(layout.maxWidth) : null;
  if (authoredMax !== null && containment !== null) declarations.push(`max-width:min(${authoredMax},${containment})`);
  else if (authoredMax !== null) declarations.push(`max-width:${authoredMax}`);
  else if (containment !== null) declarations.push(`max-width:${containment}`);

  if (!layout.visible) declarations.push(`display:none`);

  return declarations;
}

/** Declarations for an element in normal flow, where the browser does the placing. */
function flowPlacement(layout: ResponsiveElementLayout): string[] {
  const declarations: string[] = [];
  if (layout.minWidth) declarations.push(`min-width:${serializeLength(layout.minWidth)}`);
  if (layout.maxWidth) declarations.push(`max-width:${serializeLength(layout.maxWidth)}`);
  if (!layout.visible) declarations.push(`display:none`);
  return declarations;
}

/** The responsive slice of an element's style, as declarations. */
function styleDeclarations(style: NonNullable<ReturnType<typeof resolveElementForDevice>["style"]>): string[] {
  switch (style.type) {
    case "text":
      return [
        ...(style.fontSize ? [`font-size:${serializeLength(style.fontSize)}`] : []),
        ...(style.lineHeight === undefined ? [] : [`line-height:${round(style.lineHeight)}`]),
        ...(style.textAlign ? [`text-align:${style.textAlign}`] : []),
      ];
    case "button":
      return [
        ...(style.fontSize ? [`font-size:${serializeLength(style.fontSize)}`] : []),
        ...(style.horizontalAlign ? [`justify-content:${alignToJustify(style.horizontalAlign)}`] : []),
        ...(style.widthBehavior === "fill" ? ["width:100%"] : []),
      ];
    case "image":
      return [
        ...(style.objectFit ? [`object-fit:${style.objectFit}`] : []),
        ...(style.objectPosition ? [`object-position:${style.objectPosition}`] : []),
      ];
    case "container":
      return [
        ...(style.direction ? [`flex-direction:${style.direction}`] : []),
        ...(style.wrap ? [`flex-wrap:${style.wrap}`] : []),
        ...(style.gap ? [`gap:${serializeLength(style.gap)}`] : []),
        ...(style.padding ? [`padding:${serializeLength(style.padding)}`] : []),
        ...(style.align ? [`align-items:${style.align === "start" || style.align === "end" ? `flex-${style.align}` : style.align}`] : []),
        ...(style.justify
          ? [`justify-content:${style.justify === "start" || style.justify === "end" ? `flex-${style.justify}` : style.justify}`]
          : []),
      ];
  }
}

const alignToJustify = (align: "left" | "center" | "right") =>
  align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";

/** A media query that selects a device, or no wrapper at all for the desktop base. */
function mediaFor(device: DeviceMode, body: string): string {
  if (device === "desktop" || body === "") return body;
  return `@media (max-width:${DEVICE_MODES[device].maxWidth}px){${body}}`;
}

const rule = (selector: string, declarations: string[]) =>
  declarations.length === 0 ? "" : `${selector}{${declarations.join(";")}}`;

function elementSelector(pageId: string, elementId: string): string {
  return `[data-page-id="${escapeSelector(pageId)}"] [data-element-id="${escapeSelector(elementId)}"]`;
}

function sectionSelector(pageId: string, sectionId: string): string {
  return `[data-page-id="${escapeSelector(pageId)}"] [data-section-id="${escapeSelector(sectionId)}"]`;
}

/**
 * Every rule one element needs, across every device.
 *
 * The desktop rule is unconditional; each narrower device contributes a rule only where it actually
 * resolves to something different. A media query that restates its parent's values is bytes on a
 * visitor's connection for no change in what they see.
 */
function compileElement(pageId: string, section: BuilderSection, element: BuilderElement): string {
  const free = section.layoutMode === "free";
  const selector = elementSelector(pageId, element.id);
  const parts: string[] = [];
  let previous: string | null = null;

  for (const device of DEVICE_ORDER) {
    const resolved = resolveElementForDevice({
      device,
      width: deviceReferenceWidth(device),
      base: element.responsiveLayout,
      geometry: element.geometry,
      overrides: element.breakpointOverrides,
    });

    const declarations = [
      ...(free
        ? freePlacement(resolved.authoredGeometry, resolved.layout, resolved.referenceWidth)
        : flowPlacement(resolved.layout)),
      ...(resolved.style === null ? [] : styleDeclarations(resolved.style)),
    ];

    const body = declarations.join(";");
    if (device !== "desktop" && body === previous) continue;
    previous = body;

    parts.push(mediaFor(device, rule(selector, declarations)));
  }

  return parts.filter((part) => part !== "").join("");
}

function compileSection(pageId: string, section: BuilderSection): string {
  const selector = sectionSelector(pageId, section.id);
  const parts: string[] = [];
  let previous: string | null = null;

  for (const device of DEVICE_ORDER) {
    const resolved = resolveSectionForDevice({
      device,
      heightByBreakpoint: section.heightByBreakpoint,
      layoutByBreakpoint: section.layoutByBreakpoint,
    });

    const declarations: string[] = [];
    if (resolved.height !== null) declarations.push(`min-height:${serializeLength(resolved.height)}`);

    if (section.layoutMode === "grid") {
      for (const [property, value] of Object.entries(serializeGridLayout(readGridLayout(resolved.layout)))) {
        declarations.push(`${kebab(property)}:${value}`);
      }
    } else if (section.layoutMode === "flex") {
      for (const [property, value] of Object.entries(serializeFlexLayout(readFlexLayout(resolved.layout)))) {
        declarations.push(`${kebab(property)}:${value}`);
      }
    } else {
      declarations.push("position:relative");
    }

    const body = declarations.join(";");
    if (device !== "desktop" && body === previous) continue;
    previous = body;

    parts.push(mediaFor(device, rule(selector, declarations)));
  }

  return parts.filter((part) => part !== "").join("");
}

const kebab = (property: string) => property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * The stylesheet for one page.
 *
 * Deterministic: the same document always produces the same bytes, in the same order, so a content
 * hash over a published version is stable and a diff between two builds means something.
 */
export function compilePageCss(page: BuilderPage): string {
  const parts: string[] = [];

  for (const section of page.sections) {
    if (section.hidden) continue;
    parts.push(compileSection(page.id, section));
    for (const element of section.elements) {
      parts.push(compileElement(page.id, section, element));
    }
  }

  return parts.filter((part) => part !== "").join("\n");
}

/**
 * Defaults every published page carries.
 *
 * Deliberately the smallest set that prevents a browser's own defaults from breaking a layout
 * nobody authored badly — and nothing that hides authored overflow. `overflow-x:hidden` is absent
 * on purpose: it would make a broken layout look fixed while the content stayed unreachable, which
 * is worse than the break, because nobody would ever be told.
 */
export const PUBLISHED_BASE_CSS = [
  "*,*::before,*::after{box-sizing:border-box}",
  "body{margin:0}",
  "img,video,canvas,svg{max-width:100%;height:auto}",
  // Long unbroken strings — a URL, a hash, a German compound — otherwise widen the page itself.
  "p,h1,h2,h3,h4,h5,h6,li,td,th{overflow-wrap:break-word}",
].join("");

/** The width a document's geometry is authored against, exported for callers that must agree. */
export const AUTHORING_CANVAS_WIDTH = DESIGN_WIDTH;
