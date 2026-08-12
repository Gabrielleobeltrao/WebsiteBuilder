import { describe, expect, it } from "vitest";

import { auditPageBlocks } from "./block-readiness";
import { elementDefinition } from "./element-registry";
import type { BuilderElement, ElementType } from "./elements";
import { createPage } from "./project";

/**
 * What readiness says about a block nobody finished.
 *
 * The distinction these defend is the one that decides whether a page ships: a block that *cannot*
 * work — a video with no id, a form connected to nothing, an image with no decision about its
 * alternative text — is an error, because it reaches a visitor looking like a broken site. A block
 * that is merely empty is a warning, because an empty gallery is a page in progress and that is the
 * author's business.
 */

const element = (type: ElementType, overrides: Record<string, unknown> = {}): BuilderElement =>
  ({
    id: `${type}-1`,
    name: "",
    geometry: { x: 0, y: 0, width: 100, height: 40, rotation: 0 },
    responsiveLayout: {
      width: { value: 100, unit: "px" },
      height: { value: 40, unit: "px" },
      horizontalConstraint: "left",
      verticalConstraint: "top",
      visible: true,
    },
    zIndex: 1,
    locked: false,
    hidden: false,
    type,
    version: elementDefinition(type).schemaVersion,
    ...elementDefinition(type).defaults(),
    ...overrides,
  }) as BuilderElement;

function audit(elements: BuilderElement[]) {
  const page = createPage({ name: "Home", slug: "home", order: 0 });
  page.sections[0]!.elements = elements;
  return auditPageBlocks({ page, path: "/", document: { sharedSections: [] } });
}

const codes = (elements: BuilderElement[]) => audit(elements).map((finding) => finding.code);

describe("blocks that cannot work as configured", () => {
  it("refuses a video with no identifier", () => {
    expect(codes([element("video")])).toContain("video-without-id");
    expect(audit([element("video")])[0]?.severity).toBe("error");
  });

  it("refuses a form connected to nothing", () => {
    // A form that accepts nothing is worse than no form: a visitor fills it in and it goes nowhere.
    expect(codes([element("form")])).toContain("form-without-definition");
  });

  it("refuses a countdown whose target has no timezone", () => {
    expect(codes([element("countdown", { target: "2026-12-24T18:00" })])).toContain("countdown-without-timezone");
    expect(codes([element("countdown", { target: "2026-12-24T18:00:00-03:00" })])).not.toContain(
      "countdown-without-timezone",
    );
  });

  it("refuses an image with no decision about its alternative text", () => {
    const undecided = element("image", { source: { kind: "url", url: "https://example.test/a.png" }, alt: "" });
    expect(codes([undecided])).toContain("image-without-alt");

    const decided = element("image", { source: { kind: "url", url: "https://example.test/a.png" }, decorative: true });
    expect(codes([decided])).not.toContain("image-without-alt");
  });

  it("refuses a gallery image with no alternative text", () => {
    const gallery = element("gallery", {
      items: [{ mediaId: "a", alt: "", decorative: false, caption: "" }],
    });
    expect(codes([gallery])).toContain("gallery-image-without-alt");
  });

  it("refuses an empty navigation menu", () => {
    expect(codes([element("navigationMenu")])).toContain("menu-empty");
  });

  it("refuses a download button with no file", () => {
    expect(codes([element("downloadButton")])).toContain("download-without-file");
  });
});

describe("blocks that are merely unfinished", () => {
  it("reports an empty gallery without blocking", () => {
    const findings = audit([element("gallery")]);
    expect(findings.map((finding) => finding.code)).toContain("gallery-empty");
    expect(findings.find((finding) => finding.code === "gallery-empty")?.severity).toBe("warning");
  });

  it("reports a button that goes nowhere without blocking", () => {
    expect(audit([element("button")]).find((finding) => finding.code === "button-without-link")?.severity).toBe("warning");
  });

  it("reports a table claiming a header row it does not have", () => {
    const table = element("table", { hasHeaderRow: true, headers: ["", ""], rows: [] });
    expect(codes([table])).toContain("table-without-headers");
  });
});

describe("what it leaves alone", () => {
  it("says nothing about a finished page", () => {
    const finished = [
      element("text"),
      element("image", { source: { kind: "url", url: "https://example.test/a.png" }, alt: "A photo" }),
      element("video", { videoId: "abc123" }),
    ];

    expect(audit(finished)).toEqual([]);
  });

  it("ignores a hidden block, because a visitor never sees it", () => {
    expect(audit([element("video", { hidden: true })])).toEqual([]);
  });
});
