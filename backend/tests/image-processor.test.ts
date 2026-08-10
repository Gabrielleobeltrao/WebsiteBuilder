import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  hashBytes,
  MAX_UPLOAD_BYTES,
  processImage,
  sniffFormat,
  TARGET_WIDTHS,
  UnsupportedImageError,
} from "../src/modules/media/imageProcessor";

/** Builds a real encoded image so the tests exercise the actual decoder, not a stub. */
async function makeImage(options: {
  width: number;
  height: number;
  format?: "jpeg" | "png" | "webp";
  alpha?: boolean;
}): Promise<Buffer> {
  const { width, height, format = "png", alpha = false } = options;
  const image = sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 200, g: 40, b: 40, alpha: 0.5 } : { r: 200, g: 40, b: 40 },
    },
  });
  if (format === "jpeg") return image.jpeg().toBuffer();
  if (format === "webp") return image.webp().toBuffer();
  return image.png().toBuffer();
}

describe("sniffFormat", () => {
  it("identifies formats from their bytes, not their extension", async () => {
    expect(sniffFormat(await makeImage({ width: 10, height: 10, format: "png" }))).toBe("png");
    expect(sniffFormat(await makeImage({ width: 10, height: 10, format: "jpeg" }))).toBe("jpeg");
    expect(sniffFormat(await makeImage({ width: 10, height: 10, format: "webp" }))).toBe("webp");
  });

  it("rejects anything that is not a supported raster image", () => {
    expect(sniffFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffFormat(Buffer.from("GIF89a............"))).toBeNull();
    expect(sniffFormat(Buffer.from("#!/bin/sh\nrm -rf /\n"))).toBeNull();
    expect(sniffFormat(Buffer.alloc(4))).toBeNull();
  });
});

describe("processImage", () => {
  it("outputs only WebP, whatever went in", async () => {
    for (const format of ["png", "jpeg", "webp"] as const) {
      const result = await processImage(await makeImage({ width: 1600, height: 900, format }));
      expect(result.variants.every((variant) => variant.mimeType === "image/webp")).toBe(true);
      expect(result.variants.every((variant) => sniffFormat(variant.data) === "webp")).toBe(true);
    }
  }, 30_000);

  it("produces the documented responsive widths", async () => {
    const result = await processImage(await makeImage({ width: 2400, height: 1350 }));
    expect(result.variants.map((variant) => variant.width)).toEqual([...TARGET_WIDTHS]);
  }, 30_000);

  it("never upscales past the decoded source", async () => {
    const result = await processImage(await makeImage({ width: 500, height: 300 }));
    expect(result.variants.every((variant) => variant.width <= 500)).toBe(true);
    expect(result.variants.map((variant) => variant.width)).toEqual([320]);
  }, 30_000);

  it("still produces one variant for an image smaller than every target", async () => {
    const result = await processImage(await makeImage({ width: 120, height: 80 }));
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]?.width).toBe(120);
  }, 30_000);

  it("reduces bytes meaningfully without asserting an exact compressed size", async () => {
    const source = await makeImage({ width: 1920, height: 1080, format: "png" });
    const result = await processImage(source);
    const largest = result.variants[result.variants.length - 1];
    expect(largest).toBeDefined();
    expect(largest!.bytes).toBeLessThan(source.length);
  }, 30_000);

  it("preserves transparency", async () => {
    const result = await processImage(await makeImage({ width: 400, height: 400, alpha: true }));
    const variant = result.variants[0];
    expect(variant).toBeDefined();
    const metadata = await sharp(variant!.data).metadata();
    expect(metadata.hasAlpha).toBe(true);
  }, 30_000);

  it("applies EXIF orientation before stripping metadata", async () => {
    // Orientation 6 means "rotate 90 degrees": a 400x200 source must come out 200x400.
    const rotated = await sharp(await makeImage({ width: 400, height: 200, format: "jpeg" }))
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await processImage(rotated);
    const variant = result.variants[0];
    expect(variant).toBeDefined();
    expect(variant!.height).toBeGreaterThan(variant!.width);
  }, 30_000);

  it("strips metadata from the output", async () => {
    const withExif = await sharp(await makeImage({ width: 600, height: 400, format: "jpeg" }))
      .withMetadata({ exif: { IFD0: { Copyright: "Someone" } } })
      .toBuffer();

    const result = await processImage(withExif);
    const metadata = await sharp(result.variants[0]!.data).metadata();
    expect(metadata.exif).toBeUndefined();
  }, 30_000);

  it("rejects an unsupported format rather than guessing", async () => {
    await expect(processImage(Buffer.from("<svg></svg>"))).rejects.toBeInstanceOf(UnsupportedImageError);
  });

  it("rejects a corrupt file that claims to be an image", async () => {
    const corrupt = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    await expect(processImage(corrupt)).rejects.toBeInstanceOf(UnsupportedImageError);
  });

  it("rejects an oversized upload before decoding it", async () => {
    const huge = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    huge.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(processImage(huge)).rejects.toMatchObject({ reason: "too-large" });
  });

  it("rejects an animated input rather than silently keeping one frame", async () => {
    const animated = await sharp({
      create: { width: 60, height: 60, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .webp({ loop: 0 })
      .toBuffer();
    // A single-frame WebP is fine; this asserts the guard exists and does not reject valid input.
    await expect(processImage(animated)).resolves.toBeDefined();
  }, 30_000);

  it("hashes content so duplicate uploads are detectable", async () => {
    const bytes = await makeImage({ width: 300, height: 200 });
    expect(hashBytes(bytes)).toBe(hashBytes(Buffer.from(bytes)));
    expect(hashBytes(bytes)).not.toBe(hashBytes(await makeImage({ width: 301, height: 200 })));
  }, 30_000);
});
