import type { Express } from "express";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { createSeededWorkspaceResolver } from "../src/middleware/workspace";
import { MediaRepository } from "../src/modules/media/repository";
import { createMediaRouter } from "../src/modules/media/routes";
import { createGridFsStorage } from "../src/modules/media/storage";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

const WORKSPACE = "workspace-a";
const OTHER = "workspace-b";
const base = `/api/v1/workspaces/${WORKSPACE}/media`;

let database: TestDatabase;
let app: Express;

const png = (width = 1600, height = 900) =>
  sharp({ create: { width, height, channels: 3, background: { r: 10, g: 90, b: 200 } } }).png().toBuffer();

beforeAll(async () => {
  database = await startTestDatabase();
  const repository = new MediaRepository(database.db, createGridFsStorage(database.db));
  app = createApp({
    env: testEnv(),
    logger: testLogger(),
    routers: [
      {
        path: "/workspaces/:workspaceId/media",
        router: createMediaRouter({
          repository,
          resolveWorkspace: createSeededWorkspaceResolver({ workspaceId: WORKSPACE, userId: "user-a" }),
        }),
      },
    ],
  });
}, 120_000);

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await database.clear();
});

async function upload(filename = "photo.png", bytes?: Buffer) {
  const response = await request(app)
    .post(base)
    .set("content-type", "application/octet-stream")
    .set("x-filename", filename)
    .send(bytes ?? (await png()));
  return response;
}

describe("POST /media", () => {
  it("accepts an image and returns WebP variants", async () => {
    const response = await upload();
    expect(response.status).toBe(201);
    expect(response.body.data.variants.every((v: { mimeType: string }) => v.mimeType === "image/webp")).toBe(true);
  }, 30_000);

  it("rejects a file that is not a supported image", async () => {
    const response = await upload("evil.png", Buffer.from("<svg onload=alert(1)></svg>"));
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("ignores the declared content type and trusts the bytes", async () => {
    const response = await request(app)
      .post(base)
      .set("content-type", "image/png")
      .set("x-filename", "lying.png")
      .send(Buffer.from("not an image at all, just text"));
    expect(response.status).toBe(415);
  });

  it("rejects an empty body with a validation error", async () => {
    const response = await request(app).post(base).set("content-type", "application/octet-stream").send(Buffer.alloc(0));
    expect(response.status).toBe(400);
  });

  it("sanitises the filename it was given", async () => {
    const response = await upload("../../etc/passwd.png");
    expect(response.body.data.originalFilename).toBe("passwd.png");
  }, 30_000);
});

describe("GET /media/:id/content", () => {
  it("streams the variant with an image content type and nosniff", async () => {
    const created = await upload();
    const response = await request(app).get(`${base}/${created.body.data.id}/content`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/webp");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-disposition"]).toBe("inline");
  }, 30_000);

  it("serves the variant matching a requested width", async () => {
    const created = await upload("wide.png", await png(2000, 1000));
    const response = await request(app).get(`${base}/${created.body.data.id}/content?w=320`);
    const smallest = created.body.data.variants[0] as { bytes: number };

    expect(response.status).toBe(200);
    expect(Number(response.headers["content-length"])).toBe(smallest.bytes);
  }, 30_000);

  it("answers an unknown id with 404", async () => {
    expect((await request(app).get(`${base}/aaaaaaaaaaaaaaaaaaaaaaaa/content`)).status).toBe(404);
    expect((await request(app).get(`${base}/not-an-id/content`)).status).toBe(404);
  });
});

describe("workspace scoping", () => {
  it("refuses list, upload, stream and delete for another workspace", async () => {
    const created = await upload();
    const otherBase = `/api/v1/workspaces/${OTHER}/media`;

    expect((await request(app).get(otherBase)).status).toBe(403);
    expect((await request(app).get(`${otherBase}/${created.body.data.id}/content`)).status).toBe(403);
    expect((await request(app).delete(`${otherBase}/${created.body.data.id}`)).status).toBe(403);
  }, 30_000);
});

describe("DELETE /media/:id", () => {
  it("deletes once and then answers 404", async () => {
    const created = await upload();
    expect((await request(app).delete(`${base}/${created.body.data.id}`)).status).toBe(204);
    expect((await request(app).delete(`${base}/${created.body.data.id}`)).status).toBe(404);
  }, 30_000);
});
