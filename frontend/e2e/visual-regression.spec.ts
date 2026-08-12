import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

/**
 * Reference screenshots for the builder and the clean preview.
 *
 * What these catch is what no assertion states: a panel that overlaps the canvas, a rail that wraps,
 * a frame that stops being centred. They are deliberately few — a screenshot per surface per device,
 * not per state — because a suite nobody can review is a suite that gets approved blindly.
 *
 * Everything volatile is masked rather than tolerated: the save-state line carries a relative time
 * and the site name carries a run-specific suffix, and both would otherwise fail on every run for
 * reasons that have nothing to do with layout.
 */
test.use({ viewport: { width: 1440, height: 960 } });

/**
 * Unique across workers, not just within one.
 *
 * These specs run in parallel processes. A counter is per process and `Date.now()` collides when two
 * of them start in the same millisecond, so both would produce the same site name — and a site's
 * slug is claimed platform-wide, which makes the second one a refusal rather than a second site. The
 * card never appeared and the test read as a timing race it was not.
 */
const unique = () => randomUUID().slice(0, 8);

async function openBuilder(page: Page): Promise<void> {
  const run = unique();
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Screenshot Person");
  await page.getByLabel("Email").fill(`e2e-visual-${run}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("a-long-enough-password");
  await page.getByRole("button", { name: /Create|Sign up|Continue/i }).click();
  await expect(page).toHaveURL(/\/app\//, { timeout: 20_000 });

  // A site's slug becomes its subdomain, which is claimed platform-wide, so two accounts creating
  // the same name is a refusal rather than two sites. The name is masked in the screenshot, which is
  // what lets it vary.
  const site = `Screenshot Site ${run}`;
  await page.getByRole("link", { name: "Sites" }).first().click();
  await page.getByRole("button", { name: "New site" }).click();
  await page.getByLabel("Site name").fill(site);
  await page.getByRole("button", { name: "Create site" }).click();
  // The card has to exist before there is an "Open" on it; without this the click races the list.
  await expect(page.getByText(site)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "Open" }).first().click();
  await expect(page).toHaveURL(/\/builder/, { timeout: 20_000 });
  await expect(page.getByRole("tab", { name: "Add elements" })).toBeVisible({ timeout: 20_000 });
}

/** Volatile by design: a relative save time, and a site name that is unique per run. */
const masks = (page: Page) => [page.getByRole("status"), page.getByRole("heading", { level: 1 })];

const shot = { maxDiffPixelRatio: 0.02, animations: "disabled" as const };

test.describe("the builder", () => {
  for (const device of ["Desktop", "Tablet", "Mobile"] as const) {
    test(`looks the same on ${device}`, async ({ page }) => {
      await openBuilder(page);
      await page.getByRole("button", { name: new RegExp(`^${device}`) }).click();

      await expect(page).toHaveScreenshot(`builder-${device.toLowerCase()}.png`, {
        ...shot,
        mask: masks(page),
      });
    });
  }
});

test.describe("the clean preview", () => {
  for (const device of ["Desktop", "Tablet", "Mobile"] as const) {
    test(`looks the same on ${device}`, async ({ page }) => {
      await openBuilder(page);
      await page.getByRole("link", { name: "Preview" }).click();
      await expect(page).toHaveURL(/\/preview\//, { timeout: 20_000 });

      await page.getByRole("button", { name: device, exact: true }).click();
      await expect(page.locator('iframe[title="Site preview"]')).toBeVisible();

      await expect(page).toHaveScreenshot(`preview-${device.toLowerCase()}.png`, shot);
    });
  }
});
