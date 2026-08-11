import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * The tracker, in a real browser, on a real published page.
 *
 * Everything here is observed from outside: what the page requests, and what those requests
 * contain. Nothing reaches into the tracker's internals, because what matters is exactly what a
 * visitor's browser sends and what a customer's page does while it happens.
 */

const RENDERER = "http://localhost:3001";
const TRACKED = "http://e2e-tracked.localhost:3001";
const CONSENT = "http://e2e-consent.localhost:3001";
const UNTRACKED = "http://e2e-site.localhost:3001";

type Batch = { events: Array<{ type: string; [key: string]: unknown }>; [key: string]: unknown };

/** Collects every batch the page sends, decoded. */
function collectBatches(page: Page): Batch[] {
  const batches: Batch[] = [];
  page.on("request", (request: Request) => {
    if (!request.url().includes("/__wb/events")) return;
    try {
      batches.push(JSON.parse(request.postData() ?? "{}") as Batch);
    } catch {
      batches.push({ events: [], unparsed: true });
    }
  });
  return batches;
}

const eventTypes = (batches: Batch[]) => batches.flatMap((batch) => batch.events.map((event) => event.type));

async function waitForBatch(batches: Batch[], matching: (types: string[]) => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (matching(eventTypes(batches))) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

test.describe("a site that measures", () => {
  test("loads the tracker from its own origin and reports a page view", async ({ page }) => {
    const batches = collectBatches(page);
    await page.goto(TRACKED);

    expect(await waitForBatch(batches, (types) => types.includes("page_view"))).toBe(true);

    const batch = batches[0]!;
    expect(batch["path"]).toBe("/");
    expect(batch["schemaVersion"]).toBe(1);
    // Identity the server assigns is absent from what the browser sends.
    expect(batch).not.toHaveProperty("workspaceId");
    expect(batch).not.toHaveProperty("projectId");
    expect(batch).not.toHaveProperty("pageId");
  });

  test("requests nothing from anywhere but the site itself", async ({ page }) => {
    const hosts = new Set<string>();
    page.on("request", (request) => hosts.add(new URL(request.url()).host));

    await page.goto(TRACKED);
    await page.waitForTimeout(2_500);

    // A published page that reached a third party would be a promise broken on the visitor's
    // behalf, whatever the third party did with it.
    expect([...hosts]).toEqual(["e2e-tracked.localhost:3001"]);
  });

  test("reports scroll depth as it is reached, and only once each", async ({ page }) => {
    const batches = collectBatches(page);
    await page.goto(TRACKED);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(500);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(await waitForBatch(batches, (types) => types.includes("scroll_depth"))).toBe(true);

    const depths = batches
      .flatMap((batch) => batch.events)
      .filter((event) => event.type === "scroll_depth")
      .map((event) => event["percent"]);
    // Reaching the bottom twice is one visit that reached the bottom, not two.
    expect(new Set(depths).size).toBe(depths.length);
  });

  test("attributes a click to the element that carries an id", async ({ page }) => {
    const batches = collectBatches(page);
    await page.goto(TRACKED);

    // The element under test is a link, and following it would unload the page before anything
    // could be observed. Cancelling the navigation leaves the click itself untouched, which is what
    // the tracker listens for.
    await page.evaluate(() => addEventListener("click", (event) => event.preventDefault(), true));
    await page.locator('[data-element-id="cta-primary"]').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(await waitForBatch(batches, (types) => types.includes("element_click"))).toBe(true);

    const events = batches.flatMap((batch) => batch.events);
    const element = events.find((event) => event.type === "element_click");
    const region = events.find((event) => event.type === "page_region_click");

    expect(element?.["elementId"]).toBe("cta-primary");
    // Both are sent; the server counts the interaction once, from the region.
    expect(region).toBeDefined();
    expect(Number(region?.["x"])).toBeGreaterThanOrEqual(0);
    expect(Number(region?.["x"])).toBeLessThanOrEqual(1);
  });

  test("reports Web Vitals the browser could measure", async ({ page }) => {
    const batches = collectBatches(page);
    await page.goto(TRACKED);
    await page.waitForTimeout(2_500);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(await waitForBatch(batches, (types) => types.includes("web_vital"))).toBe(true);

    const metrics = batches
      .flatMap((batch) => batch.events)
      .filter((event) => event.type === "web_vital")
      .map((event) => event["metric"]);
    // Which ones arrive depends on the browser and the interaction; what must never happen is a
    // metric arriving as zero because it could not be measured.
    expect(metrics.length).toBeGreaterThan(0);
    for (const event of batches.flatMap((batch) => batch.events).filter((event) => event.type === "web_vital")) {
      expect(typeof event["value"]).toBe("number");
    }
  });

  test("sends nothing while the tab is hidden", async ({ page }) => {
    const batches = collectBatches(page);
    await page.goto(TRACKED);
    await waitForBatch(batches, (types) => types.includes("page_view"));

    const before = batches.length;
    // The tracker accumulates engaged time only while the page is visible; a tab left open is not
    // someone reading.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(1_000);
    const afterHide = batches.length;

    await page.waitForTimeout(2_000);
    expect(batches.length).toBe(afterHide);
    expect(afterHide).toBeGreaterThanOrEqual(before);
  });
});

test.describe("a site that asks first", () => {
  test("collects nothing before an answer", async ({ page }) => {
    const batches = collectBatches(page);
    await page.goto(CONSENT);
    await page.waitForTimeout(2_500);

    expect(batches).toEqual([]);
    await expect(page.locator("#wb-consent")).toBeVisible();
    // Nor is anything stored: a visitor who has not answered leaves no trace at all.
    const stored = await page.evaluate(() => ({
      session: window.sessionStorage.length,
      local: window.localStorage.length,
    }));
    expect(stored).toEqual({ session: 0, local: 0 });
  });

  test("shows a prompt whose two answers are equally easy to give", async ({ page }) => {
    await page.goto(CONSENT);

    const prompt = page.locator("#wb-consent");
    await expect(prompt).toBeVisible();
    const accept = prompt.locator('[data-wb-consent="accept"]');
    const decline = prompt.locator('[data-wb-consent="decline"]');

    // Same element, same treatment. A prompt where declining is a link and accepting is a button is
    // not offering a choice.
    await expect(accept).toBeVisible();
    await expect(decline).toBeVisible();
    expect(await accept.evaluate((node) => node.tagName)).toBe(await decline.evaluate((node) => node.tagName));
  });

  test("does not move the page to ask", async ({ page }) => {
    await page.goto(CONSENT);
    await expect(page.locator("#wb-consent")).toBeVisible();

    // Fixed to the viewport rather than inserted into the flow: asking a question on the product's
    // own behalf must not shift a customer's content under their visitor's finger.
    const position = await page.locator("#wb-consent").evaluate((node) => getComputedStyle(node).position);
    expect(position).toBe("fixed");
  });

  test("collects once the prompt is accepted, and stops when it is withdrawn", async ({ page }) => {
    const batches = collectBatches(page);
    await page.goto(CONSENT);
    await page.locator('[data-wb-consent="accept"]').click();
    expect(await waitForBatch(batches, (types) => types.includes("page_view"))).toBe(true);

    await page.evaluate(() => (window as unknown as { wbAnalytics: { deny: () => void } }).wbAnalytics.deny());
    const afterDeny = batches.length;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1_000);

    expect(batches.length).toBe(afterDeny);
  });

  test("remembers a refusal across page loads", async ({ page }) => {
    await page.goto(CONSENT);
    await page.locator('[data-wb-consent="decline"]').click();

    const batches = collectBatches(page);
    await page.goto(CONSENT);
    await page.waitForTimeout(2_000);

    // Asking again after someone said no is asking until they say yes.
    expect(batches).toEqual([]);
    await expect(page.locator("#wb-consent")).toBeHidden();
  });
});

test.describe("a site that does not measure", () => {
  test("shows no consent prompt, because there is nothing to consent to", async ({ page }) => {
    await page.goto(UNTRACKED);
    await expect(page.locator("#wb-consent")).toHaveCount(0);
  });

  test("loads no tracker and requests nothing", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    await page.goto(UNTRACKED);
    await page.waitForTimeout(1_500);

    expect(requests.filter((url) => url.includes("/__wb/"))).toEqual([]);
    expect(await page.locator("script").count()).toBe(0);
  });
});

test.describe("the site itself", () => {
  test("works with JavaScript disabled", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto(TRACKED);
    await expect(page.getByRole("heading", { name: "Published by the E2E fixture" })).toBeVisible();

    await context.close();
  });

  test("works when the tracker cannot be fetched at all", async ({ page }) => {
    // What an ad blocker does. The page must not notice.
    await page.route("**/__wb/a.js", (route) => route.abort());
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(TRACKED);

    await expect(page.getByRole("heading", { name: "Published by the E2E fixture" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("works when ingestion is failing", async ({ page }) => {
    await page.route("**/__wb/events", (route) => route.fulfill({ status: 500, body: "" }));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(TRACKED);
    await page.waitForTimeout(2_500);

    await expect(page.getByRole("heading", { name: "Published by the E2E fixture" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("the tracker asset", () => {
  test("is cacheable forever and served as JavaScript", async ({ request }) => {
    const response = await request.get(`${RENDERER}/__wb/a.js`, { headers: { Host: "e2e-tracked.localhost" } });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("javascript");
    expect(response.headers()["cache-control"]).toContain("immutable");
  });
});
