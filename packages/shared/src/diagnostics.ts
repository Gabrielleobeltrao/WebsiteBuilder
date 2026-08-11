import { MIN_TAP_TARGET, type Finding } from "./audit";
import { walkElements, type BuilderElement } from "./elements";
import { isReadableFontSize, type BreakpointDefinition } from "./responsive";
import { DEVICE_MODES } from "./devices";
import { resolveLayoutAt, SWEEP_WIDTHS } from "./resolve";
import type { BuilderPage } from "./project";

/**
 * Responsive diagnostics.
 *
 * Everything here is a report. Nothing adjusts a layout: a tool that silently moves an element to
 * fix an overflow leaves a designer unable to tell what they built from what it decided, and the
 * next edit fights it. Each finding names the element and the widths where it applies.
 *
 * Widths come from the audit's own sweep list rather than a second one here: the interesting
 * failures happen *between* breakpoints, which is exactly where nobody set an override, and two
 * lists would eventually disagree about which widths those are.
 */
export const MIN_PREVIEW_WIDTH = 320;
export const MAX_PREVIEW_WIDTH = 1920;

export type WidthRange = { from: number; to: number };

export type ResponsiveFinding = Finding & {
  /** The widths this applies at, merged into ranges so one problem is one finding. */
  ranges: WidthRange[];
};

/** Clamps a requested preview width to what the sweep and the presets cover. */
export function clampPreviewWidth(width: number): number {
  if (!Number.isFinite(width)) return MAX_PREVIEW_WIDTH;
  return Math.min(MAX_PREVIEW_WIDTH, Math.max(MIN_PREVIEW_WIDTH, Math.round(width)));
}

/**
 * Widths the diagnostics sweep reports at.
 *
 * The three authored devices come from the shared definition; the others exist because a layout
 * that is correct at 390 and 1440 can still break at 700, and finding that is what diagnostics are
 * for. Extra widths here are not extra modes anyone authors.
 */
export const DEVICE_PRESETS = [
  { id: "phone-small", label: "Small phone", width: 320 },
  { id: "phone", label: "Phone", width: DEVICE_MODES.mobile.referenceWidth },
  { id: "tablet", label: "Tablet", width: DEVICE_MODES.tablet.referenceWidth },
  { id: "laptop", label: "Laptop", width: 1280 },
  { id: "desktop", label: "Desktop", width: DEVICE_MODES.desktop.referenceWidth },
  { id: "wide", label: "Wide", width: 1920 },
] as const;

type Problem = { code: string; severity: Finding["severity"]; elementId: string; detail: string };

/**
 * Runs the sweep and merges each element's problems into width ranges.
 *
 * Reporting one finding per width would bury a single real problem under thirteen copies of itself.
 */
export function diagnoseResponsive(input: {
  page: BuilderPage;
  path: string;
  breakpoints: readonly BreakpointDefinition[];
  widths?: readonly number[];
}): ResponsiveFinding[] {
  const widths = [...(input.widths ?? SWEEP_WIDTHS)].sort((a, b) => a - b);
  const byKey = new Map<string, { problem: Problem; widths: number[] }>();

  for (const width of widths) {
    for (const problem of problemsAt(input.page, width, input.breakpoints)) {
      const key = `${problem.code}:${problem.elementId}`;
      const existing = byKey.get(key);
      if (existing === undefined) byKey.set(key, { problem, widths: [width] });
      else existing.widths.push(width);
    }
  }

  return [...byKey.values()].map(({ problem, widths: affected }) => ({
    code: problem.code,
    severity: problem.severity,
    path: input.path,
    elementId: problem.elementId,
    detail: problem.detail,
    ranges: toRanges(affected, widths),
  }));
}

function problemsAt(
  page: BuilderPage,
  width: number,
  breakpoints: readonly BreakpointDefinition[],
): Problem[] {
  const problems: Problem[] = [];

  for (const section of page.sections) {
    if (section.hidden) continue;

    // Only free-positioned sections place elements by coordinate; a grid or flex section decides
    // position itself, so overflow and overlap there are not the document's doing.
    const positioned = section.layoutMode === "free";

    const boxes: Array<{ element: BuilderElement; left: number; top: number; right: number; bottom: number }> = [];

    for (const element of walkElements(section.elements)) {
      if (element.hidden) continue;

      const resolved = resolveLayoutAt({
        width,
        base: element.responsiveLayout,
        geometry: element.geometry,
        breakpoints,
        overrides: element.breakpointOverrides,
      });

      if (resolved.layout.visible === false) continue;

      const box = {
        element,
        left: resolved.geometry.x,
        top: resolved.geometry.y,
        right: resolved.geometry.x + resolved.geometry.width,
        bottom: resolved.geometry.y + resolved.geometry.height,
      };

      if (positioned) {
        if (box.right > width) {
          problems.push({
            code: "overflow",
            severity: "error",
            elementId: element.id,
            detail: `This element extends ${Math.round(box.right - width)}px past the right edge of the screen.`,
          });
        }
        if (box.left < 0) {
          problems.push({
            code: "off-canvas",
            severity: "error",
            elementId: element.id,
            detail: "This element starts to the left of the screen and part of it cannot be seen.",
          });
        }
        boxes.push(box);
      }

      if (resolved.geometry.width <= 0 || resolved.geometry.height <= 0) {
        problems.push({
          code: "impossible-size",
          severity: "error",
          elementId: element.id,
          detail: "This element resolves to no width or no height, so nothing renders.",
        });
      }

      if (element.type === "button" && (resolved.geometry.height < MIN_TAP_TARGET || resolved.geometry.width < MIN_TAP_TARGET)) {
        problems.push({
          code: "small-tap-target",
          severity: "warning",
          elementId: element.id,
          detail: `This button is smaller than ${MIN_TAP_TARGET}px, which is hard to tap accurately.`,
        });
      }

      if (element.type === "text" && isReadableFontSize(element.style.fontSize) === false) {
        problems.push({
          code: "small-text",
          severity: "warning",
          elementId: element.id,
          detail: "This text is too small to read comfortably on a phone.",
        });
      }

      if (element.type === "image" && element.source.kind === "url") {
        problems.push({
          code: "missing-responsive-asset",
          severity: "warning",
          elementId: element.id,
          detail: "This image links to an external file, so no smaller version can be offered to phones.",
        });
      }
    }

    problems.push(...overlaps(boxes));
  }

  return problems;
}

/**
 * Overlaps between free-positioned elements.
 *
 * Only reported when neither element declares itself above the other: deliberate layering is a
 * design choice, and flagging it would make the report noise nobody reads.
 */
function overlaps(
  boxes: ReadonlyArray<{ element: BuilderElement; left: number; top: number; right: number; bottom: number }>,
): Problem[] {
  const problems: Problem[] = [];

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.element.zIndex !== b.element.zIndex) continue;

      const intersects = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      if (!intersects) continue;

      problems.push({
        code: "overlap",
        severity: "warning",
        elementId: a.element.id,
        detail: `This element overlaps "${b.element.name}" at the same depth, so which one covers the other is undefined.`,
      });
    }
  }

  return problems;
}

/**
 * Collapses swept widths into ranges.
 *
 * A range runs to the next swept width that was clean, so "320–640" means every width tested in
 * that span failed rather than implying the untested ones in between were checked.
 */
function toRanges(affected: readonly number[], allWidths: readonly number[]): WidthRange[] {
  const ranges: WidthRange[] = [];
  let current: WidthRange | null = null;

  for (const width of allWidths) {
    if (affected.includes(width)) {
      if (current === null) current = { from: width, to: width };
      else current.to = width;
    } else if (current !== null) {
      ranges.push(current);
      current = null;
    }
  }

  if (current !== null) ranges.push(current);
  return ranges;
}

/** "320px", "320–640px". Formatting lives here so every surface phrases a range the same way. */
export function formatRange(range: WidthRange): string {
  return range.from === range.to ? `${range.from}px` : `${range.from}–${range.to}px`;
}
