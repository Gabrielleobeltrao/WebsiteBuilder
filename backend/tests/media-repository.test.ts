import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MediaRepository, sanitizeFilename } from "../src/modules/media/repository";
import { createGridFsStorage, type MediaStorage } from "../src/modules/media/storage";
import type { WorkspaceContext } from "../src/modules/projects/repository";
import { startTestDatabase, type TestDatabase } from "./mongo";

let database: TestDatabase;
let storage: MediaStorage;
let repository: MediaRepository;

const tenantA: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const tenantB: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };

const png = (width = 1600, height = 900) =>
  sharp({ create: { width, height, channels: 3, background: { r: 10, g: 90, b: 200 } } }).png().toBuffer();

beforeAll(async () => {
  database = await startTestDatabase();
  storage = createGridFsStorage(database.db);
  repository = new MediaRepository(database.db, storage);
}, 120_000);

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await database.clear();
});

describe("sanitizeFilename", () => {
  it("keeps only a safe subset and never a path", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\me\\photo.PNG")).toBe("photo.PNG");
    expect(sanitizeFilename("foto de férias.jpg")).toBe("foto-de-ferias.jpg");
    expect(sanitizeFilename('a"b<c>d|e.png')).toBe("a-b-c-d-e.png");
  });

  it("never returns an empty or dot-leading name", () => {
    expect(sanitizeFilename("")).toBe("image");
    expect(sanitizeFilename("...")).toBe("image");
    expect(sanitizeFilename(".hidden")).toBe("hidden");
  });
});

describe("upload", () => {
  it("stores only optimised WebP variants", async () => {
    const asset = await repository.upload(tenantA, { data: await png(), filename: "photo.png" });

    expect(asset.variants.length).toBeGreaterThan(0);
    expect(asset.variants.every((variant) => variant.mimeType === "image/webp")).toBe(true);
    expect(asset.workspaceId).toBe("workspace-a");
    expect(asset.uploadedByUserId).toBe("user-a");
  }, 30_000);

  it("records real dimensions and byte sizes for each variant", async () => {
    const asset = await repository.upload(tenantA, { data: await png(2000, 1000), filename: "wide.png" });

    for (const variant of asset.variants) {
      expect(variant.width).toBeGreaterThan(0);
      expect(variant.height).toBeGreaterThan(0);
      expect(variant.bytes).toBeGreaterThan(0);
      expect(await storage.exists(variant.storageKey)).toBe(true);
    }
  }, 30_000);

  it("rejects a file that is not a supported raster image", async () => {
    await expect(
      repository.upload(tenantA, { data: Buffer.from("<svg onload=alert(1)></svg>"), filename: "x.png" }),
    ).rejects.toMatchObject({ name: "UnsupportedImageError" });

    expect(await repository.list(tenantA)).toHaveLength(0);
  });

  it("leaves no orphaned bytes behind when storing a variant fails", async () => {
    const written: string[] = [];
    const deleted: string[] = [];
    let calls = 0;

    const flaky: MediaStorage = {
      put: async (input) => {
        calls += 1;
        if (calls === 2) throw new Error("storage unavailable");
        const stored = await storage.put(input);
        written.push(stored.storageKey);
        return stored;
      },
      openRead: storage.openRead,
      exists: storage.exists,
      delete: async (key) => {
        deleted.push(key);
        await storage.delete(key);
      },
    };

    const flakyRepository = new MediaRepository(database.db, flaky);
    await expect(
      flakyRepository.upload(tenantA, { data: await png(2000, 1200), filename: "photo.png" }),
    ).rejects.toThrow("storage unavailable");

    // No metadata record, and every byte already written was cleaned up.
    expect(await flakyRepository.list(tenantA)).toHaveLength(0);
    expect(deleted).toEqual(written);
    for (const key of written) expect(await storage.exists(key)).toBe(false);
  }, 30_000);
});

describe("tenant isolation", () => {
  it("does not list or read another workspace's media", async () => {
    const asset = await repository.upload(tenantA, { data: await png(), filename: "photo.png" });

    expect(await repository.list(tenantB)).toHaveLength(0);
    expect(await repository.findById(tenantB, asset.id)).toBeNull();
    expect(await repository.openVariant(tenantB, asset.id)).toBeNull();
  }, 30_000);

  it("does not delete across workspaces", async () => {
    const asset = await repository.upload(tenantA, { data: await png(), filename: "photo.png" });

    expect(await repository.delete(tenantB, asset.id)).toBe(false);
    expect(await repository.findById(tenantA, asset.id)).not.toBeNull();
  }, 30_000);

  it("treats a malformed id as not found", async () => {
    expect(await repository.findById(tenantA, "nope")).toBeNull();
    expect(await repository.delete(tenantA, "nope")).toBe(false);
  });
});

describe("openVariant", () => {
  it("returns the smallest variant that covers the requested width", async () => {
    const asset = await repository.upload(tenantA, { data: await png(2000, 1000), filename: "photo.png" });

    const small = await repository.openVariant(tenantA, asset.id, 320);
    expect(small?.variant.width).toBe(320);

    const medium = await repository.openVariant(tenantA, asset.id, 700);
    expect(medium?.variant.width).toBe(768);
  }, 30_000);

  it("falls back to the largest variant when nothing is wide enough", async () => {
    const asset = await repository.upload(tenantA, { data: await png(900, 600), filename: "photo.png" });
    const resolved = await repository.openVariant(tenantA, asset.id, 5000);
    expect(resolved?.variant.width).toBe(768);
  }, 30_000);
});

describe("delete", () => {
  it("removes the record and every stored variant", async () => {
    const asset = await repository.upload(tenantA, { data: await png(), filename: "photo.png" });
    const keys = asset.variants.map((variant) => variant.storageKey);

    expect(await repository.delete(tenantA, asset.id)).toBe(true);
    expect(await repository.findById(tenantA, asset.id)).toBeNull();
    for (const key of keys) expect(await storage.exists(key)).toBe(false);
  }, 30_000);
});
