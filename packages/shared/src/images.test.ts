import { describe, expect, it } from "vitest";

import {
  aspectRatioOf,
  buildSizes,
  buildSrcSet,
  DEFAULT_FOCAL_POINT,
  resolveArtDirectedMedia,
  serializeFocalPoint,
} from "./images";

const VARIANTS = [
  { width: 1440, height: 960 },
  { width: 320, height: 213 },
  { width: 768, height: 512 },
  { width: 1920, height: 1280 },
];

describe("srcset", () => {
  it("offers every variant, narrowest first, with its real width", () => {
    const srcset = buildSrcSet(VARIANTS, (width) => `/media/a/${width}.webp`);

    expect(srcset).toBe(
      "/media/a/320.webp 320w, /media/a/768.webp 768w, /media/a/1440.webp 1440w, /media/a/1920.webp 1920w",
    );
  });

  it("drops a variant that cannot be resolved", () => {
    // An entry the browser cannot fetch is worse than an absent one: it may pick it and render
    // nothing at all.
    const srcset = buildSrcSet(VARIANTS, (width) => (width === 768 ? null : `/media/a/${width}.webp`));

    expect(srcset).not.toContain("768w");
    expect(srcset).toContain("320w");
  });

  it("collapses duplicate widths", () => {
    const srcset = buildSrcSet([{ width: 320, height: 200 }, { width: 320, height: 200 }], () => "/a.webp");
    expect(srcset).toBe("/a.webp 320w");
  });

  it("returns an empty string when nothing resolves, so no srcset attribute is emitted", () => {
    expect(buildSrcSet(VARIANTS, () => null)).toBe("");
    expect(buildSrcSet([], () => "/a.webp")).toBe("");
  });
});

describe("sizes", () => {
  it("emits narrowest condition first, which is the order the browser evaluates", () => {
    const sizes = buildSizes(
      [
        { maxWidth: 1024, value: "50vw" },
        { maxWidth: 640, value: "100vw" },
      ],
      "33vw",
    );

    expect(sizes).toBe("(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw");
  });

  it("always ends with a fallback, since a sizes list without one is ignored", () => {
    expect(buildSizes([], "100vw")).toBe("100vw");
  });
});

describe("art direction", () => {
  const sources = [
    { maxWidth: 640, mediaId: "mobile-crop" },
    { maxWidth: 1024, mediaId: "tablet-crop" },
  ];

  it("uses the narrowest matching override", () => {
    expect(resolveArtDirectedMedia("desktop", sources, 390)).toBe("mobile-crop");
    expect(resolveArtDirectedMedia("desktop", sources, 640)).toBe("mobile-crop");
  });

  it("does not let a mobile crop leak into wider screens", () => {
    expect(resolveArtDirectedMedia("desktop", sources, 641)).toBe("tablet-crop");
    expect(resolveArtDirectedMedia("desktop", sources, 1440)).toBe("desktop");
  });

  it("falls back to the default when nothing is overridden", () => {
    expect(resolveArtDirectedMedia("desktop", [], 320)).toBe("desktop");
  });
});

describe("focal point", () => {
  it("centres by default", () => {
    expect(serializeFocalPoint(undefined)).toBe("50% 50%");
    expect(serializeFocalPoint(DEFAULT_FOCAL_POINT)).toBe("50% 50%");
  });

  it("keeps the chosen subject in frame when a crop cuts the rest", () => {
    expect(serializeFocalPoint({ x: 0.25, y: 0.8 })).toBe("25% 80%");
  });
});

describe("aspect ratio", () => {
  it("reserves space from the intrinsic size", () => {
    expect(aspectRatioOf({ width: 1920, height: 1080 })).toBe("1920 / 1080");
  });

  it("returns null rather than emitting invalid CSS", () => {
    // `x / 0` would invalidate the whole declaration block, not just this property.
    expect(aspectRatioOf({ width: 100, height: 0 })).toBeNull();
    expect(aspectRatioOf(undefined)).toBeNull();
  });
});
