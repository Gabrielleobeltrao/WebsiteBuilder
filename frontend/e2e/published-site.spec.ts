import { expect, test } from "@playwright/test";

/**
 * The published site, served by the public renderer on its own hostname.
 *
 * This is the only project that exercises what a visitor receives rather than what an operator does,
 * and it exists because nothing else could: the application's own E2E projects talk to the API and
 * the built frontend, neither of which serves a customer's page.
 */
test.describe("a published page", () => {
  test("is served by the renderer on the site's own hostname", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Published by the E2E fixture" })).toBeVisible();
    await expect(page).toHaveTitle(/E2E home/);
  });

  test("ships no JavaScript while analytics is disabled", async ({ page }) => {
    const response = await page.goto("/");

    // The default for every existing site. When the tracker is injected this becomes `'self'`, and
    // only for pages that carry it.
    expect(response?.headers()["content-security-policy"]).toContain("script-src 'none'");
    expect(await page.locator("script").count()).toBe(0);
  });

  test("carries the identity analytics needs to attribute behaviour", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("[data-page-id]")).toHaveCount(1);
    expect(await page.locator("[data-section-id]").count()).toBeGreaterThan(1);
    // A button, so a click has something stable to be attributed to.
    await expect(page.locator('[data-element-id="cta-primary"]')).toHaveCount(1);
  });

  test("serves a second route and refuses one that was never published", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByRole("heading", { name: "About the fixture" })).toBeVisible();

    const missing = await page.goto("/never-published");
    expect(missing?.status()).toBe(404);
  });

  test("is tall enough for scrolling to be observable", async ({ page }) => {
    await page.goto("/");

    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight * 2,
    );
    expect(scrollable).toBe(true);
  });
});
