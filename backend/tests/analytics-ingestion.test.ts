import { createProjectDocument, DEFAULT_ANALYTICS_SETTINGS, type AnalyticsBatch } from "@websitebuilder/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { COLLECTIONS } from "../src/db/indexes";
import {
  ANALYTICS_COLLECTIONS,
  AnalyticsRepository,
  ensureAnalyticsIndexes,
} from "../src/modules/analytics/repository";
import { BlogRepository } from "../src/modules/blog/repository";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { ensurePublishingIndexes, PublishingRepository } from "../src/modules/publishing/repository";
import { PublishingService } from "../src/modules/publishing/service";
import { createAnalyticsRuntime, ANALYTICS_EVENTS_PATH, ANALYTICS_SCRIPT_PATH } from "../src/renderer/analytics";
import { createRendererApp } from "../src/renderer/app";
import { SiteResolver } from "../src/renderer/resolver";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * The ingestion endpoint: the only place in the product where an unauthenticated stranger can cause
 * a write. Every test here is a way that write could go somewhere it should not.
 */

let database: TestDatabase;
let projects: ProjectRepository;
let publishing: PublishingRepository;
let service: PublishingService;
let resolver: SiteResolver;
let analytics: AnalyticsRepository;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };

const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

function app(overrides: Partial<Parameters<typeof createAnalyticsRuntime>[0]> = {}) {
  const runtime = createAnalyticsRuntime({
    resolver,
    analytics,
    publishing,
    logger: testLogger(),
    trustsProxy: false,
    enabled: true,
    ...overrides,
  } as Parameters<typeof createAnalyticsRuntime>[0]);

  return createRendererApp({ env: testEnv(), logger: testLogger(), resolver, analytics: runtime });
}

let counter = 0;
function batch(overrides: Partial<AnalyticsBatch> = {}): AnalyticsBatch {
  counter += 1;
  const hex = String(counter).padStart(4, "0");
  return {
    schemaVersion: 1,
    batchId: `3f1a1c5e-6b2d-4a7f-9c11-2b0f6a8d${hex}`,
    sessionId: `8d4e51aa-6b2d-4a7f-9c11-2b0f6a8d${hex}`,
    pageViewId: `8d4e51bb-6b2d-4a7f-9c11-2b0f6a8d${hex}`,
    sentAt: "2026-08-11T14:30:00.000Z",
    path: "/",
    device: "desktop",
    source: { kind: "direct" },
    events: [{ type: "page_view" }],
    ...overrides,
  };
}

const send = (application: ReturnType<typeof app>, host: string, body: unknown) =>
  request(application).post(ANALYTICS_EVENTS_PATH).set("Host", host).set("User-Agent", BROWSER).send(body as object);

/** Publishes a site with two pages and enables collection for it. */
async function liveSite(context: WorkspaceContext, name: string, hostname: string) {
  const project = await projects.create(context, { name });
  const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = project;
  const typed = document as ReturnType<typeof createProjectDocument>;
  typed.pages.push({
    ...structuredClone(typed.pages[0]!),
    id: `${name}-about`,
    name: "About",
    slug: "about",
    isHome: false,
    order: 1,
  });

  const saved = await projects.saveDocument(context, project.id, revision, typed);
  if (saved === null) throw new Error(`saveDocument rejected the ${name} fixture`);

  const published = await service.publish(context, project.id);
  if (published.status !== "published") throw new Error(`publishing ${name} returned ${published.status}`);

  const domain = await publishing.ensurePlatformDomain(context, project.id, hostname.split(".")[0]!, "example.test");
  if (domain === null) throw new Error(`no platform hostname for ${name}`);

  await analytics.saveSettings(context, project.id, { ...DEFAULT_ANALYTICS_SETTINGS, enabled: true });
  resolver.invalidateAll();

  return { projectId: project.id, versionId: published.status === "published" ? published.version.id : "" };
}

const stored = (collection: string) => database.db.collection(collection).find({}).toArray();

beforeAll(async () => {
  database = await startTestDatabase();
  projects = new ProjectRepository(database.db);
  publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  service = new PublishingService({
    projects,
    publishing,
    blog: new BlogRepository(database.db),
    media: new MediaRepository(database.db, createGridFsStorage(database.db)),
  });
  resolver = new SiteResolver(publishing, 60);
  analytics = new AnalyticsRepository(database.db);
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensurePublishingIndexes(database.db);
  await ensureAnalyticsIndexes(database.db);
  resolver.invalidateAll();
});

describe("accepting a batch", () => {
  it("stores it against the tenant that owns the hostname", async () => {
    const site = await liveSite(A, "Alpha", "alpha.example.test");

    const response = await send(app(), "alpha.example.test", batch());

    expect(response.status).toBe(204);
    const daily = await stored(ANALYTICS_COLLECTIONS.daily);
    expect(daily[0]).toMatchObject({ workspaceId: A.workspaceId, projectId: site.projectId, views: 1 });
  });

  it("resolves the page from the published route, not from what was sent", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    await send(app(), "alpha.example.test", batch({ path: "/about" }));

    const [daily] = await stored(ANALYTICS_COLLECTIONS.daily);
    // The page id is the manifest's resource id for /about, which the caller never supplied.
    expect(daily?.["pageId"]).toBe("Alpha-about");
  });

  it("answers with nothing at all", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const response = await send(app(), "alpha.example.test", batch());

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
  });
});

describe("what a caller cannot do", () => {
  it("cannot name another tenant", async () => {
    const mine = await liveSite(A, "Alpha", "alpha.example.test");
    const theirs = await liveSite(B, "Beta", "beta.example.test");

    // Every shape a forged identity could take. The schema has no such fields, so each is rejected
    // outright rather than merely ignored.
    for (const forged of [
      { workspaceId: B.workspaceId },
      { projectId: theirs.projectId },
      { pageId: "someone-elses-page" },
    ]) {
      const response = await send(app(), "alpha.example.test", { ...batch(), ...forged });
      expect(response.status).toBe(400);
    }

    const daily = await stored(ANALYTICS_COLLECTIONS.daily);
    expect(daily).toHaveLength(0);
    expect(mine.projectId).not.toBe(theirs.projectId);
  });

  it("cannot create a row for a path that was never published", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    // The reason this matters: a request path is chosen by whoever sends it. Counting it directly
    // would let anyone grow this collection without limit inside someone else's workspace.
    for (const path of ["/not-a-page", "/../../etc/passwd", `/${"x".repeat(200)}`]) {
      const response = await send(app(), "alpha.example.test", batch({ path }));
      expect(response.status).toBe(204);
    }

    expect(await stored(ANALYTICS_COLLECTIONS.daily)).toHaveLength(0);
  });

  it("cannot reach a host that serves no site", async () => {
    const response = await send(app(), "nobody.example.test", batch());

    expect(response.status).toBe(404);
    expect(await stored(ANALYTICS_COLLECTIONS.daily)).toHaveLength(0);
  });

  it("cannot attribute clicks to a version that is not this project's", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const theirs = await liveSite(B, "Beta", "beta.example.test");

    await send(
      app(),
      "alpha.example.test",
      batch({ versionId: theirs.versionId, events: [{ type: "page_region_click", x: 0.5, y: 0.5 }] }),
    );

    const [bin] = await stored(ANALYTICS_COLLECTIONS.bins);
    // Falls back to the version this site is actually serving rather than believing the claim.
    expect(bin?.["versionId"]).not.toBe(theirs.versionId);
    expect(bin?.["workspaceId"]).toBe(A.workspaceId);
  });

  it("cannot send a batch that is not JSON", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const response = await request(app())
      .post(ANALYTICS_EVENTS_PATH)
      .set("Host", "alpha.example.test")
      .set("User-Agent", BROWSER)
      .set("Content-Type", "text/plain")
      .send(JSON.stringify(batch()));

    // Also the CSRF control: a browser cannot send this content type cross-origin without a
    // preflight, and the renderer has no CORS middleware to answer one.
    expect(response.status).toBe(415);
  });

  it("cannot send more events than the contract allows", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const events = Array.from({ length: 51 }, () => ({ type: "page_view" as const }));

    const response = await send(app(), "alpha.example.test", batch({ events }));

    expect(response.status).toBe(400);
    expect(await stored(ANALYTICS_COLLECTIONS.daily)).toHaveLength(0);
  });

  it("cannot send a body larger than the limit", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const padded = { ...batch(), source: { kind: "external", host: "x".repeat(200_000) } };

    const response = await send(app(), "alpha.example.test", padded);

    expect(response.status).toBe(413);
  });

  it("learns nothing from a rejection", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const response = await send(app(), "alpha.example.test", { schemaVersion: 1, events: [] });

    // No field paths, no expected types, no mention of what was missing: a detailed validation
    // error is a description of the schema, handed to whoever is probing it.
    expect(response.status).toBe(400);
    expect(response.text).toBe("Bad Request");
  });
});

describe("counting once", () => {
  it("ignores a batch that was already counted", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const replayed = batch();

    for (const attempt of [1, 2, 3]) {
      const response = await send(app(), "alpha.example.test", replayed);
      expect(response.status, `attempt ${attempt}`).toBe(204);
    }

    const [daily] = await stored(ANALYTICS_COLLECTIONS.daily);
    expect(daily?.["views"]).toBe(1);
  });

  it("counts two different batches from one session as one session", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const sessionId = "8d4e51aa-6b2d-4a7f-9c11-2b0f6a8d9999";

    await send(app(), "alpha.example.test", batch({ sessionId }));
    await send(app(), "alpha.example.test", batch({ sessionId, events: [{ type: "page_view" }] }));

    const sessions = await stored(ANALYTICS_COLLECTIONS.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.["pageViews"]).toBe(2);
  });
});

describe("collection that was never enabled", () => {
  it("stores nothing for a site whose owner has not turned analytics on", async () => {
    const project = await projects.create(A, { name: "Quiet" });
    const published = await service.publish(A, project.id);
    if (published.status !== "published") throw new Error("fixture did not publish");
    await publishing.ensurePlatformDomain(A, project.id, "quiet", "example.test");
    resolver.invalidateAll();

    const response = await send(app(), "quiet.example.test", batch());

    // Accepted so the tracker cannot distinguish a disabled site from a working one, and stored
    // nowhere. The tracker is not injected there either; this is the second of the two locks.
    expect(response.status).toBe(204);
    expect(await stored(ANALYTICS_COLLECTIONS.daily)).toHaveLength(0);
    expect(await stored(ANALYTICS_COLLECTIONS.sessions)).toHaveLength(0);
  });
});

describe("abuse", () => {
  it("limits one project's batches however many addresses they come from", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const limited = app({ limits: { perAddress: 1000, perProject: 3, windowMs: 60_000 } });

    const statuses: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      statuses.push((await send(limited, "alpha.example.test", batch())).status);
    }

    expect(statuses.filter((status) => status === 204)).toHaveLength(3);
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
  });

  it("does not limit by address when a forwarded address cannot be believed", async () => {
    // Without trusted proxy ranges every visitor presents the gateway's address, so an address
    // bucket would throttle the entire internet as one client.
    await liveSite(A, "Alpha", "alpha.example.test");
    const limited = app({ trustsProxy: false, limits: { perAddress: 1, perProject: 1000, windowMs: 60_000 } });

    const first = await send(limited, "alpha.example.test", batch());
    const second = await send(limited, "alpha.example.test", batch());

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
  });

  it("limits by address when forwarded addresses are trusted", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const limited = app({ trustsProxy: true, limits: { perAddress: 1, perProject: 1000, windowMs: 60_000 } });

    expect((await send(limited, "alpha.example.test", batch())).status).toBe(204);
    expect((await send(limited, "alpha.example.test", batch())).status).toBe(429);
  });

  it("leaves crawlers out of a customer's numbers", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const response = await request(app())
      .post(ANALYTICS_EVENTS_PATH)
      .set("Host", "alpha.example.test")
      .set("User-Agent", "Googlebot/2.1")
      .send(batch() as object);

    expect(response.status).toBe(204);
    expect(await stored(ANALYTICS_COLLECTIONS.daily)).toHaveLength(0);
  });
});

describe("the endpoint's place in the renderer", () => {
  it("is not shadowed by a page a site could publish at the same address", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    // Registered before the catch-all, so the platform's own paths belong to the platform.
    const response = await request(app()).get(ANALYTICS_EVENTS_PATH).set("Host", "alpha.example.test");
    expect(response.status).not.toBe(200);
  });

  it("does not put a body parser in front of published pages", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const page = await request(app()).get("/").set("Host", "alpha.example.test").set("User-Agent", BROWSER);
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
  });
});

describe("the tracker asset", () => {
  it("is served on the site's own origin, so no third party is involved", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const response = await request(app()).get(ANALYTICS_SCRIPT_PATH).set("Host", "alpha.example.test");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/javascript");
    expect(response.text.length).toBeGreaterThan(1000);
  });

  it("is immutable, because its URL carries a content hash", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const response = await request(app()).get(ANALYTICS_SCRIPT_PATH).set("Host", "alpha.example.test");

    expect(response.headers["cache-control"]).toContain("immutable");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("contains no external origin it could fetch from", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const response = await request(app()).get(ANALYTICS_SCRIPT_PATH).set("Host", "alpha.example.test");

    // Bundled, not linked. A tracker that loaded anything at runtime would be a way for a third
    // party to reach a customer's visitors later, whatever it does today.
    expect(response.text).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost)/);
  });
});

describe("what a published page carries", () => {
  it("ships no script and the strict policy while collection is off", async () => {
    const project = await projects.create(A, { name: "Quiet" });
    const published = await service.publish(A, project.id);
    if (published.status !== "published") throw new Error("fixture did not publish");
    await publishing.ensurePlatformDomain(A, project.id, "quiet", "example.test");
    resolver.invalidateAll();

    const page = await request(app()).get("/").set("Host", "quiet.example.test").set("User-Agent", BROWSER);

    expect(page.text).not.toContain("<script");
    expect(page.headers["content-security-policy"]).toContain("script-src 'none'");
  });

  it("carries a deferred script and the policy that admits it once collection is on", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const page = await request(app()).get("/").set("Host", "alpha.example.test").set("User-Agent", BROWSER);

    expect(page.text).toContain("<script defer");
    expect(page.text).toContain(ANALYTICS_SCRIPT_PATH);
    expect(page.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(page.headers["content-security-policy"]).toContain("connect-src 'self'");
  });

  it("tells the tracker which layout it is running on", async () => {
    const site = await liveSite(A, "Alpha", "alpha.example.test");

    const page = await request(app()).get("/").set("Host", "alpha.example.test").set("User-Agent", BROWSER);

    // Without this a visitor still on an older layout would have their clicks attributed to the one
    // that replaced it — the stale overlay heatmaps exist to avoid.
    expect(page.text).toContain(`data-version="${site.versionId}"`);
  });

  it("carries the site's own consent and sampling choices, not a default", async () => {
    const site = await liveSite(A, "Alpha", "alpha.example.test");
    await analytics.saveSettings(A, site.projectId, {
      ...DEFAULT_ANALYTICS_SETTINGS,
      enabled: true,
      consentRequired: false,
      sampleRate: 0.5,
      categories: ["traffic"],
    });

    // A fresh app, because settings are cached per runtime for the life of a TTL.
    const page = await request(app()).get("/").set("Host", "alpha.example.test").set("User-Agent", BROWSER);

    expect(page.text).toContain('data-consent="0"');
    expect(page.text).toContain('data-sample="0.5"');
    expect(page.text).toContain('data-categories="traffic"');
  });

  it("never injects an inline script, which the policy forbids", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const page = await request(app()).get("/").set("Host", "alpha.example.test").set("User-Agent", BROWSER);

    // Configuration travels on attributes precisely so that `script-src` needs no inline allowance.
    expect(page.text).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
  });
});

describe("the deployment switch", () => {
  it("stores nothing while ingestion is turned off for the whole deployment", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const off = app({ enabled: false });

    const response = await send(off, "alpha.example.test", batch());

    // Two locks in two places: a site can be collecting and still receive nothing while an operator
    // has ingestion off, which is what makes a controlled rollout possible.
    expect(response.status).toBe(204);
    expect(await stored(ANALYTICS_COLLECTIONS.daily)).toHaveLength(0);
  });
});

describe("what an operator can see", () => {
  it("reports how batches ended, and nothing about who sent them", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const runtime = createAnalyticsRuntime({
      resolver,
      analytics,
      publishing,
      logger: testLogger(),
      trustsProxy: false,
      enabled: true,
    });
    const application = createRendererApp({ env: testEnv(), logger: testLogger(), resolver, analytics: runtime });

    await send(application, "alpha.example.test", batch());
    await send(application, "alpha.example.test", { schemaVersion: 1 });
    await send(application, "nobody.example.test", batch());

    const health = await request(application).get("/healthz");

    expect(health.body.data.analytics).toMatchObject({
      accepted: 1,
      rejectedMalformed: 1,
      rejectedUnknownHost: 1,
    });
    // Counts only. Nothing here names a session, a path, an address or an agent.
    const serialised = JSON.stringify(health.body.data.analytics);
    expect(serialised).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(serialised).not.toContain("alpha.example.test");
  });

  it("logs nothing that identifies a visitor", async () => {
    const lines: string[] = [];
    const capturing = testLogger();
    const runtime = createAnalyticsRuntime({
      resolver,
      analytics,
      publishing,
      logger: Object.assign(Object.create(capturing), {
        warn: (...args: unknown[]) => lines.push(JSON.stringify(args)),
        info: (...args: unknown[]) => lines.push(JSON.stringify(args)),
      }) as typeof capturing,
      trustsProxy: false,
      enabled: true,
    });
    const application = createRendererApp({ env: testEnv(), logger: testLogger(), resolver, analytics: runtime });

    const site = await liveSite(A, "Alpha", "alpha.example.test");
    const sent = batch({ events: [{ type: "page_region_click", x: 0.1234, y: 0.5678 }] });
    await send(application, "alpha.example.test", sent);

    const output = lines.join("\n");
    for (const secret of [sent.sessionId, sent.batchId, sent.pageViewId, "0.1234", "0.5678", BROWSER]) {
      expect(output, `${secret} was logged`).not.toContain(secret);
    }
    expect(site.projectId).not.toBe("");
  });
});
