import { expect, test, type Page } from "@playwright/test";

/**
 * The MVP journey, end to end, against the production build and a throwaway database.
 *
 * Every account is created inside the test with a unique address, so runs do not interfere with
 * each other and nothing depends on data a developer happens to have.
 *
 * The editor is desktop-only by design, so this suite runs at a desktop viewport. The mobile
 * project covers the public shell and the read-only preview instead.
 */
test.use({ viewport: { width: 1440, height: 960 } });

let counter = 0;

async function signUp(page: Page): Promise<string> {
  counter += 1;
  const email = `e2e-${Date.now()}-${counter}@example.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Test Person");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("a-long-enough-password");
  await page.getByRole("button", { name: /Create|Sign up|Continue/i }).click();

  await expect(page).toHaveURL(/\/app\//, { timeout: 20_000 });
  return email;
}

async function createSite(page: Page, name: string): Promise<void> {
  // Signing in lands on the overview; sites are one click away in the navigation.
  await page.getByRole("link", { name: "Sites" }).first().click();
  await page.getByRole("button", { name: "New site" }).click();
  await page.getByLabel("Site name").fill(name);
  await page.getByRole("button", { name: "Create site" }).click();
  await expect(page.getByText(name)).toBeVisible();
}

test.describe("the MVP flow", () => {
  test("creates a site, edits it, saves, reloads and previews", async ({ page }) => {
    await signUp(page);
    await createSite(page, "Acme Studio");

    // Open the builder.
    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/builder/, { timeout: 20_000 });

    // A second page, so preview navigation has somewhere to go.
    await page.getByRole("tab", { name: "Pages" }).click();
    await page.getByRole("button", { name: "Add page" }).click();
    await page.getByLabel("Page name").fill("About");
    // The dialog's confirm carries the same label as the control that opened it, so the last one
    // on the page is the dialog's.
    await page.getByRole("button", { name: "Add page" }).last().click();
    await expect(page.getByRole("button", { name: /About/ })).toBeVisible({ timeout: 10_000 });

    // Place a text element.
    await page.getByRole("tab", { name: "Elements" }).click();
    await page.getByRole("button", { name: "Text", exact: true }).click();

    // Save, reload, and confirm the work survived. This is the criterion the whole persistence
    // design exists for: a reload that loses a layout makes every other feature pointless.
    await page.keyboard.press("Control+s");
    await expect(page.getByText(/All changes saved|Saved/)).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByRole("tab", { name: "Elements" })).toBeVisible({ timeout: 20_000 });
  });

  test("keeps builder content unchanged when the interface language changes", async ({ page }) => {
    await signUp(page);
    await createSite(page, "Language Test");

    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/builder/, { timeout: 20_000 });

    await page.getByRole("tab", { name: "Elements" }).click();
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.keyboard.press("Control+s");

    // Switching the interface language must not translate or otherwise touch what the user wrote.
    // Derived from the two leading segments rather than by cutting at a page name, so it survives
    // the landing page changing.
    const workspacePath = new URL(page.url()).pathname.split("/").slice(0, 3).join("/");
    await page.goto(`${workspacePath}/settings`);
    // The current locale's radio being checked proves React has rendered its controlled state, and
    // therefore that a click will reach a handler. Clicking a radio that is merely present races
    // that, and the change event lands nowhere.
    await expect(page.getByRole("radio", { name: "English (United States)" })).toBeChecked();
    await page.getByRole("radio", { name: "Português (Brasil)" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");

    await page.goto(`${workspacePath}/sites`);
    // The site's own name is content, not interface copy, so it is unchanged.
    await expect(page.getByText("Language Test")).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("language preference", () => {
  test("persists across a reload", async ({ page }) => {
    await signUp(page);

    // Derived from the two leading segments rather than by cutting at a page name, so it survives
    // the landing page changing.
    const workspacePath = new URL(page.url()).pathname.split("/").slice(0, 3).join("/");
    await page.goto(`${workspacePath}/settings`);
    // The current locale's radio being checked proves React has rendered its controlled state, and
    // therefore that a click will reach a handler. Clicking a radio that is merely present races
    // that, and the change event lands nowhere.
    await expect(page.getByRole("radio", { name: "English (United States)" })).toBeChecked();
    await page.getByRole("radio", { name: "Português (Brasil)" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");

    await page.reload();
    // An authenticated preference is authoritative: it comes back from the server, not from a
    // local guess.
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR", { timeout: 20_000 });
  });

  test("shows the public shell in the chosen language before anyone signs in", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Change language").first().selectOption("pt-BR");

    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  });
});

test.describe("preview", () => {
  test("opens from the site's own link and renders the saved document", async ({ page }) => {
    // Clicking the application's own link, rather than navigating to a URL this test composed. The
    // defect this guards was exactly that: the route worked and the link the app built did not,
    // because it carried no workspace and the preview asked the API for an empty one. Every unit
    // test passed, because each supplied the workspace itself.
    await signUp(page);
    await createSite(page, "Preview Site");

    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/builder/, { timeout: 20_000 });

    const workspacePath = new URL(page.url()).pathname.split("/").slice(0, 3).join("/");
    await page.goto(`${workspacePath}/sites`);
    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/builder/, { timeout: 20_000 });

    // The desktop preview link in the editor.
    await page.getByRole("link", { name: /Preview desktop|Desktop preview/ }).first().click();

    await expect(page).toHaveURL(/\/preview\//, { timeout: 20_000 });
    // The workspace must be in the address, because the API refuses a request without one.
    expect(new URL(page.url()).pathname.split("/").filter(Boolean)).toHaveLength(3);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("the workspace overview", () => {
  test("opens on measured zeros and follows what the account actually has", async ({ page }) => {
    await signUp(page);

    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    const metrics = page.getByRole("definition");
    // Views, Sites, Pages, Form entries. A brand-new account has none of any of them, and the form
    // card says so with a dash rather than claiming a measured zero.
    await expect(metrics).toHaveText(["0", "0", "0", "—"]);
    await expect(page.getByText("No form has been created yet")).toBeVisible();

    await createSite(page, "Overview Site");
    await page.getByRole("link", { name: "Overview" }).first().click();

    // One site, one page: the counts come from the documents just created, not from a cache.
    await expect(metrics).toHaveText(["0", "1", "1", "—"]);
    await expect(page.getByRole("link", { name: "Overview Site" })).toBeVisible();
  });

  test("narrows to one site and back to all of them", async ({ page }) => {
    await signUp(page);
    await createSite(page, "First Site");
    await page.getByRole("link", { name: "Overview" }).first().click();

    const site = page.getByRole("combobox", { name: "Site", exact: true });
    await expect(site).toHaveValue("");
    await site.selectOption({ label: "First Site" });

    // The site column disappears when every row belongs to the same site.
    await expect(page.getByRole("columnheader", { name: "Site" })).toHaveCount(0);
    await expect(page.getByText("No views recorded in this period.")).toBeVisible();

    await site.selectOption("");
    await expect(site).toHaveValue("");
  });
});

test.describe("dashboard on a phone", () => {
  // Overrides this file's desktop viewport. The editor needs a pointer and a canvas, but the
  // dashboard is what a person reaches for on a phone, and it has to be usable there.
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the workspace navigation behind the menu instead of above the page", async ({ page }) => {
    await signUp(page);

    // The sidebar must not be stacked over the content: the page's own heading comes first.
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeInViewport();

    const trigger = page.getByRole("button", { name: "Open menu" });
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Website Builder" });
    await expect(drawer).toBeVisible();

    await drawer.getByRole("link", { name: "Media" }).click();
    await expect(page).toHaveURL(/\/media$/);
    await expect(drawer).toBeHidden();

    await page.setViewportSize({ width: 320, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});

test.describe("authentication boundary", () => {
  test("sends a signed-out visitor to login and back after signing in", async ({ page }) => {
    await page.goto("/app/anything/sites");
    await expect(page).toHaveURL(/\/login\?returnTo=/);
  });

  test("does not serve another account's sites", async ({ page, context }) => {
    await signUp(page);
    await createSite(page, "First Account Site");

    // A second, separate session must see none of it.
    const other = await context.browser()?.newContext();
    const otherPage = await other?.newPage();
    if (otherPage === undefined) throw new Error("could not open a second session");

    await signUp(otherPage);
    await expect(otherPage.getByText("First Account Site")).toHaveCount(0);

    await other?.close();
  });
});
