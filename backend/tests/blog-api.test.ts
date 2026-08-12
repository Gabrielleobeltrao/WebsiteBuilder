import { DEFAULT_BLOG_SETTINGS, EMPTY_RICH_TEXT } from "@websitebuilder/shared";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { createSeededWorkspaceResolver } from "../src/middleware/workspace";
import { BlogRepository, ensureBlogIndexes } from "../src/modules/blog/repository";
import { createBlogRouter, createPublicBlogRouter } from "../src/modules/blog/routes";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

const WORKSPACE = "workspace-a";
const OTHER = "workspace-b";
const PROJECT = "aaaaaaaaaaaaaaaaaaaaaaaa";
const base = `/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT}/blog`;
const publicBase = `/api/v1/public/projects/${PROJECT}/blog`;

let database: TestDatabase;
let app: Express;

const post = (overrides: Record<string, unknown> = {}) => ({
  title: "First post",
  slug: "",
  excerpt: "",
  content: EMPTY_RICH_TEXT,
  categoryIds: [],
  tags: [],
  customFieldValues: {},
  status: "draft",
  ...overrides,
});

beforeAll(async () => {
  database = await startTestDatabase();
  await ensureBlogIndexes(database.db);
  const repository = new BlogRepository(database.db);

  app = createApp({
    env: testEnv(),
    logger: testLogger(),
    routers: [
      {
        path: "/workspaces/:workspaceId/projects/:projectId/blog",
        router: createBlogRouter({
          repository,
          resolveWorkspace: createSeededWorkspaceResolver({ workspaceId: WORKSPACE, userId: "user-a" }),
        }),
      },
      { path: "/public/projects/:projectId/blog", router: createPublicBlogRouter({ repository }) },
    ],
  });
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensureBlogIndexes(database.db);
});

describe("settings", () => {
  it("returns disabled defaults before the blog is enabled", async () => {
    const response = await request(app).get(`${base}/settings`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(DEFAULT_BLOG_SETTINGS);
  });

  it("enables the blog without publishing anything", async () => {
    const response = await request(app)
      .put(`${base}/settings`)
      .send({ ...DEFAULT_BLOG_SETTINGS, enabled: true });

    expect(response.status).toBe(200);
    expect(response.body.data.enabled).toBe(true);
    expect((await request(app).get(`${publicBase}/posts`)).body.data.total).toBe(0);
  });

  it("rejects an invalid base path", async () => {
    const response = await request(app)
      .put(`${base}/settings`)
      .send({ ...DEFAULT_BLOG_SETTINGS, basePath: "Blog Posts" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("posts", () => {
  it("creates a draft and returns 201", async () => {
    const response = await request(app).post(`${base}/posts`).send(post());
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe("draft");
    expect(response.body.data.slug).toBe("first-post");
  });

  it("rejects rich content that is not a validated document", async () => {
    const response = await request(app)
      .post(`${base}/posts`)
      .send(post({ content: { type: "doc", content: [{ type: "script" }] } }));
    expect(response.status).toBe(400);
  });

  it("rejects raw HTML as content", async () => {
    const response = await request(app).post(`${base}/posts`).send(post({ content: "<script>alert(1)</script>" }));
    expect(response.status).toBe(400);
  });

  it("publishes and unpublishes", async () => {
    const created = await request(app).post(`${base}/posts`).send(post());
    const id = created.body.data.id;

    const published = await request(app).post(`${base}/posts/${id}/publish`);
    expect(published.body.data.status).toBe("published");
    expect(published.body.data.publishedAt).toBeDefined();

    const unpublished = await request(app).post(`${base}/posts/${id}/unpublish`);
    expect(unpublished.body.data.status).toBe("draft");
  });

  it("answers an unknown or malformed post id with 404", async () => {
    expect((await request(app).get(`${base}/posts/aaaaaaaaaaaaaaaaaaaaaaaa`)).status).toBe(404);
    expect((await request(app).get(`${base}/posts/nope`)).status).toBe(404);
  });

  it("deletes once and then answers 404", async () => {
    const created = await request(app).post(`${base}/posts`).send(post());
    expect((await request(app).delete(`${base}/posts/${created.body.data.id}`)).status).toBe(204);
    expect((await request(app).delete(`${base}/posts/${created.body.data.id}`)).status).toBe(404);
  });
});

describe("public reads", () => {
  it("never returns a draft", async () => {
    const created = await request(app).post(`${base}/posts`).send(post({ title: "Secret" }));
    const slug = created.body.data.slug;

    expect((await request(app).get(`${publicBase}/posts/${slug}`)).status).toBe(404);
    expect((await request(app).get(`${publicBase}/posts`)).body.data.total).toBe(0);

    await request(app).post(`${base}/posts/${created.body.data.id}/publish`);
    expect((await request(app).get(`${publicBase}/posts/${slug}`)).status).toBe(200);
  });

  it("does not expose ownership fields to a public reader", async () => {
    const created = await request(app).post(`${base}/posts`).send(post({ status: "published" }));
    const response = await request(app).get(`${publicBase}/posts/${created.body.data.slug}`);

    expect(response.body.data.workspaceId).toBeUndefined();
    expect(response.body.data.createdByUserId).toBeUndefined();
    expect(response.body.data.title).toBe("First post");
  });

  it("paginates the public feed", async () => {
    for (let index = 0; index < 5; index += 1) {
      await request(app).post(`${base}/posts`).send(post({ title: `Post ${index}`, status: "published" }));
    }
    const response = await request(app).get(`${publicBase}/posts?perPage=2&page=2`);
    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.total).toBe(5);
  });
});

describe("workspace scoping", () => {
  it("refuses blog routes addressed to another workspace", async () => {
    const otherBase = `/api/v1/workspaces/${OTHER}/projects/${PROJECT}/blog`;
    expect((await request(app).get(`${otherBase}/settings`)).status).toBe(403);
    expect((await request(app).get(`${otherBase}/posts`)).status).toBe(403);
    expect((await request(app).post(`${otherBase}/posts`).send(post())).status).toBe(403);
  });
});
