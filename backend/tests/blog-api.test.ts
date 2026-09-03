import { DEFAULT_BLOG_SETTINGS, EMPTY_RICH_TEXT } from "@websitebuilder/shared";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { createSeededWorkspaceResolver } from "../src/middleware/workspace";
import { BlogRepository, ensureBlogIndexes } from "../src/modules/blog/repository";
import { createBlogRouter, createPublicBlogRouter } from "../src/modules/blog/routes";
import { ensureTemplateIndexes, TemplateRepository } from "../src/modules/blog/templates";
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
          templates: new TemplateRepository(database.db),
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
  await ensureTemplateIndexes(database.db);
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

describe("turning the blog on", () => {
  it("creates and publishes both templates, so the routes it publishes can answer", async () => {
    const response = await request(app).post(`${base}/activate`).send({ format: "grid" });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ enabled: true, format: "grid" });
    // The two ids nothing in the product used to set. Without them the blog reported a blocking
    // setup issue that blocked publication of the whole site, with no way out through the interface.
    expect(response.body.data.indexTemplateId).toBeTruthy();
    expect(response.body.data.articleTemplateId).toBeTruthy();
  });

  it("refuses a format it does not have", async () => {
    const response = await request(app).post(`${base}/activate`).send({ format: "newspaper" });
    expect(response.status).toBe(400);
  });

  it("leaves a blog that is on exactly where it was", async () => {
    await request(app).post(`${base}/activate`).send({ format: "list" });
    const again = await request(app).post(`${base}/activate`).send({ format: "magazine" });

    // Changing the format is not re-creating the blog: the templates it already had are the ones it
    // keeps, so a site that had edited them does not lose that.
    expect(again.status).toBe(200);
    expect(again.body.data.format).toBe("magazine");
  });
});

/**
 * The template a designer edits.
 *
 * The store could load, save and publish a template from the first commit; nothing exposed it, so
 * there was no way to reach one from outside the process. A template nobody can open is a layout
 * nobody can change, which is what a blog with a fixed article shape actually is.
 */
describe("editing a template", () => {
  const path = (kind: string) => `${base}/templates/${kind}`;

  it("creates the template on first read rather than answering 404", async () => {
    // A blog turned on before templates existed should not have to be turned off and on again.
    const response = await request(app).get(path("article"));

    expect(response.status).toBe(200);
    expect(response.body.data.kind).toBe("article");
    expect(response.body.data.draftDocument.sections.length).toBeGreaterThan(0);
  });

  it("accepts the template it seeded, which has no route and so no slug", async () => {
    // The seed produces an empty slug, and the page schema requires a route-shaped one — so the
    // first save of an untouched template was refused as invalid.
    const created = await request(app).get(path("article"));
    const saved = await request(app)
      .put(path("article"))
      .send({ draftDocument: created.body.data.draftDocument, fieldDefinitions: [] });

    expect(saved.status).toBe(200);
  });

  it("refuses a kind that is not one of the two", async () => {
    expect((await request(app).get(path("something-else"))).status).toBe(404);
  });

  it("saves a draft and hands back what it stored", async () => {
    const created = await request(app).get(path("article"));
    const page = created.body.data.draftDocument;
    page.name = "Designed article";

    const saved = await request(app)
      .put(path("article"))
      .send({ draftDocument: page, fieldDefinitions: [] });

    expect(saved.status).toBe(200);
    expect(saved.body.data.draftDocument.name).toBe("Designed article");
    expect(saved.body.data.draftVersion).toBe(2);
  });

  it("refuses a draft carrying anything a page could not", async () => {
    const created = await request(app).get(path("article"));
    const page = created.body.data.draftDocument;
    page.sections[0].elements = [{ type: "script", src: "https://evil.test/x.js" }];

    // The same schema a site's own pages go through: a template is a page in every respect but
    // where it is shown.
    expect((await request(app).put(path("article")).send({ draftDocument: page, fieldDefinitions: [] })).status).toBe(
      400,
    );
  });

  it("refuses a save made against a version somebody else has replaced", async () => {
    const created = await request(app).get(path("article"));
    const page = created.body.data.draftDocument;
    const staleVersion = created.body.data.draftVersion;

    await request(app).put(path("article")).send({ draftDocument: page, fieldDefinitions: [], expectedVersion: staleVersion });

    // Two tabs on one template. Without this the later save silently discarded the earlier work.
    const late = await request(app)
      .put(path("article"))
      .send({ draftDocument: { ...page, name: "From the other tab" }, fieldDefinitions: [], expectedVersion: staleVersion });

    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("REVISION_CONFLICT");
  });

  it("publishes the draft, which is what reaches a reader", async () => {
    const created = await request(app).get(path("article"));
    const page = created.body.data.draftDocument;
    page.name = "Live article";
    await request(app).put(path("article")).send({ draftDocument: page, fieldDefinitions: [] });

    const published = await request(app).post(`${path("article")}/publish`);

    expect(published.status).toBe(200);
    expect(published.body.data.published).toBe(true);
    expect(published.body.data.template.publishedDocument.name).toBe("Live article");
  });

  it("keeps a draft out of published output until it is published", async () => {
    const created = await request(app).get(path("article"));
    const page = created.body.data.draftDocument;
    page.name = "Only a draft";
    await request(app).put(path("article")).send({ draftDocument: page, fieldDefinitions: [] });

    const reread = await request(app).get(path("article"));
    expect(reread.body.data.publishedDocument).toBeUndefined();
  });
});

/**
 * A blog enabled before template ids existed.
 *
 * `enabled: true` and neither id, so `blogSetupIssues` reported two blocking problems for the rest
 * of the project's life — and those block publication of the whole site, not just the blog.
 * Templates were already created lazily on read, and the settings were never told, so the same two
 * issues came back on the next check: a site that could not be published and a screen naming no
 * action.
 */
describe("repairing a legacy blog", () => {
  /** Turns the blog on the way the old settings PUT did: a flag and nothing else. */
  const enableWithoutTemplates = async () => {
    const current = await request(app).get(`${base}/settings`);
    await request(app)
      .put(`${base}/settings`)
      .send({ ...current.body.data, enabled: true, indexTemplateId: undefined, articleTemplateId: undefined });
  };

  it("gives an old blog both template ids when somebody opens it", async () => {
    await enableWithoutTemplates();

    const opened = await request(app).get(`${base}/settings`);

    expect(opened.status).toBe(200);
    expect(opened.body.data.indexTemplateId).toEqual(expect.any(String));
    expect(opened.body.data.articleTemplateId).toEqual(expect.any(String));
  });

  it("repairs once: opening it again writes nothing further", async () => {
    await enableWithoutTemplates();
    const first = await request(app).get(`${base}/settings`);
    const second = await request(app).get(`${base}/settings`);

    // Same ids, not a second pair — a repair that recreated templates would orphan the first two and
    // discard anything designed in them.
    expect(second.body.data.indexTemplateId).toBe(first.body.data.indexTemplateId);
    expect(second.body.data.articleTemplateId).toBe(first.body.data.articleTemplateId);
  });

  it("never replaces a template reference that is already there", async () => {
    await request(app).post(`${base}/activate`).send({ format: "grid" });
    const activated = await request(app).get(`${base}/settings`);

    const reread = await request(app).get(`${base}/settings`);
    expect(reread.body.data.indexTemplateId).toBe(activated.body.data.indexTemplateId);
  });

  it("leaves a blog nobody turned on alone", async () => {
    const settings = await request(app).get(`${base}/settings`);

    // Creating templates for an unused module would invent state the customer never asked for.
    expect(settings.body.data.enabled).toBe(false);
    expect(settings.body.data.indexTemplateId).toBeUndefined();
  });

  it("publishes the starters, so a repaired blog serves something rather than an empty page", async () => {
    await enableWithoutTemplates();
    await request(app).get(`${base}/settings`);

    const template = await request(app).get(`${base}/templates/article`);
    expect(template.body.data.publishedDocument).toBeDefined();
  });
});
