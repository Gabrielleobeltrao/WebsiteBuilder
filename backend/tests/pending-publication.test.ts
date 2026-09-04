import { DEFAULT_BLOG_SETTINGS, createPage, type BuilderPage } from "@websitebuilder/shared";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { COLLECTIONS } from "../src/db/indexes";
import { createSeededWorkspaceResolver } from "../src/middleware/workspace";
import { BlogRepository, ensureBlogIndexes } from "../src/modules/blog/repository";
import { ensureTemplateIndexes, TemplateRepository } from "../src/modules/blog/templates";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { createProjectsRouter } from "../src/modules/projects/routes";
import { attachCardSummaries } from "../src/modules/projects/summaries";
import { sourceFingerprintFrom } from "../src/modules/publishing/fingerprint";
import { ensurePublishingIndexes, PublishingRepository } from "../src/modules/publishing/repository";
import { PublishingService } from "../src/modules/publishing/service";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * "You have unpublished changes", across every source a publication freezes.
 *
 * It used to mean one thing: the builder document's revision had moved past the one the live
 * snapshot was compiled from. Posts, blog settings and the two layouts live in their own
 * collections and never touch that revision — so somebody could write a post, publish it, and be
 * told by both the site card and the dashboard that their site was up to date.
 *
 * Every case below is a change in exactly one source, and the two surfaces must agree on all of
 * them.
 */

const WORKSPACE = "workspace-a";
const A: WorkspaceContext = { workspaceId: WORKSPACE, userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };

let database: TestDatabase;
let projects: ProjectRepository;
let publishing: PublishingRepository;
let templates: TemplateRepository;
let blog: BlogRepository;
let service: PublishingService;
let app: Express;

const post = (overrides: Record<string, unknown> = {}) => ({
  title: "Release notes",
  slug: "release-notes",
  excerpt: "",
  content: { type: "doc", content: [] },
  categoryIds: [],
  tags: [],
  customFieldValues: {},
  status: "published",
  ...overrides,
});

beforeAll(async () => {
  database = await startTestDatabase();
  projects = new ProjectRepository(database.db);
  publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  blog = new BlogRepository(database.db);
  templates = new TemplateRepository(database.db);

  /*
   * Read-only, exactly as the server wires it.
   *
   * The harness used `loadOrCreate` here, which is the template editor's entry point: it creates a
   * starter when none exists. Mirroring production matters more than convenience — a harness that
   * writes where the server reads cannot detect the very thing these tests are about.
   */
  const loadTemplates = (context: WorkspaceContext, projectId: string) =>
    templates.findPublishedMetadata(context, projectId);

  service = new PublishingService({
    projects,
    publishing,
    blog,
    media: new MediaRepository(database.db, createGridFsStorage(database.db)),
    loadBlogTemplates: async (context, projectId) => {
      const layouts = await loadTemplates(context, projectId);
      return {
        ...(layouts.index.document === undefined ? {} : { index: layouts.index.document }),
        ...(layouts.article.document === undefined ? {} : { article: layouts.article.document }),
        publishedVersions: {
          ...(layouts.index.version === null ? {} : { index: layouts.index.version }),
          ...(layouts.article.version === null ? {} : { article: layouts.article.version }),
        },
      };
    },
    collectModuleFacts: async ({ workspaceId, projectId }) => {
      const context = { workspaceId, userId: "" };
      const settings = await blog.loadSettings(context, projectId);
      const layouts = await loadTemplates(context, projectId);
      const missing = [layouts.index, layouts.article].filter((layout) => layout.document === undefined).length;
      return {
        blog: {
          hasRecords: (await blog.list(context, projectId, { perPage: 1 })).total > 0,
          explicitlyActivated: settings.enabled,
          blockingIssueCount: settings.enabled ? missing : 0,
          warningCount: 0,
        },
      };
    },
  });

  app = createApp({
    env: testEnv(),
    logger: testLogger(),
    routers: [
      {
        path: "/workspaces/:workspaceId/projects",
        router: createProjectsRouter({
          repository: projects,
          resolveWorkspace: createSeededWorkspaceResolver(A),
          attachCardSummaries: (context, list) => attachCardSummaries(database.db, context, list),
          loadActivePublication: async ({ workspaceId, projectId }) => {
            const active = await publishing.findActiveForProject(projectId);
            if (active === null || active.workspaceId !== workspaceId) return null;
            return {
              sourceRevision: active.sourceRevision,
              publishedAt: active.createdAt,
              ...(active.sourceFingerprint === undefined ? {} : { sourceFingerprint: active.sourceFingerprint }),
            };
          },
          loadCurrentFingerprint: async ({ workspaceId, projectId }) => {
            const context = { workspaceId, userId: "" };
            const project = await projects.findById(context, projectId);
            if (project === null) return null;

            const [settings, published, layouts] = await Promise.all([
              blog.loadSettings(context, projectId),
              blog.list(context, projectId, { status: "published", perPage: 1 }),
              loadTemplates(context, projectId),
            ]);

            return sourceFingerprintFrom({
              projectRevision: project.revision,
              settings,
              publishablePostCount: published.total,
              latestPostChangeAt: published.items[0]?.updatedAt ?? null,
              indexTemplateVersion: layouts.index.version,
              articleTemplateVersion: layouts.article.version,
            });
          },
        }),
      },
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
  await ensurePublishingIndexes(database.db);
});

/** Both surfaces, asked at the same moment. They must never disagree. */
async function pendingEverywhere(projectId: string): Promise<{ status: string; card: string }> {
  const status = await request(app).get(`/api/v1/workspaces/${WORKSPACE}/projects/${projectId}/status`);
  expect(status.status).toBe(200);

  const list = await request(app).get(`/api/v1/workspaces/${WORKSPACE}/projects`);
  const card = (list.body.data as Array<{ id: string; summary: { publicationState: string } }>).find(
    (row) => row.id === projectId,
  );

  return { status: status.body.data.publicationState as string, card: card!.summary.publicationState };
}

const bothSay = async (projectId: string, expected: "up-to-date" | "pending" | "unknown") => {
  const answers = await pendingEverywhere(projectId);
  expect(answers, JSON.stringify(answers)).toEqual({ status: expected, card: expected });
};

/** A site with a blog whose layouts are published, so publication is not blocked. */
async function publishableSite() {
  const project = await projects.create(A, { name: "Acme" });
  await blog.saveSettings(A, project.id, { ...DEFAULT_BLOG_SETTINGS, enabled: true });

  for (const kind of ["index", "article"] as const) {
    const template = await templates.loadOrCreate(A, project.id, kind);
    await templates.saveDraft(
      A,
      project.id,
      kind,
      { draftDocument: createPage({ name: kind }) as BuilderPage, fieldDefinitions: [] },
      template.draftVersion,
    );
    await templates.publish(A, project.id, kind, []);
  }

  return project;
}

async function publishSite(projectId: string) {
  const outcome = await service.publish(A, projectId);
  expect(outcome.status, JSON.stringify(outcome)).toBe("published");
}

describe("a site just published", () => {
  it("has nothing pending", async () => {
    const project = await publishableSite();
    await publishSite(project.id);

    await bothSay(project.id, "up-to-date");
  });

  it("has everything pending before its first publication", async () => {
    const project = await publishableSite();
    await bothSay(project.id, "pending");
  });
});

describe("a change in one source", () => {
  it("counts an edit to a page", async () => {
    const project = await publishableSite();
    await publishSite(project.id);

    const loaded = await projects.findById(A, project.id);
    const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = loaded!;
    document.seo.siteName = "Renamed";
    await projects.saveDocument(A, project.id, revision, document as never);

    await bothSay(project.id, "pending");
  });

  it("counts a post written after the site was published", async () => {
    const project = await publishableSite();
    await publishSite(project.id);

    // The reported failure: the project's revision has not moved, and it never will for a post.
    await blog.create(A, project.id, post() as never);

    await bothSay(project.id, "pending");
  });

  it("counts an edit to an already published post", async () => {
    const project = await publishableSite();
    const written = await blog.create(A, project.id, post() as never);
    await publishSite(project.id);

    await blog.update(A, project.id, written.id, post({ title: "Rewritten" }) as never);

    await bothSay(project.id, "pending");
  });

  it("counts a post being taken off the site", async () => {
    const project = await publishableSite();
    const written = await blog.create(A, project.id, post() as never);
    await publishSite(project.id);

    await blog.setStatus(A, project.id, written.id, "draft");

    await bothSay(project.id, "pending");
  });

  it("counts a post being deleted, which stamps nothing anywhere", async () => {
    const project = await publishableSite();
    const written = await blog.create(A, project.id, post() as never);
    await publishSite(project.id);

    await blog.delete(A, project.id, written.id);

    await bothSay(project.id, "pending");
  });

  it("counts a layout being published, which changes every article at once", async () => {
    const project = await publishableSite();
    await publishSite(project.id);

    const article = await templates.loadOrCreate(A, project.id, "article");
    await templates.saveDraft(
      A,
      project.id,
      "article",
      { draftDocument: createPage({ name: "Redesigned" }) as BuilderPage, fieldDefinitions: [] },
      article.draftVersion,
    );
    await templates.publish(A, project.id, "article", []);

    await bothSay(project.id, "pending");
  });

  it("counts the blog's own settings changing", async () => {
    const project = await publishableSite();
    await publishSite(project.id);

    await blog.saveSettings(A, project.id, { ...DEFAULT_BLOG_SETTINGS, enabled: true, format: "magazine" });

    await bothSay(project.id, "pending");
  });

  it("does not count a draft post, which no publication would include", async () => {
    const project = await publishableSite();
    await publishSite(project.id);

    await blog.create(A, project.id, post({ status: "draft", slug: "not-finished" }) as never);

    await bothSay(project.id, "up-to-date");
  });

  it("does not count a layout draft nobody published", async () => {
    const project = await publishableSite();
    await publishSite(project.id);

    const article = await templates.loadOrCreate(A, project.id, "article");
    await templates.saveDraft(
      A,
      project.id,
      "article",
      { draftDocument: createPage({ name: "Work in progress" }) as BuilderPage, fieldDefinitions: [] },
      article.draftVersion,
    );

    await bothSay(project.id, "up-to-date");
  });
});

describe("every setting a snapshot freezes", () => {
  /*
   * All seven of them, one at a time.
   *
   * Three used to be read, so changing how many posts a page shows, or the byline a post carries,
   * changed what visitors receive and was reported as nothing to publish.
   */
  const cases: Array<[string, Partial<Parameters<typeof blog.saveSettings>[2]>]> = [
    ["how many posts a page shows", { postsPerPage: 5 }],
    ["where the blog lives", { basePath: "/journal" }],
    ["how the list reads", { format: "magazine" }],
    ["the name a post is bylined with", { defaultAuthorName: "The team" }],
  ];

  for (const [what, change] of cases) {
    it(`counts a change to ${what}`, async () => {
      const project = await publishableSite();
      await publishSite(project.id);
      await bothSay(project.id, "up-to-date");

      const settings = await blog.loadSettings(A, project.id);
      await blog.saveSettings(A, project.id, { ...settings, ...change } as never);

      await bothSay(project.id, "pending");
    });
  }

  it("counts the layout a setting points at changing", async () => {
    const project = await publishableSite();
    await publishSite(project.id);

    const settings = await blog.loadSettings(A, project.id);
    await blog.saveSettings(A, project.id, { ...settings, articleTemplateId: "another-template-id" } as never);

    await bothSay(project.id, "pending");
  });
});

describe("a snapshot published before change tracking", () => {
  /** Writes a version the way every publication before source fingerprints wrote one. */
  async function publishWithoutFingerprint(projectId: string, sourceRevision: number) {
    await publishing.publish(A, projectId, {
      sourceRevision,
      schemaVersion: 1,
      document: (await projects.findById(A, projectId))!,
      routes: [],
      redirects: [],
      referencedMediaIds: [],
      contentHash: "legacy",
    } as never);
  }

  it("is never reported as up to date, because nothing proves it", async () => {
    const project = await publishableSite();
    await publishWithoutFingerprint(project.id, project.revision);

    await bothSay(project.id, "unknown");
  });

  it("is reported as pending when a post changed, which its revision cannot show", async () => {
    const project = await publishableSite();
    await publishWithoutFingerprint(project.id, project.revision);
    await blog.create(A, project.id, post() as never);

    // Still unknown rather than up-to-date: the honest answer is that this snapshot recorded nothing
    // to compare a post against, and one publication is what replaces the guess with a fact.
    await bothSay(project.id, "unknown");
  });

  it("is reported as pending once the document itself moves", async () => {
    const project = await publishableSite();
    await publishWithoutFingerprint(project.id, project.revision);

    const loaded = await projects.findById(A, project.id);
    const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = loaded!;
    document.seo.siteName = "Renamed";
    await projects.saveDocument(A, project.id, revision, document as never);

    await bothSay(project.id, "pending");
  });

  it("is normalised by the first real publication", async () => {
    const project = await publishableSite();
    await publishWithoutFingerprint(project.id, project.revision);
    await bothSay(project.id, "unknown");

    await publishSite(project.id);

    await bothSay(project.id, "up-to-date");
  });
});

describe("publishing again", () => {
  it("clears the state, whatever moved it", async () => {
    const project = await publishableSite();
    await publishSite(project.id);
    await blog.create(A, project.id, post() as never);
    await bothSay(project.id, "pending");

    await publishSite(project.id);

    await bothSay(project.id, "up-to-date");
  });

  it("clears it even when the output turns out to be identical", async () => {
    const project = await publishableSite();
    const written = await blog.create(A, project.id, post() as never);
    await publishSite(project.id);

    // An edit and its exact reversal: the sources moved, the page a visitor receives did not.
    await blog.update(A, project.id, written.id, post({ title: "Rewritten" }) as never);
    await blog.update(A, project.id, written.id, post() as never);
    await bothSay(project.id, "pending");

    await publishSite(project.id);

    // The republish is a no-op for content, so it must still record that the sources now match.
    await bothSay(project.id, "up-to-date");
  });
});

describe("a publication that fails", () => {
  it("leaves the previous version serving and the state pending", async () => {
    const project = await publishableSite();
    const written = await blog.create(A, project.id, post() as never);
    await publishSite(project.id);
    const live = await publishing.findActiveForProject(project.id);

    // A blog on with a layout that is no longer published blocks publication of the whole site.
    await database.db.collection("blogTemplates").updateOne(
      { projectId: project.id, kind: "article" },
      { $unset: { publishedDocument: "", publishedVersion: "" } },
    );
    await blog.update(A, project.id, written.id, post({ title: "Written while blocked" }) as never);

    expect((await service.publish(A, project.id)).status).toBe("blocked");

    expect((await publishing.findActiveForProject(project.id))?.id).toBe(live?.id);
    await bothSay(project.id, "pending");
  });
});

/**
 * Looking at a site must not change it.
 *
 * The fingerprint used `loadOrCreate`, which is the template editor's entry point and creates a
 * starter when none exists — right when somebody opens a layout to design it, and wrong when the
 * caller is a dashboard. Opening the status of a site with no blog wrote two template rows and made
 * an unused module look started.
 */
describe("reading a site's status", () => {
  const templateCount = () => database.db.collection("blogTemplates").countDocuments({});

  it("creates no templates for a site with no blog", async () => {
    const project = await projects.create(A, { name: "No blog here" });

    expect(await templateCount()).toBe(0);
    await request(app).get(`/api/v1/workspaces/${WORKSPACE}/projects/${project.id}/status`);
    expect(await templateCount()).toBe(0);
  });

  it("is idempotent: asking twice writes nothing either time", async () => {
    const project = await projects.create(A, { name: "No blog here" });
    const before = await database.db.collection("blogTemplates").find({}).toArray();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app).get(`/api/v1/workspaces/${WORKSPACE}/projects/${project.id}/status`);
      await request(app).get(`/api/v1/workspaces/${WORKSPACE}/projects`);
    }

    expect(await database.db.collection("blogTemplates").find({}).toArray()).toEqual(before);
  });

  it("still reads the versions of a blog that does have layouts", async () => {
    const project = await publishableSite();
    await publishSite(project.id);
    const stored = await templates.findPublishedMetadata(A, project.id);

    // Publishing stamps the draft's own version, and `publishableSite` saves a draft before
    // publishing it — so the number to expect is the one the layout was published at, read from the
    // layout itself rather than assumed.
    const [index, article] = await Promise.all([
      templates.loadOrCreate(A, project.id, "index"),
      templates.loadOrCreate(A, project.id, "article"),
    ]);
    expect(stored.index.version).toBe(index.publishedVersion);
    expect(stored.article.version).toBe(article.publishedVersion);
    expect(stored.index.version).not.toBeNull();
    expect(stored.article.document).toBeDefined();

    // And the state it feeds stays correct.
    await bothSay(project.id, "up-to-date");
  });

  it("answers another workspace with absence rather than this one's layouts", async () => {
    const project = await publishableSite();
    await publishSite(project.id);

    const theirs = await templates.findPublishedMetadata(B, project.id);

    expect(theirs.index.version).toBeNull();
    expect(theirs.article.version).toBeNull();
    expect(theirs.article.document).toBeUndefined();
    // Reading across a tenant boundary must not have created anything either.
    expect(await database.db.collection("blogTemplates").countDocuments({ workspaceId: B.workspaceId })).toBe(0);
  });
});

describe("the cost of answering it for a whole page", () => {
  it("does not grow with the number of sites", async () => {
    const counted = async (siteCount: number) => {
      await database.clear();
      await ensureBlogIndexes(database.db);
      await ensureTemplateIndexes(database.db);
      await ensurePublishingIndexes(database.db);
      for (let index = 0; index < siteCount; index += 1) await projects.create(A, { name: `Site ${index}` });

      let reads = 0;
      const real = database.db.collection.bind(database.db);
      const spy = vi.spyOn(database.db, "collection").mockImplementation(((name: string, options?: unknown) => {
        const collection = real(name, options as never) as unknown as Record<string, (...args: unknown[]) => unknown>;
        for (const method of ["find", "aggregate"] as const) {
          const original = collection[method]!.bind(collection);
          collection[method] = (...args: unknown[]) => {
            reads += 1;
            return original(...args);
          };
        }
        return collection;
      }) as never);

      await request(app).get(`/api/v1/workspaces/${WORKSPACE}/projects`);
      spy.mockRestore();
      return reads;
    };

    // The whole point of the fingerprint: one grouped read per source, not one per card.
    expect(await counted(10)).toBe(await counted(1));
  });
});
