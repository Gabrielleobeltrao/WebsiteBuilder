import { expect, test, type Page } from "@playwright/test";

/**
 * Finding the blog, writing a post, and getting it onto the site.
 *
 * This is the journey the whole plan exists for. Every step of it was reachable only by somebody who
 * already knew where to click: the blog was a footer link on a site that did not have one yet, a
 * post could not be marked as anything but a draft, and a template preview opened the home page.
 *
 * The editor is desktop-only by design, so this runs at a desktop viewport.
 */
test.use({ viewport: { width: 1440, height: 960 } });

let counter = 0;

async function signUp(page: Page): Promise<void> {
  counter += 1;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Test Person");
  await page.getByLabel("Email").fill(`e2e-blog-${Date.now()}-${counter}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("a-long-enough-password");
  await page.getByRole("button", { name: /Create|Sign up|Continue/i }).click();
  await expect(page).toHaveURL(/\/app\//, { timeout: 20_000 });
}

async function createSite(page: Page, name: string): Promise<void> {
  await page.getByRole("link", { name: "Sites" }).first().click();
  await page.getByRole("button", { name: "New site" }).click();
  await page.getByLabel("Site name").fill(name);
  await page.getByRole("button", { name: "Create site" }).click();
  await expect(page.getByText(name)).toBeVisible();
}

test.describe("finding and using the blog", () => {
  test("reaches the blog from the site's own dashboard, without knowing a URL", async ({ page }) => {
    await signUp(page);
    await createSite(page, "Blog Site");

    // The card's one destination, then the grid. Nothing here requires scrolling past settings, and
    // nothing requires having a blog already — which was exactly the site whose owner was asking.
    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });

    const grid = page.getByRole("navigation", { name: "Everything in this site" });
    await expect(grid.getByRole("link", { name: /Blog/ })).toBeVisible();
    await expect(grid.getByRole("link", { name: /Blog/ })).toContainText("Not in use yet");

    await grid.getByRole("link", { name: /Blog/ }).click();
    await expect(page).toHaveURL(/\/blog$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 2, name: "This site has no blog yet" })).toBeVisible();
  });

  test("writes a post, publishes it, and sees it on the published site", async ({ page }) => {
    await signUp(page);
    await createSite(page, "Blog Site");

    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await page.getByRole("navigation", { name: "Everything in this site" }).getByRole("link", { name: /Blog/ }).click();

    // Turning it on is an explicit choice with a format, never a side effect of arriving.
    await page.getByRole("radio", { name: "List" }).check();
    await page.getByRole("button", { name: "Turn on the blog" }).click();
    await expect(page.getByRole("link", { name: "New post" })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("link", { name: "New post" }).click();
    await page.getByLabel("Title", { exact: true }).fill("Our first article");
    await page.getByLabel("Excerpt").fill("What we have been building.");

    // The control that did not exist: every post ever written stayed a draft, so a customer who
    // published their site correctly reported that their blog was empty.
    await page.getByRole("radio", { name: "Published" }).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("link", { name: "Back to posts" }).click();
    const row = page.getByRole("region", { name: "Posts" }).getByRole("listitem").first();
    await expect(row).toContainText("Our first article");

    // The post is ready; the site has not published it. Two facts, said separately, because they
    // used to be one word and the word was wrong half the time.
    await expect(row).toContainText("The site has never been published");
  });

  test("designs the article layout and previews it against a sample post", async ({ page }) => {
    await signUp(page);
    await createSite(page, "Blog Site");

    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await page.getByRole("navigation", { name: "Everything in this site" }).getByRole("link", { name: /Blog/ }).click();
    await page.getByRole("radio", { name: "List" }).check();
    await page.getByRole("button", { name: "Turn on the blog" }).click();
    await expect(page.getByRole("link", { name: "New post" })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("region", { name: "Layouts" }).getByRole("link", { name: /Post layout/ }).click();
    await expect(page).toHaveURL(/\/templates\/article$/, { timeout: 20_000 });

    // Preview used to open the site's home page from here, answering a question nobody asked.
    await page.getByRole("link", { name: "Preview" }).click();
    await expect(page).toHaveURL(/template=article/, { timeout: 20_000 });
    await expect(page.getByRole("status")).toContainText(/Sample content/i);

    // The same three widths as any other preview, and the layout stays the thing being previewed.
    await page.getByRole("button", { name: "Mobile" }).click();
    await expect(page.locator("iframe")).toHaveAttribute("src", /blog-template\/article/);
  });
});
