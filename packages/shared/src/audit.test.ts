import { describe, expect, it } from "vitest";

import {
  auditPageAccessibility,
  auditPageLinks,
  contrastRatio,
  MIN_TAP_TARGET,
  summarise,
} from "./audit";
import { createId } from "./ids";
import { createPage } from "./project";
import type { BuilderElement } from "./elements";
import type { BuilderPage } from "./project";

const geometry = { x: 0, y: 0, width: 320, height: 64, rotation: 0 };
const layout = {
  width: { value: 320, unit: "px" as const },
  height: { value: 64, unit: "px" as const },
  horizontalConstraint: "left" as const,
  verticalConstraint: "top" as const,
  visible: true,
};

const text = (overrides: Partial<Extract<BuilderElement, { type: "text" }>> = {}) =>
  ({
    id: createId(),
    type: "text",
    name: "Text",
    tag: "h1",
    content: "Heading",
    geometry,
    responsiveLayout: layout,
    zIndex: 1,
    locked: false,
    hidden: false,
    style: {
      fontFamily: "Inter",
      fontSize: { value: 32, unit: "px" },
      fontWeight: 700,
      fontStyle: "normal",
      textAlign: "left",
      color: "#111111",
      lineHeight: 1.2,
    },
    ...overrides,
  }) as BuilderElement;

const image = (overrides: Record<string, unknown> = {}) =>
  ({
    id: createId(),
    type: "image",
    name: "Image",
    source: { kind: "media", mediaId: "m1" },
    alt: "A description",
    decorative: false,
    geometry,
    responsiveLayout: layout,
    zIndex: 1,
    locked: false,
    hidden: false,
    style: { objectFit: "cover", borderRadius: 0 },
    ...overrides,
  }) as BuilderElement;

const button = (overrides: Record<string, unknown> = {}) =>
  ({
    id: createId(),
    type: "button",
    name: "Button",
    text: "See our pricing",
    link: { kind: "internal", pageId: "about" },
    geometry,
    responsiveLayout: layout,
    zIndex: 1,
    locked: false,
    hidden: false,
    style: {
      fontSize: { value: 16, unit: "px" },
      fontWeight: 600,
      textColor: "#ffffff",
      backgroundColor: "#12806f",
      borderRadius: 6,
      horizontalAlign: "center",
    },
    ...overrides,
  }) as BuilderElement;

function pageWith(elements: BuilderElement[]): BuilderPage {
  const page = createPage({ name: "Home", isHome: true });
  page.sections[0]!.elements = elements;
  return page;
}

const codes = (findings: ReturnType<typeof auditPageAccessibility>) => findings.map((finding) => finding.code);

describe("contrastRatio", () => {
  it("computes the WCAG ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("returns null for a colour it cannot parse rather than guessing", () => {
    expect(contrastRatio("rgb(0,0,0)", "#ffffff")).toBeNull();
  });
});

describe("headings", () => {
  it("reports a page with no level 1 heading", () => {
    expect(codes(auditPageAccessibility(pageWith([text({ tag: "h2" })]), "/"))).toContain("missing-h1");
  });

  it("reports every extra level 1 heading beyond the first", () => {
    const findings = auditPageAccessibility(pageWith([text(), text(), text()]), "/");
    expect(findings.filter((finding) => finding.code === "multiple-h1")).toHaveLength(2);
  });

  it("reports a skipped heading level with the level to use instead", () => {
    const findings = auditPageAccessibility(pageWith([text({ tag: "h1" }), text({ tag: "h4" })]), "/");
    const skipped = findings.find((finding) => finding.code === "heading-level-skipped");
    expect(skipped?.detail).toContain("Use level 2");
  });

  it("accepts a correct heading sequence", () => {
    const findings = auditPageAccessibility(
      pageWith([text({ tag: "h1" }), text({ tag: "h2" }), text({ tag: "h3" })]),
      "/",
    );
    expect(codes(findings)).not.toContain("heading-level-skipped");
  });
});

describe("images", () => {
  it("reports a missing description and says what the options are", () => {
    const findings = auditPageAccessibility(pageWith([text(), image({ alt: "  " })]), "/");
    const missing = findings.find((finding) => finding.code === "missing-alt");
    expect(missing?.severity).toBe("error");
    expect(missing?.detail).toContain("mark it decorative");
  });

  it("reports a decorative image that still carries a description", () => {
    const findings = auditPageAccessibility(pageWith([text(), image({ decorative: true })]), "/");
    expect(codes(findings)).toContain("decorative-with-alt");
  });

  it("flags description quality for manual review rather than passing it silently", () => {
    const findings = auditPageAccessibility(pageWith([text(), image()]), "/");
    const manual = findings.find((finding) => finding.code === "alt-text-quality");
    expect(manual?.severity).toBe("manual-review");
  });

  it("ignores hidden elements, which reach no visitor", () => {
    const findings = auditPageAccessibility(pageWith([text(), image({ alt: "", hidden: true })]), "/");
    expect(codes(findings)).not.toContain("missing-alt");
  });
});

describe("buttons", () => {
  it("reports an unlabelled button as an error", () => {
    const findings = auditPageAccessibility(pageWith([text(), button({ text: "  " })]), "/");
    expect(codes(findings)).toContain("missing-link-text");
  });

  it("reports non-descriptive link text in both languages", () => {
    for (const label of ["Click here", "Leia mais", "Saiba mais"]) {
      const findings = auditPageAccessibility(pageWith([text(), button({ text: label })]), "/");
      expect(codes(findings)).toContain("non-descriptive-link-text");
    }
  });

  it("accepts link text that names its destination", () => {
    const findings = auditPageAccessibility(pageWith([text(), button()]), "/");
    expect(codes(findings)).not.toContain("non-descriptive-link-text");
  });

  it("reports low contrast with the measured ratio", () => {
    const findings = auditPageAccessibility(
      pageWith([text(), button({ style: { ...(button() as never as { style: Record<string, unknown> }).style, textColor: "#cccccc", backgroundColor: "#ffffff" } })]),
      "/",
    );
    const low = findings.find((finding) => finding.code === "low-contrast");
    expect(low?.severity).toBe("error");
    expect(low?.detail).toMatch(/\d\.\d\d:1/);
  });

  it("reports a tap target smaller than the minimum", () => {
    const findings = auditPageAccessibility(
      pageWith([text(), button({ geometry: { ...geometry, width: 20, height: 20 } })]),
      "/",
    );
    const small = findings.find((finding) => finding.code === "small-tap-target");
    expect(small?.detail).toContain(String(MIN_TAP_TARGET));
  });
});

describe("links and media", () => {
  const options = { resolvePagePath: (id: string) => (id === "about" ? "/about" : null), mediaExists: (id: string) => id === "m1" };

  it("reports a link whose destination was deleted", () => {
    const findings = auditPageLinks(pageWith([button({ link: { kind: "internal", pageId: "deleted" } })]), "/", options);
    expect(findings.map((f) => f.code)).toContain("broken-link");
  });

  it("reports a button with no destination as a warning, not an error", () => {
    const findings = auditPageLinks(pageWith([button({ link: { kind: "none" } })]), "/", options);
    expect(findings.find((f) => f.code === "unconfigured-link")?.severity).toBe("warning");
  });

  it("reports an image referencing media that no longer exists", () => {
    const findings = auditPageLinks(pageWith([image({ source: { kind: "media", mediaId: "gone" } })]), "/", options);
    expect(findings.map((f) => f.code)).toContain("missing-media");
  });

  it("reports nothing for a page whose links and media all resolve", () => {
    expect(auditPageLinks(pageWith([button(), image()]), "/", options)).toEqual([]);
  });
});

describe("summarise", () => {
  it("blocks publication on errors only", () => {
    const errors = summarise([{ code: "missing-alt", severity: "error", path: "/", detail: "" }]);
    expect(errors.readyToPublish).toBe(false);

    const softer = summarise([
      { code: "small-tap-target", severity: "warning", path: "/", detail: "" },
      { code: "alt-text-quality", severity: "manual-review", path: "/", detail: "" },
    ]);
    expect(softer.readyToPublish).toBe(true);
    expect(softer.warnings).toBe(1);
    expect(softer.manualReviews).toBe(1);
  });

  it("never claims compliance, only that no error remains", () => {
    const report = summarise([]);
    expect(report).not.toHaveProperty("compliant");
    expect(report.readyToPublish).toBe(true);
  });
});
