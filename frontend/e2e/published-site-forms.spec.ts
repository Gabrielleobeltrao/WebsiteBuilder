import { expect, test } from "@playwright/test";

/**
 * The form fixture lives on its own hostname, so the script-free site stays script-free.
 *
 * Written out rather than imported from the seed: importing that module here would run it, and it
 * opens a database. The other published-site specs name their hosts the same way.
 */
const HOME = "http://e2e-form.localhost:3001/";

/**
 * A visitor filling in a form on a published site.
 *
 * The whole point of these is the two paths: the page has to work with the runtime and without it,
 * and the version without it is the one that must never break — it is what a visitor gets on a slow
 * connection, behind a corporate proxy, or in a browser where the script failed.
 */
test.describe("a published form", () => {
  test("arrives complete, before any script runs", async ({ page }) => {
    await page.goto(HOME);

    const form = page.locator("form[data-wb-form]");
    await expect(form).toHaveAttribute("method", "post");
    await expect(form).toHaveAttribute("action", /\/__wb\/forms\/[a-f0-9]{24}\/submissions$/);

    // The questions themselves, addressable by their labels.
    await expect(page.getByLabel(/Your name/)).toBeVisible();
    await expect(page.getByLabel(/^Email/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  test("sends an answer and says so, with JavaScript", async ({ page }) => {
    await page.goto(HOME);

    await page.getByLabel(/Your name/).fill("Ana");
    await page.getByLabel(/^Email/).fill("ana@example.test");
    await page.getByLabel(/Message/).fill("Hello from the browser.");
    await page.getByRole("button", { name: "Send message" }).click();

    // Answered in place: the page does not move and the outcome is announced where focus is.
    await expect(page.locator("[data-wb-form-status]")).toContainText("Thank you", { timeout: 10_000 });
    await expect(page.getByLabel(/Your name/)).toHaveValue("");
  });

  test("sends an answer with JavaScript disabled", async ({ browser }) => {
    // The path that must never break. A form that only works once a script has loaded is a form
    // that silently loses answers.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto(HOME);
    await page.getByLabel(/Your name/).fill("Bruno");
    await page.getByLabel(/^Email/).fill("bruno@example.test");
    await page.getByRole("button", { name: "Send message" }).click();

    await page.waitForURL(/wb_form_ok=/);
    await expect(page.locator("[data-wb-form-status]")).toContainText("Thank you");

    await context.close();
  });

  test("is refused by the browser before it ever reaches the network", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto(HOME);
    // Only half the required answers. `required` is markup, not script, so this holds with
    // JavaScript disabled — which is why the required rules are rendered as attributes rather than
    // enforced by the runtime.
    await page.getByLabel(/Your name/).fill("Carla");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page).not.toHaveURL(/wb_form_/);
    const valid = await page.locator("form[data-wb-form]").evaluate((form) => (form as HTMLFormElement).checkValidity());
    expect(valid).toBe(false);

    await context.close();
  });

  test("stays inside the viewport on a phone", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(HOME);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // A form is the block most likely to be given a fixed width on a 1440 canvas and then rendered
    // on a phone, so this is the block worth checking.
    expect(overflow).toBeLessThanOrEqual(1);

    await context.close();
  });
});
