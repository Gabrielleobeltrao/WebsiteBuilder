import { createProjectDocument } from "@websitebuilder/shared";
import { fixtureButton } from "@websitebuilder/shared/responsive-fixtures";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { COLLECTIONS } from "../src/db/indexes";
import { BlogRepository } from "../src/modules/blog/repository";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { ensurePublishingIndexes, PublishingRepository } from "../src/modules/publishing/repository";
import { PublishingService } from "../src/modules/publishing/service";
import { createRendererApp, PUBLISHED_SITE_CSP, PUBLISHED_SITE_CSP_WITH_ANALYTICS } from "../src/renderer/app";
import { SiteResolver } from "../src/renderer/resolver";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * Two tenants share one renderer process for every test in this file. Anything that leaks between
 * them here would leak between real customers in production.
 */
let database: TestDatabase;
let projects: ProjectRepository;
let publishing: PublishingRepository;
let service: PublishingService;
let resolver: SiteResolver;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };

const renderer = (overrides: Partial<ReturnType<typeof testEnv>> = {}) =>
  createRendererApp({ env: { ...testEnv(), ...overrides }, logger: testLogger(), resolver });

/** Creates a project, names its home page, publishes it and gives it a live hostname. */
async function liveSite(context: WorkspaceContext, name: string, hostname: string) {
  const project = await projects.create(context, { name });

  const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = project;
  const typed = document as ReturnType<typeof createProjectDocument>;
  typed.pages[0]!.seo.title = `${name} home`;
  typed.pages[0]!.seo.description = `${name} description`;
  typed.seo.siteName = name;
  typed.pages.push({
    ...structuredClone(typed.pages[0]!),
    id: `${name}-about`,
    name: "About",
    slug: "about",
    isHome: false,
    order: 1,
    seo: { ...typed.pages[0]!.seo, title: `${name} about` },
  });
  const saved = await projects.saveDocument(context, project.id, revision, typed);
  // Setup that fails quietly produces a test failure with no explanation. Both of these return
  // rather than throw on failure, so they are checked here.
  if (saved === null) throw new Error(`saveDocument rejected the ${name} fixture`);

  const published = await service.publish(context, project.id);
  if (published.status !== "published") {
    throw new Error(`publishing ${name} returned ${published.status}: ${JSON.stringify(published)}`);
  }

  const domain = await publishing.ensurePlatformDomain(context, project.id, hostname.split(".")[0]!, "example.test");
  if (domain === null) throw new Error(`no platform hostname for ${name}`);

  resolver.invalidateAll();
  return project.id;
}

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
}, 120_000);

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensurePublishingIndexes(database.db);
  resolver.invalidateAll();
});

describe("health", () => {
  it("answers without requiring a site hostname", async () => {
    const response = await request(renderer()).get("/healthz");
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
  });
});

describe("host resolution", () => {
  it("serves each tenant its own site from one process", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    await liveSite(B, "Beta", "beta.example.test");

    const app = renderer();
    const alpha = await request(app).get("/").set("Host", "alpha.example.test");
    const beta = await request(app).get("/").set("Host", "beta.example.test");

    expect(alpha.text).toContain("Alpha home");
    expect(alpha.text).not.toContain("Beta");
    expect(beta.text).toContain("Beta home");
    expect(beta.text).not.toContain("Alpha");
  });

  it("gives an unknown host the same neutral answer as a host that exists but is not live", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const app = renderer();
    const unknown = await request(app).get("/").set("Host", "nothing.example.test");
    const pending = await request(app).get("/").set("Host", "alpha.example.test.evil.test");

    expect(unknown.status).toBe(404);
    expect(pending.status).toBe(404);
    expect(unknown.text).toBe(pending.text);
  });

  it("does not let a query parameter or header choose the project", async () => {
    const alphaId = await liveSite(A, "Alpha", "alpha.example.test");
    await liveSite(B, "Beta", "beta.example.test");

    const response = await request(renderer())
      .get(`/?projectId=${alphaId}`)
      .set("Host", "beta.example.test")
      .set("x-project-id", alphaId);

    // Identity comes from the hostname alone.
    expect(response.text).toContain("Beta home");
    expect(response.text).not.toContain("Alpha");
  });

  it("ignores a forwarded host when no proxy range is trusted", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    await liveSite(B, "Beta", "beta.example.test");

    const response = await request(renderer())
      .get("/")
      .set("Host", "beta.example.test")
      .set("X-Forwarded-Host", "alpha.example.test");

    expect(response.text).toContain("Beta home");
  });
});

describe("routes", () => {
  it("serves each route its own content and metadata", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const app = renderer();
    const home = await request(app).get("/").set("Host", "alpha.example.test");
    const about = await request(app).get("/about").set("Host", "alpha.example.test");

    expect(home.text).toContain("<title>Alpha home | Alpha</title>");
    expect(about.text).toContain("<title>Alpha about | Alpha</title>");
    expect(about.text).toContain('<link rel="canonical" href="https://alpha.example.test/about">');
  });

  it("delivers metadata before any client JavaScript", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const response = await request(renderer()).get("/").set("Host", "alpha.example.test");

    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain('<meta name="description" content="Alpha description">');
    expect(response.text).toContain('<meta property="og:title"');
    expect(response.text).not.toContain("<script");
  });

  it("treats a trailing slash as the same page rather than a second URL", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const app = renderer();
    const plain = await request(app).get("/about").set("Host", "alpha.example.test");
    const slashed = await request(app).get("/about/").set("Host", "alpha.example.test");

    expect(slashed.status).toBe(200);
    expect(slashed.text).toBe(plain.text);
  });

  it("answers an unknown path with the site's own 404 and a noindex directive", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const response = await request(renderer()).get("/nowhere").set("Host", "alpha.example.test");

    expect(response.status).toBe(404);
    expect(response.text).toContain("noindex");
  });
});

describe("caching", () => {
  it("serves a publication immediately, without waiting for a cache to expire", async () => {
    const projectId = await liveSite(A, "Alpha", "alpha.example.test");

    const app = renderer();
    expect((await request(app).get("/").set("Host", "alpha.example.test")).text).toContain("Alpha home");

    const project = await projects.findById(A, projectId);
    const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = project!;
    const typed = document as ReturnType<typeof createProjectDocument>;
    typed.pages[0]!.seo.title = "Renamed";
    await projects.saveDocument(A, projectId, revision, typed);
    await service.publish(A, projectId);

    // The API that published this runs in a different process, so there is no cache to invalidate
    // from there. The active-version pointer is read per request, which is what makes this work.
    expect((await request(app).get("/").set("Host", "alpha.example.test")).text).toContain("Renamed");
  });

  it("never returns one tenant's cached page for another host", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    await liveSite(B, "Beta", "beta.example.test");

    const app = renderer();
    await request(app).get("/").set("Host", "alpha.example.test");
    const beta = await request(app).get("/").set("Host", "beta.example.test");

    expect(beta.text).toContain("Beta home");
  });
});

describe("rollback visibility", () => {
  it("serves the restored version at once", async () => {
    const projectId = await liveSite(A, "Alpha", "alpha.example.test");
    const first = (await publishing.history(A, projectId))[0]!;

    const project = await projects.findById(A, projectId);
    const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = project!;
    const typed = document as ReturnType<typeof createProjectDocument>;
    typed.pages[0]!.seo.title = "Second";
    await projects.saveDocument(A, projectId, revision, typed);
    await service.publish(A, projectId);

    const app = renderer();
    expect((await request(app).get("/").set("Host", "alpha.example.test")).text).toContain("Second");

    await publishing.rollback(A, projectId, first.id);
    expect((await request(app).get("/").set("Host", "alpha.example.test")).text).toContain("Alpha home");
  });
});

describe("restart", () => {
  it("keeps serving published sites from a process with an empty cache", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    // A fresh resolver is what a restarted or redeployed container starts with. Published mappings
    // and versions live in the database, so nothing is lost with the process.
    const restarted = new SiteResolver(publishing, 60);
    const app = createRendererApp({ env: testEnv(), logger: testLogger(), resolver: restarted });

    const response = await request(app).get("/").set("Host", "alpha.example.test");
    expect(response.status).toBe(200);
    expect(response.text).toContain("Alpha home");
  });
});

describe("host routing safety", () => {
  /**
   * One process serves every tenant, so the hostname is the only thing standing between them.
   * Everything here is an attempt to be served a site the request has no claim to.
   */
  it("refuses a reserved platform label even though it matches the wildcard", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const app = renderer();
    for (const reserved of ["api", "www", "admin", "origin", "customers", "app"]) {
      const response = await request(app).get("/").set("Host", `${reserved}.example.test`);
      expect(response.status).toBe(404);
    }
  });

  it("refuses a hostname that is not registered, whatever it looks like", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const app = renderer();
    // A trailing dot is deliberately absent here: it denotes the same host in DNS and is asserted
    // to resolve in the next case.
    for (const host of ["alpha.example.test.evil.test", "evil.test", "alpha-other.example.test"]) {
      expect((await request(app).get("/").set("Host", host)).status).toBe(404);
    }
  });

  it("resolves a hostname regardless of case and trailing dot", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const app = renderer();
    for (const host of ["ALPHA.example.test", "Alpha.Example.Test", "alpha.example.test."]) {
      const response = await request(app).get("/").set("Host", host);
      expect(response.status).toBe(200);
      expect(response.text).toContain("Alpha home");
    }
  });

  it("refuses an IP literal, which can never be a customer hostname", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const app = renderer();
    for (const host of ["127.0.0.1", "[::1]", "10.0.0.5:3001"]) {
      expect((await request(app).get("/").set("Host", host)).status).toBe(404);
    }
  });

  it("does not let a forwarded-host chain select a tenant", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    await liveSite(B, "Beta", "beta.example.test");

    // Ambiguous chains are exactly what a spoofing attempt looks like: the real host says one
    // thing and a header claims another.
    const response = await request(renderer())
      .get("/")
      .set("Host", "beta.example.test")
      .set("X-Forwarded-Host", "alpha.example.test, beta.example.test");

    expect(response.text).toContain("Beta home");
    expect(response.text).not.toContain("Alpha");
  });

  it("answers an unknown host identically however it fails", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const app = renderer();
    const reserved = await request(app).get("/").set("Host", "api.example.test");
    const unknown = await request(app).get("/").set("Host", "nothing.example.test");
    const malformed = await request(app).get("/").set("Host", "not a host");

    // Three different reasons, one response. A difference here is a way to discover which
    // hostnames exist.
    expect(reserved.status).toBe(unknown.status);
    expect(unknown.status).toBe(malformed.status);
    expect(reserved.text).toBe(unknown.text);
    expect(unknown.text).toBe(malformed.text);
  });
});

describe("published page security headers", () => {
  it("forbids scripts outright, because a published page ships none", () => {
    // The policy is the truth written down rather than a compromise. If a script is ever added to
    // public output, this line refuses it until someone argues for the change.
    expect(PUBLISHED_SITE_CSP).toContain("script-src 'none'");
    expect(PUBLISHED_SITE_CSP).toContain("default-src 'none'");
  });

  it("allows inline styles, which are serialised by the renderer and never supplied by a designer", () => {
    expect(PUBLISHED_SITE_CSP).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("limits frames to the two providers whose embed URLs this code builds", () => {
    expect(PUBLISHED_SITE_CSP).toContain("frame-src https://www.youtube-nocookie.com https://player.vimeo.com");
    expect(PUBLISHED_SITE_CSP).toContain("frame-ancestors 'none'");
  });

  it("sends the policy with every rendered page", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const response = await request(renderer()).get("/").set("Host", "alpha.example.test");

    expect(response.headers["content-security-policy"]).toBe(PUBLISHED_SITE_CSP);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(response.headers["permissions-policy"]).toContain("camera=()");
  });
});

describe("view counting", () => {
  /** Collects what would have been counted, so the assertions read the same data Mongo would get. */
  const recorder = () => {
    const counted: Array<{ workspaceId: string; projectId: string; path: string }> = [];
    return { counted, record: (view: (typeof counted)[number]) => counted.push(view) };
  };

  const countingRenderer = (record: ReturnType<typeof recorder>["record"]) =>
    createRendererApp({ env: testEnv(), logger: testLogger(), resolver, recordView: record });

  const browser = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

  it("counts a served page against the site that owns it", async () => {
    const projectId = await liveSite(A, "Alpha", "alpha.example.test");
    const { counted, record } = recorder();

    await request(countingRenderer(record)).get("/about").set("Host", "alpha.example.test").set("User-Agent", browser);

    expect(counted).toEqual([{ workspaceId: A.workspaceId, projectId, path: "/about" }]);
  });

  it("counts the published path, not the requested one", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const { counted, record } = recorder();

    // A query string is part of the request and not of the page. Counting it would split one page
    // into a row per campaign link, and give anyone a way to grow the collection without limit.
    await request(countingRenderer(record))
      .get("/about?utm_source=newsletter")
      .set("Host", "alpha.example.test")
      .set("User-Agent", browser);

    expect(counted.map((view) => view.path)).toEqual(["/about"]);
  });

  it("counts nothing for a page that does not exist", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const { counted, record } = recorder();

    const response = await request(countingRenderer(record))
      .get("/nowhere")
      .set("Host", "alpha.example.test")
      .set("User-Agent", browser);

    expect(response.status).toBe(404);
    expect(counted).toEqual([]);
  });

  it("counts nothing for an unknown host", async () => {
    const { counted, record } = recorder();

    await request(countingRenderer(record)).get("/").set("Host", "nobody.example.test").set("User-Agent", browser);

    expect(counted).toEqual([]);
  });

  it("leaves crawlers and agentless requests out of a customer's numbers", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const { counted, record } = recorder();
    const app = countingRenderer(record);

    await request(app).get("/").set("Host", "alpha.example.test").set("User-Agent", "Googlebot/2.1");
    await request(app).get("/").set("Host", "alpha.example.test").set("User-Agent", "curl/8.4.0");
    await request(app).get("/").set("Host", "alpha.example.test").set("User-Agent", "");

    expect(counted).toEqual([]);
  });

  it("renders exactly the same page whether or not counting is wired", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const { record } = recorder();

    const counted = await request(countingRenderer(record)).get("/").set("Host", "alpha.example.test");
    const plain = await request(renderer()).get("/").set("Host", "alpha.example.test");

    expect(counted.status).toBe(plain.status);
    expect(counted.text).toBe(plain.text);
  });
});

describe("the analytics content-security policy", () => {
  it("changes nothing for a site that does not carry the tracker", async () => {
    // Analytics is disabled by default, so shipping the feature must not alter one byte of the
    // policy every existing published site is served under.
    await liveSite(A, "Alpha", "alpha.example.test");
    const response = await request(renderer()).get("/").set("Host", "alpha.example.test");

    expect(response.headers["content-security-policy"]).toBe(PUBLISHED_SITE_CSP);
    expect(PUBLISHED_SITE_CSP).toContain("script-src 'none'");
    expect(PUBLISHED_SITE_CSP).not.toContain("connect-src");
  });

  it("admits the tracker and its beacon, and nothing else", () => {
    expect(PUBLISHED_SITE_CSP_WITH_ANALYTICS).toContain("script-src 'self'");
    // Without this the tracker loads and then silently fails: `default-src 'none'` blocks fetch and
    // sendBeacon whatever `script-src` permits.
    expect(PUBLISHED_SITE_CSP_WITH_ANALYTICS).toContain("connect-src 'self'");
  });

  it("admits no inline script and no external origin", () => {
    const scriptDirectives = PUBLISHED_SITE_CSP_WITH_ANALYTICS.split("; ").filter((directive) =>
      directive.startsWith("script-src") || directive.startsWith("connect-src"),
    );

    for (const directive of scriptDirectives) {
      expect(directive).not.toContain("unsafe-inline");
      expect(directive).not.toContain("unsafe-eval");
      expect(directive).not.toContain("http");
      expect(directive).not.toContain("*");
    }
  });

  it("keeps every other directive exactly as the default policy has them", () => {
    const without = (policy: string) =>
      policy
        .split("; ")
        .filter((directive) => !directive.startsWith("script-src") && !directive.startsWith("connect-src"));

    expect(without(PUBLISHED_SITE_CSP_WITH_ANALYTICS)).toEqual(without(PUBLISHED_SITE_CSP));
    // Named explicitly because heatmaps were specified to frame the published page, and do not.
    expect(PUBLISHED_SITE_CSP_WITH_ANALYTICS).toContain("frame-ancestors 'none'");
  });
});

describe("analytics identity in published markup", () => {
  it("identifies the page, every section, and every button", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const response = await request(renderer()).get("/").set("Host", "alpha.example.test");

    expect(response.text).toContain("data-page-id=");
    expect(response.text).toContain("data-section-id=");
  });

  it("carries an element id in a section that is not free-positioned", async () => {
    // The regression this guards: the id used to live on the free-layout positioning wrapper, so a
    // button in a flex or grid section rendered anonymously and its clicks could not be attributed.
    const projectId = await liveSite(A, "Alpha", "alpha.example.test");
    const project = await projects.findById(A, projectId);
    if (project === null) throw new Error("the fixture project disappeared");

    const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = project;
    const page = document.pages[0]!;
    page.sections[0]!.layoutMode = "flex";
    page.sections[0]!.elements = [
      {
        id: "button-in-flow",
        name: "Call to action",
        type: "button",
        text: "Read more",
        link: { kind: "external", url: "https://example.test/" },
        geometry: { x: 0, y: 0, width: 200, height: 48, rotation: 0 },
        responsiveLayout: {
          width: { value: 200, unit: "px" },
          height: { value: 48, unit: "px" },
          horizontalConstraint: "left",
          verticalConstraint: "top",
          visible: true,
        },
        zIndex: 1,
        locked: false,
        hidden: false,
        style: {
          fontSize: { value: 16, unit: "px" },
          fontWeight: 600,
          textColor: "#ffffff",
          backgroundColor: "#2f6df6",
          borderRadius: 8,
          horizontalAlign: "center",
        },
      } as never,
    ];

    const saved = await projects.saveDocument(A, projectId, revision, document as never);
    if (saved === null) throw new Error("saveDocument rejected the flex-section fixture");
    const published = await service.publish(A, projectId);
    if (published.status !== "published") throw new Error(`publishing returned ${published.status}`);
    resolver.invalidateAll();

    const response = await request(renderer()).get("/").set("Host", "alpha.example.test");

    expect(response.text).toContain('data-element-id="button-in-flow"');
    // Exactly one carrier, so a click is counted once rather than by both a wrapper and its child.
    expect(response.text.match(/data-element-id="button-in-flow"/g)).toHaveLength(1);
  });
});

describe("responsive published output", () => {
  it("carries the page's compiled stylesheet, not positions computed at one width", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const response = await request(renderer()).get("/").set("Host", "alpha.example.test");

    // The rules that make the page respond. Their absence is what used to send elements off the
    // side of a phone with nothing to bring them back.
    expect(response.text).toContain("data-page-id=");
    expect(response.text).toContain("box-sizing:border-box");
    expect(response.text).toContain("body{margin:0}");
  });

  it("ships no script to repair the layout after paint", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const response = await request(renderer()).get("/").set("Host", "alpha.example.test");

    // Responsiveness is in the first bytes the browser reads. A page that measures itself and moves
    // things afterwards is a page that visibly jumps, and one that does nothing at all without
    // JavaScript.
    expect(response.text).not.toContain("<script");
    expect(response.headers["content-security-policy"]).toContain("script-src 'none'");
  });

  it("never hides overflow to make a broken layout look fixed", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const response = await request(renderer()).get("/").set("Host", "alpha.example.test");

    expect(response.text).not.toContain("overflow-x:hidden");
    expect(response.text).not.toContain("overflow:hidden");
  });

  it("places a far-right element inside a phone once the document has been migrated", async () => {
    const projectId = await liveSite(A, "Alpha", "alpha.example.test");
    const project = await projects.findById(A, projectId);
    if (project === null) throw new Error("the fixture project disappeared");

    const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = project;
    document.pages[0]!.sections[0] = {
      ...document.pages[0]!.sections[0]!,
      layoutMode: "free",
      elements: [fixtureButton({ id: "far-right", x: 1100, y: 40, width: 280 }) as never],
    };

    const saved = await projects.saveDocument(A, projectId, revision, document as never);
    if (saved === null) throw new Error("saveDocument rejected the responsive fixture");
    const published = await service.publish(A, projectId);
    if (published.status !== "published") throw new Error(`publishing returned ${published.status}`);
    resolver.invalidateAll();

    const response = await request(renderer()).get("/").set("Host", "alpha.example.test");

    // Desktop keeps what the author drew, and the phone gets a rule that brings it back on screen.
    expect(response.text).toContain("left:1100px");
    expect(response.text).toMatch(/@media \(max-width:640px\)\{[^}]*left:16px/);
  });
});
