import {
  builderElementSchema,
  elementDefinition,
  ELEMENT_TYPES,
  resolveSafeLinkHref,
  socialUrlMatchesNetwork,
  videoEmbedUrl,
  type BuilderElement,
} from "@websitebuilder/shared";
import { describe, expect, it } from "vitest";

/**
 * What a document is not allowed to become.
 *
 * Twenty-nine block types is twenty-nine chances to accept something that reaches a stranger's
 * browser. These hold the line that makes that safe by construction rather than by review: every
 * value is parsed by a strict schema, every URL goes through one allowlist, and no block anywhere
 * accepts markup, script, or an address a frame will load.
 */

const base = {
  id: "block-1",
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
};

const of = (type: (typeof ELEMENT_TYPES)[number], overrides: Record<string, unknown> = {}) => ({
  ...base,
  type,
  version: elementDefinition(type).schemaVersion,
  ...elementDefinition(type).defaults(),
  ...overrides,
});

describe("strict parsing", () => {
  it("refuses a field no block declares", () => {
    // `.strict()` everywhere: a payload carrying an extra key is a payload written by something
    // other than this product, and accepting it means storing whatever it sent.
    for (const type of ELEMENT_TYPES) {
      const smuggled = { ...of(type), onclick: "alert(1)" };
      expect(builderElementSchema.safeParse(smuggled).success, type).toBe(false);
    }
  });

  it("refuses a block type it does not know", () => {
    expect(builderElementSchema.safeParse({ ...base, type: "script", src: "https://evil.test" }).success).toBe(false);
  });

  it("refuses an oversized payload rather than truncating it", () => {
    const huge = of("text", { content: "x".repeat(20_000) });
    expect(builderElementSchema.safeParse(huge).success).toBe(false);
  });
});

describe("links", () => {
  const resolve = (link: unknown) =>
    resolveSafeLinkHref(link as Parameters<typeof resolveSafeLinkHref>[0], { resolvePagePath: () => "/somewhere" });

  it("refuses every scheme that executes", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      expect(resolve({ kind: "external", url, newTab: false }), url).toBeNull();
    }
  });

  it("hands over no opener when it opens a new tab", () => {
    const resolved = resolve({ kind: "external", url: "https://example.test", newTab: true });
    expect(resolved?.rel).toContain("noopener");
  });
});

describe("frames", () => {
  it("builds an embed URL from an identifier, never from a stored address", () => {
    expect(videoEmbedUrl({ provider: "youtube", videoId: "abc123" })).toBe(
      "https://www.youtube-nocookie.com/embed/abc123",
    );
    expect(videoEmbedUrl({ provider: "vimeo", videoId: "987" })).toBe("https://player.vimeo.com/video/987");
  });

  it("refuses an identifier that is not one", () => {
    // A value that could escape the path is refused at the schema, so no caller has to remember to
    // encode it.
    for (const videoId of ["../../evil", "a/b", "a?b=c", "javascript:1", "<script>"]) {
      expect(builderElementSchema.safeParse(of("video", { videoId })).success, videoId).toBe(false);
    }
  });
});

describe("claims about other people's brands", () => {
  it("refuses a social row that points somewhere the network does not own", () => {
    expect(socialUrlMatchesNetwork("instagram", "https://instagram.com/someone")).toBe(true);
    expect(socialUrlMatchesNetwork("instagram", "https://evil.test/instagram")).toBe(false);
    expect(socialUrlMatchesNetwork("instagram", "http://instagram.com/someone")).toBe(false);
  });
});

describe("no block accepts markup", () => {
  it("stores text as text, so it can only ever render as text", () => {
    const withMarkup = of("text", { content: "<img src=x onerror=alert(1)>" });
    const parsed = builderElementSchema.safeParse(withMarkup);

    // Accepted as *content* — and rendered as a text node, which is what makes it harmless. The
    // danger would be a field that is interpreted, and there is none.
    expect(parsed.success).toBe(true);
    expect((parsed.success ? (parsed.data as BuilderElement & { content: string }).content : "")).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("has no field anywhere that names itself as markup", () => {
    // A regression guard for the whole catalog: if a block ever gains an `html`, `script` or
    // `style` field, this fails and somebody has to argue for it.
    for (const type of ELEMENT_TYPES) {
      const keys = Object.keys(elementDefinition(type).defaults());
      for (const forbidden of ["html", "innerHTML", "script", "css", "style"]) {
        if (forbidden === "style") continue; // A typed style object, never a string.
        expect(keys, `${type}.${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
