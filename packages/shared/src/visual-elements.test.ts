import { describe, expect, it } from "vitest";

import {
  accordionElementSchema,
  downloadButtonElementSchema,
  socialUrlMatchesNetwork,
  tableElementSchema,
  videoElementSchema,
  videoEmbedUrl,
  VIDEO_IFRAME_ALLOW,
  visualElementSchema,
} from "./visual-elements";

const base = {
  id: "e1",
  name: "Element",
  geometry: { x: 0, y: 0, width: 200, height: 100, rotation: 0 },
  responsiveLayout: {
    width: { value: 200, unit: "px" as const },
    height: { value: 100, unit: "px" as const },
    horizontalConstraint: "left" as const,
    verticalConstraint: "top" as const,
    visible: true,
  },
  zIndex: 1,
  locked: false,
  hidden: false,
};

describe("no arbitrary markup", () => {
  it("has no element type that accepts HTML, an iframe URL or a script", () => {
    // A builder that lets a designer paste a script tag ships stored XSS to every visitor of every
    // site it produces. The absence of such an element is the protection.
    const source = visualElementSchema.options.map((option) => JSON.stringify(Object.keys(option.shape))).join();

    for (const forbidden of ["html", "embedCode", "iframeUrl", "customCss", "script"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("refuses a video id that is not id-shaped", () => {
    const video = { ...base, type: "video", provider: "youtube", title: "" };

    expect(videoElementSchema.safeParse({ ...video, videoId: "abc123_-" }).success).toBe(true);
    for (const attempt of ["../evil", "a b", "<script>", "https://evil.test"]) {
      expect(videoElementSchema.safeParse({ ...video, videoId: attempt }).success).toBe(false);
    }
  });

  it("builds the embed URL rather than loading one from the document", () => {
    expect(videoEmbedUrl({ provider: "youtube", videoId: "abc123" })).toBe(
      "https://www.youtube-nocookie.com/embed/abc123",
    );
    expect(videoEmbedUrl({ provider: "vimeo", videoId: "987" })).toBe("https://player.vimeo.com/video/987");
  });

  it("uses the no-cookie host, because embedding a video is not asking to track visitors", () => {
    expect(videoEmbedUrl({ provider: "youtube", videoId: "abc" })).toContain("youtube-nocookie");
  });

  it("does not grant a player the camera or the microphone", () => {
    expect(VIDEO_IFRAME_ALLOW).not.toContain("camera");
    expect(VIDEO_IFRAME_ALLOW).not.toContain("microphone");
  });
});

describe("social links", () => {
  it("accepts a URL that belongs to the network it claims", () => {
    expect(socialUrlMatchesNetwork("instagram", "https://instagram.com/acme")).toBe(true);
    expect(socialUrlMatchesNetwork("instagram", "https://www.instagram.com/acme")).toBe(true);
    expect(socialUrlMatchesNetwork("x", "https://twitter.com/acme")).toBe(true);
  });

  it("refuses a URL that does not, which is the shape of a phishing link", () => {
    expect(socialUrlMatchesNetwork("instagram", "https://instagram.evil.test/acme")).toBe(false);
    expect(socialUrlMatchesNetwork("linkedin", "https://facebook.com/acme")).toBe(false);
  });

  it("refuses anything that is not https", () => {
    expect(socialUrlMatchesNetwork("github", "http://github.com/acme")).toBe(false);
    expect(socialUrlMatchesNetwork("github", "javascript:alert(1)")).toBe(false);
    expect(socialUrlMatchesNetwork("github", "not a url")).toBe(false);
  });
});

describe("bounds", () => {
  it("caps list-shaped content rather than accepting any length", () => {
    const accordion = { ...base, type: "accordion", allowMultiple: false };
    const items = Array.from({ length: 31 }, () => ({ question: "Q", answer: "A" }));

    expect(accordionElementSchema.safeParse({ ...accordion, items: items.slice(0, 30) }).success).toBe(true);
    expect(accordionElementSchema.safeParse({ ...accordion, items }).success).toBe(false);
  });

  it("carries whether a table has a header row, which decides if it can be navigated", () => {
    const table = {
      ...base,
      type: "table",
      headers: ["Plan", "Price"],
      rows: [["Basic", "10"]],
      hasHeaderRow: true,
      caption: "Plans",
    };

    expect(tableElementSchema.safeParse(table).success).toBe(true);
    expect(tableElementSchema.safeParse({ ...table, hasHeaderRow: undefined }).success).toBe(false);
  });

  it("rejects an unknown property instead of storing it", () => {
    const spacer = { ...base, type: "spacer", surprise: true };
    expect(visualElementSchema.safeParse(spacer).success).toBe(false);
  });
});

describe("the shared colour pair", () => {
  const button = (appearance?: unknown) => ({
    ...base,
    type: "downloadButton" as const,
    mediaId: "",
    label: "Baixar",
    ...(appearance === undefined ? {} : { appearance }),
  });

  it("is optional, so no stored document had to change to gain it", () => {
    expect(downloadButtonElementSchema.safeParse(button()).success).toBe(true);
    expect(downloadButtonElementSchema.safeParse(button({ backgroundColor: "#123456" })).success).toBe(true);
    expect(downloadButtonElementSchema.safeParse(button({})).success).toBe(true);
  });

  it("takes a colour and nothing else", () => {
    // What reaches a `style` attribute must not be able to carry anything but a colour.
    for (const value of ["red", "url(javascript:alert(1))", "#fff", "expression(1)", ""]) {
      expect(downloadButtonElementSchema.safeParse(button({ textColor: value })).success, value).toBe(false);
    }

    for (const value of ["#123456", "#12345678", "rgb(1, 2, 3)", "rgba(1, 2, 3, 0.5)"]) {
      expect(downloadButtonElementSchema.safeParse(button({ textColor: value })).success, value).toBe(true);
    }
  });

  it("refuses a property nobody declared", () => {
    expect(downloadButtonElementSchema.safeParse(button({ borderColor: "#123456" })).success).toBe(false);
  });
});
