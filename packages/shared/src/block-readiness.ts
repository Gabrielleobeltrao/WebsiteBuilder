import type { Finding } from "./audit";
import { hasTimezone } from "./content-elements";
import { elementDefinition } from "./element-registry";
import { walkElements, type BuilderElement } from "./elements";
import type { BuilderPage } from "./project";
import { renderablePage } from "./shared-sections";

/**
 * What a block is missing before its page is worth publishing.
 *
 * The rule these follow: report the gap a person can act on, never guess at what they meant. A
 * video with no id, a menu with no items, an image with no decision about its alternative text —
 * each is a page that renders and says nothing, which is the failure that reaches a visitor
 * looking like a broken site rather than an unfinished one.
 *
 * Severity is the difference between "this cannot be used" and "this is not finished". An error
 * blocks publication; a warning is reported and left to the person who designed the page.
 */

export type BlockFinding = Finding & {
  elementId: string;
  pageId: string;
  /** Set when the fix is inside a form definition rather than on the page. */
  formId?: string;
};

function find(
  input: { pageId: string; path: string; element: BuilderElement },
  code: string,
  severity: Finding["severity"],
  detail: string,
): BlockFinding {
  return { code, severity, path: input.path, detail, elementId: input.element.id, pageId: input.pageId };
}

/**
 * Every block on one page, checked against what its own type needs.
 *
 * Shared sections are resolved first: a header is where an unconfigured block usually is, and a
 * page that never resolved its header would report itself clean while every visitor saw the gap.
 */
export function auditPageBlocks(input: {
  page: BuilderPage;
  path: string;
  document: { sharedSections: readonly BuilderPage["sections"][number][] };
}): BlockFinding[] {
  const resolved = renderablePage(input.document, input.page);
  const findings: BlockFinding[] = [];
  const anchors = new Map<string, number>();

  for (const section of resolved.sections) {
    if (section.hidden) continue;

    for (const element of walkElements(section.elements)) {
      if (element.hidden) continue;
      const at = { pageId: input.page.id, path: input.path, element };

      // Anchors have to be unique for a link to reach one of them.
      const anchor = (element as { anchorId?: string }).anchorId;
      if (typeof anchor === "string" && anchor !== "") {
        anchors.set(anchor, (anchors.get(anchor) ?? 0) + 1);
      }

      switch (element.type) {
        case "image":
          if (element.source.kind === "empty") {
            findings.push(find(at, "image-without-source", "warning", "This image has no file chosen yet."));
          }
          if (!element.decorative && element.alt.trim() === "") {
            findings.push(
              find(at, "image-without-alt", "error", "This image needs alternative text, or has to be marked decorative."),
            );
          }
          break;

        case "gallery":
          if (element.items.length === 0) {
            findings.push(find(at, "gallery-empty", "warning", "This gallery has no images yet."));
          }
          for (const item of element.items) {
            if (!item.decorative && item.alt.trim() === "") {
              findings.push(
                find(at, "gallery-image-without-alt", "error", "An image in this gallery needs alternative text, or has to be marked decorative."),
              );
              break;
            }
          }
          break;

        case "video":
          if (element.videoId.trim() === "") {
            findings.push(find(at, "video-without-id", "error", "This video has no identifier, so it shows an empty frame."));
          }
          break;

        case "downloadButton":
          if (element.mediaId.trim() === "") {
            findings.push(find(at, "download-without-file", "error", "This download button has no file chosen."));
          }
          break;

        case "form":
          if (element.formId.trim() === "") {
            findings.push(find(at, "form-without-definition", "error", "This form is not connected to a form yet, so it would accept nothing."));
          }
          break;

        case "navigationMenu":
          if (element.items.length === 0) {
            findings.push(find(at, "menu-empty", "error", "This navigation menu has no items."));
          }
          break;

        case "countdown":
          if (element.target.trim() === "") {
            findings.push(find(at, "countdown-without-target", "error", "This countdown has no target moment."));
          } else if (!hasTimezone(element.target)) {
            findings.push(
              find(at, "countdown-without-timezone", "error", "This countdown's target has no timezone, so it means a different moment for every visitor."),
            );
          }
          break;

        case "table":
          if (element.hasHeaderRow && element.headers.every((header) => header.trim() === "")) {
            findings.push(find(at, "table-without-headers", "warning", "This table claims a header row, but its headers are empty."));
          }
          break;

        case "siteLogo":
          if (element.mediaId === "" && element.fallbackText.trim() === "") {
            findings.push(find(at, "logo-empty", "warning", "This logo has neither an image nor fallback text."));
          } else if (element.mediaId !== "" && element.alt.trim() === "") {
            findings.push(find(at, "logo-without-alt", "error", "This logo image needs alternative text."));
          }
          break;

        case "carousel":
          if (element.slides.length === 0) {
            findings.push(find(at, "carousel-empty", "warning", "This carousel has no slides yet."));
          }
          break;

        case "button":
          if (element.link.kind === "none") {
            findings.push(find(at, "button-without-link", "warning", "This button does not go anywhere yet."));
          }
          break;

        default:
          break;
      }

      // A block whose behaviour needs the runtime, on a page that will not load it, would be a
      // control that does nothing. The registry is what decides, so this cannot drift from it.
      const definition = elementDefinition(element.type);
      if (definition === undefined) {
        findings.push(find(at, "unknown-block", "error", "This block is not one this version knows how to render."));
      }
    }
  }

  for (const [anchor, count] of anchors) {
    if (count < 2) continue;
    findings.push({
      code: "duplicate-anchor",
      severity: "warning",
      path: input.path,
      detail: `More than one block claims the anchor "${anchor}", so a link to it reaches whichever comes first.`,
      elementId: "",
      pageId: input.page.id,
    });
  }

  return findings;
}
