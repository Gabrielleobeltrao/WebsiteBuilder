import { createHash } from "node:crypto";

import sharp, { type Metadata } from "sharp";

/**
 * Backend image pipeline.
 *
 * Every accepted upload goes through here, and only WebP comes out. The frontend's declared MIME
 * type and filename extension are ignored entirely — the format is decided by sniffing the actual
 * bytes, because a claimed content type is attacker-controlled.
 */

export const TARGET_WIDTHS = [320, 768, 1440, 1920] as const;
export const DEFAULT_WEBP_QUALITY = 82;

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
/** Guards against decompression bombs: a small file that decodes to an enormous bitmap. */
export const MAX_PIXELS = 40_000_000;
export const MAX_DIMENSION = 10_000;

export type AcceptedFormat = "jpeg" | "png" | "webp";

export class UnsupportedImageError extends Error {
  constructor(public readonly reason: "format" | "animated" | "too-large" | "corrupt" | "dimensions") {
    super(`Unsupported image: ${reason}`);
    this.name = "UnsupportedImageError";
  }
}

export type ProcessedVariant = {
  width: number;
  height: number;
  bytes: number;
  mimeType: "image/webp";
  data: Buffer;
  contentHash: string;
};

export type ProcessedImage = {
  originalWidth: number;
  originalHeight: number;
  contentHash: string;
  variants: ProcessedVariant[];
};

/** Magic-byte sniffing. The declared content type is never trusted. */
export function sniffFormat(bytes: Buffer): AcceptedFormat | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }
  return null;
}

export function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Decodes, autorotates, strips metadata and produces responsive WebP variants.
 *
 * Autorotation happens before metadata is stripped, otherwise the EXIF orientation is discarded
 * while the pixels still need it and every photo from a phone comes out sideways. Variants are
 * never upscaled past the decoded source, because inventing pixels only costs bytes.
 */
export async function processImage(
  bytes: Buffer,
  options: { quality?: number; targetWidths?: readonly number[] } = {},
): Promise<ProcessedImage> {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UnsupportedImageError("too-large");

  const format = sniffFormat(bytes);
  if (format === null) throw new UnsupportedImageError("format");

  const pipeline = sharp(bytes, { limitInputPixels: MAX_PIXELS, animated: false });

  let metadata: Metadata;
  try {
    metadata = await pipeline.metadata();
  } catch {
    throw new UnsupportedImageError("corrupt");
  }

  // One frame of an animation is not the image the user uploaded; refusing is honest.
  if ((metadata.pages ?? 1) > 1) throw new UnsupportedImageError("animated");

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) throw new UnsupportedImageError("corrupt");
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) throw new UnsupportedImageError("dimensions");
  if (width * height > MAX_PIXELS) throw new UnsupportedImageError("too-large");

  const quality = options.quality ?? DEFAULT_WEBP_QUALITY;
  const requested = options.targetWidths ?? TARGET_WIDTHS;
  // Never upscale; always keep at least one variant even for a tiny source image.
  const widths = [...new Set(requested.filter((target) => target <= width))].sort((a, b) => a - b);
  if (widths.length === 0) widths.push(width);

  const variants: ProcessedVariant[] = [];
  for (const target of widths) {
    const output = await sharp(bytes, { limitInputPixels: MAX_PIXELS, animated: false })
      .rotate() // Applies EXIF orientation. Must run before metadata is dropped.
      .resize({ width: target, withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    variants.push({
      width: output.info.width,
      height: output.info.height,
      bytes: output.data.length,
      mimeType: "image/webp",
      data: output.data,
      contentHash: hashBytes(output.data),
    });
  }

  return {
    // Report the post-rotation dimensions, which is what the variants and the renderer use.
    originalWidth: metadata.autoOrient?.width ?? width,
    originalHeight: metadata.autoOrient?.height ?? height,
    contentHash: hashBytes(bytes),
    variants,
  };
}
