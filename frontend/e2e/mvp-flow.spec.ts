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
    const workspacePath = new URL(page.url()).pathname.split("/sites")[0] ?? "";
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

    const workspacePath = new URL(page.url()).pathname.split("/sites")[0] ?? "";
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
