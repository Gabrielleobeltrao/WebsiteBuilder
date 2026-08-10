import { walkElements, type BuilderElement } from "./elements";
import type { BuilderPage } from "./project";
import { resolveSafeLinkHref } from "./links";

/**
 * Site readiness audit.
 *
 * Every finding names an exact route and element and says what to do. A report that says
 * "improve accessibility" is not actionable, and a report that claims compliance is not honest —
 * automated checks cover a fraction of WCAG, so anything requiring human judgement is reported as
 * `manual-review` rather than passed silently.
 */
export type Severity = "error" | "warning" | "manual-review";

export type Finding = {
  code: string;
  severity: Severity;
  path: string;
  elementId?: string;
  /** Enough to fix it without opening a spec. */
  detail: string;
};

/** Contrast per WCAG relative luminance. Text below 4.5:1 fails AA at normal size. */
export function contrastRatio(foreground: string, background: string): number | null {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  if (a === null || b === null) return null;

  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: string): number | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex === null) return null;

  const value = hex[1] as string;
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const MIN_CONTRAST_NORMAL = 4.5;
export const MIN_CONTRAST_LARGE = 3;
export const MIN_TAP_TARGET = 24;

/**
 * Accessibility findings for one page.
 *
 * Heading order, alt text, link text, contrast and tap targets are all checkable from the document.
 * Anything that depends on meaning — whether alt text actually describes the image, whether a
 * heading is the right level for its content — is reported for manual review instead of guessed.
 */
export function auditPageAccessibility(page: BuilderPage, path: string): Finding[] {
  const findings: Finding[] = [];
  const elements = page.sections.flatMap((section) => [...walkElements(section.elements)]);

  const headings = elements.filter(
    (element): element is Extract<BuilderElement, { type: "text" }> =>
      element.type === "text" && element.tag !== "p" && !element.hidden,
  );

  const h1s = headings.filter((heading) => heading.tag === "h1");
  if (h1s.length === 0) {
    findings.push({ code: "missing-h1", severity: "error", path, detail: "This page has no level 1 heading." });
  }
  if (h1s.length > 1) {
    for (const extra of h1s.slice(1)) {
      findings.push({
        code: "multiple-h1",
        severity: "warning",
        path,
        elementId: extra.id,
        detail: "More than one level 1 heading. Demote this one to a level 2.",
      });
    }
  }

  // Heading levels must not jump: h2 to h4 leaves a screen reader user unsure what was skipped.
  let previousLevel = 0;
  for (const heading of headings) {
    const level = Number(heading.tag.slice(1));
    if (previousLevel !== 0 && level > previousLevel + 1) {
      findings.push({
        code: "heading-level-skipped",
        severity: "warning",
        path,
        elementId: heading.id,
        detail: `Heading jumps from level ${previousLevel} to ${level}. Use level ${previousLevel + 1}.`,
      });
    }
    previousLevel = level;
  }

  for (const element of elements) {
    if (element.hidden) continue;

    if (element.type === "image" && !element.decorative && element.alt.trim().length === 0) {
      findings.push({
        code: "missing-alt",
        severity: "error",
        path,
        elementId: element.id,
        detail: "Describe this image, or mark it decorative if it carries no meaning.",
      });
    }

    if (element.type === "image" && element.decorative && element.alt.trim().length > 0) {
      findings.push({
        code: "decorative-with-alt",
        severity: "warning",
        path,
        elementId: element.id,
        detail: "A decorative image should have no description.",
      });
    }

    if (element.type === "button") {
      if (element.text.trim().length === 0) {
        findings.push({
          code: "missing-link-text",
          severity: "error",
          path,
          elementId: element.id,
          detail: "This button has no text, so it is announced as unlabelled.",
        });
      } else if (NON_DESCRIPTIVE.has(element.text.trim().toLowerCase())) {
        findings.push({
          code: "non-descriptive-link-text",
          severity: "warning",
          path,
          elementId: element.id,
          detail: `"${element.text.trim()}" does not say where it goes. Name the destination.`,
        });
      }

      const ratio = contrastRatio(element.style.textColor, element.style.backgroundColor);
      if (ratio !== null && ratio < MIN_CONTRAST_NORMAL) {
        findings.push({
          code: "low-contrast",
          severity: "error",
          path,
          elementId: element.id,
          detail: `Text contrast is ${ratio.toFixed(2)}:1. It needs at least ${MIN_CONTRAST_NORMAL}:1.`,
        });
      }

      if (element.geometry.height < MIN_TAP_TARGET || element.geometry.width < MIN_TAP_TARGET) {
        findings.push({
          code: "small-tap-target",
          severity: "warning",
          path,
          elementId: element.id,
          detail: `This target is smaller than ${MIN_TAP_TARGET}x${MIN_TAP_TARGET}px and is hard to hit on touch.`,
        });
      }
    }

    if (element.type === "text" && !element.hidden) {
      const ratio = contrastRatio(element.style.color, page.canvas.backgroundColor);
      const size = "value" in element.style.fontSize ? element.style.fontSize.value : 16;
      const threshold = size >= 24 ? MIN_CONTRAST_LARGE : MIN_CONTRAST_NORMAL;

      if (ratio !== null && ratio < threshold) {
        findings.push({
          code: "low-contrast",
          severity: "error",
          path,
          elementId: element.id,
          detail: `Text contrast is ${ratio.toFixed(2)}:1. It needs at least ${threshold}:1 at this size.`,
        });
      }
    }
  }

  // Automated checks cannot judge whether a description is accurate or a reading order makes sense.
  if (elements.some((element) => element.type === "image" && !element.decorative)) {
    findings.push({
      code: "alt-text-quality",
      severity: "manual-review",
      path,
      detail: "Check that each image description conveys what the image communicates.",
    });
  }

  return findings;
}

const NON_DESCRIPTIVE = new Set([
  "click here",
  "here",
  "read more",
  "more",
  "link",
  "this",
  "clique aqui",
  "aqui",
  "leia mais",
  "saiba mais",
]);

/** Broken internal links and missing media, reported before a visitor finds them. */
export function auditPageLinks(
  page: BuilderPage,
  path: string,
  options: { resolvePagePath: (pageId: string) => string | null; mediaExists: (mediaId: string) => boolean },
): Finding[] {
  const findings: Finding[] = [];

  for (const section of page.sections) {
    for (const element of walkElements(section.elements)) {
      if (element.type === "button") {
        const resolved = resolveSafeLinkHref(element.link, { resolvePagePath: options.resolvePagePath });
        if (element.link.kind !== "none" && resolved === null) {
          findings.push({
            code: "broken-link",
            severity: "error",
            path,
            elementId: element.id,
            detail: "This link does not resolve. Its destination may have been deleted.",
          });
        }
        if (element.link.kind === "none") {
          findings.push({
            code: "unconfigured-link",
            severity: "warning",
            path,
            elementId: element.id,
            detail: "This button has no destination yet.",
          });
        }
      }

      if (element.type === "image" && element.source.kind === "media" && !options.mediaExists(element.source.mediaId)) {
        findings.push({
          code: "missing-media",
          severity: "error",
          path,
          elementId: element.id,
          detail: "This image references media that no longer exists.",
        });
      }
    }
  }

  return findings;
}

export type ReadinessReport = {
  findings: Finding[];
  errors: number;
  warnings: number;
  manualReviews: number;
  /** True only when no error remains. Warnings and manual reviews never block. */
  readyToPublish: boolean;
};

export function summarise(findings: readonly Finding[]): ReadinessReport {
  const errors = findings.filter((finding) => finding.severity === "error").length;
  return {
    findings: [...findings],
    errors,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    manualReviews: findings.filter((finding) => finding.severity === "manual-review").length,
    readyToPublish: errors === 0,
  };
}
