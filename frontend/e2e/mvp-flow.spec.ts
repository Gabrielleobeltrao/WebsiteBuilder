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
    await page.getByRole("tab", { name: "Add elements" }).click();
    await page.getByRole("button", { name: "Text", exact: true }).click();

    // Save, reload, and confirm the work survived. This is the criterion the whole persistence
    // design exists for: a reload that loses a layout makes every other feature pointless.
    await page.keyboard.press("Control+s");
    await expect(page.getByText(/All changes saved|Saved/)).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByRole("tab", { name: "Add elements" })).toBeVisible({ timeout: 20_000 });
  });

  test("keeps builder content unchanged when the interface language changes", async ({ page }) => {
    await signUp(page);
    await createSite(page, "Language Test");

    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/builder/, { timeout: 20_000 });

    await page.getByRole("tab", { name: "Add elements" }).click();
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
    // The card has to have rendered before its link is clicked: the list loads asynchronously, and
    // clicking during that render resolves the point to whatever occupied it a moment earlier.
    await expect(page.getByText("Preview Site")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/builder/, { timeout: 20_000 });
    await expect(page.getByRole("tab", { name: "Add elements" })).toBeVisible({ timeout: 20_000 });

    // The preview link in the editor. There is one, not one per device.
    await expect(page.getByRole("link", { name: /preview/i })).toHaveCount(1);
    await page.getByRole("link", { name: "Preview" }).click();

    await expect(page).toHaveURL(/\/preview\//, { timeout: 20_000 });
    // The workspace must be in the address, because the API refuses a request without one.
    expect(new URL(page.url()).pathname.split("/").filter(Boolean)).toHaveLength(3);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("previews each device at its exact viewport, scaled to fit the screen", async ({ page }) => {
    await signUp(page);
    await createSite(page, "Viewport Test");

    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/builder/, { timeout: 20_000 });
    await page.getByRole("link", { name: "Preview" }).click();
    await expect(page).toHaveURL(/\/preview\//, { timeout: 20_000 });

    const frame = page.locator('iframe[title="Site preview"]');
    await expect(frame).toBeVisible({ timeout: 20_000 });

    for (const [device, width] of [
      ["Desktop", 1440],
      ["Tablet", 768],
      ["Mobile", 390],
    ] as const) {
      await page.getByRole("button", { name: device, exact: true }).click();

      // The frame's own layout viewport, measured inside it. This is the whole point of the frame:
      // media queries have to resolve against a real device width, not a scaled box.
      await expect
        .poll(async () => page.frameLocator('iframe[title="Site preview"]').locator("body").evaluate(() => window.innerWidth))
        .toBe(width);

      // ...while what the person sees fits the screen they are on.
      const box = await frame.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
  });

  test("keeps navigation between pages inside the preview", async ({ page }) => {
    await signUp(page);
    await createSite(page, "Navigation Test");

    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/builder/, { timeout: 20_000 });

    await page.getByRole("link", { name: "Preview" }).click();
    await expect(page).toHaveURL(/\/preview\//, { timeout: 20_000 });

    // The framed document is served by the authenticated draft route, so its address stays on the
    // API path — a link that navigated the application instead would leave preview entirely.
    const source = await page.locator('iframe[title="Site preview"]').getAttribute("src");
    expect(source).toContain("/publishing/preview");

    await page.getByRole("link", { name: "Back to the builder" }).click();
    await expect(page).toHaveURL(/\/builder/, { timeout: 20_000 });
  });
});

test.describe("building a page from the catalog", () => {
  test("finds a block by search, inserts it, and inserts a pattern", async ({ page }) => {
    await signUp(page);
    await createSite(page, "Catalog Site");

    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/builder/, { timeout: 20_000 });
    await page.getByRole("tab", { name: "Add elements" }).click();

    // Searching by a word that is not the block's name is the thing the catalog exists for.
    await page.getByRole("searchbox", { name: "Search blocks" }).fill("youtube");
    await page.getByRole("button", { name: "Video", exact: true }).click();

    // The block opens its own inspector, with its own fields.
    await expect(page.getByLabel("Video identifier")).toBeVisible();
    await page.getByLabel("Video identifier").fill("dQw4w9WgXcQ");

    // A pattern inserts ordinary blocks, which the structure tree then lists individually.
    await page.getByRole("tab", { name: "Add elements" }).click();
    await page.getByRole("tab", { name: "Patterns" }).click();
    await page.getByRole("button", { name: /^Hero / }).click();

    await page.getByRole("tab", { name: "Structure" }).click();
    const tree = page.getByRole("navigation", { name: "Page structure" });
    await expect(tree.getByRole("button", { name: "Button" })).toBeVisible();

    await page.keyboard.press("Control+s");
    await expect(page.getByText(/All changes saved|Saved/)).toBeVisible({ timeout: 20_000 });

    // Reload: what was inserted survives the round trip through the API.
    await page.reload();
    await expect(page.getByRole("tab", { name: "Add elements" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("tab", { name: "Structure" }).click();
    await expect(page.getByRole("navigation", { name: "Page structure" }).getByRole("button", { name: "Video" })).toBeVisible();
  });

  test("refuses to publish a page whose block cannot work, and says which", async ({ page }) => {
    await signUp(page);
    await createSite(page, "Readiness Site");

    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/builder/, { timeout: 20_000 });

    // A video with no identifier renders an empty frame, which reaches a visitor as a broken site.
    await page.getByRole("tab", { name: "Add elements" }).click();
    await page.getByRole("searchbox", { name: "Search blocks" }).fill("video");
    await page.getByRole("button", { name: "Video", exact: true }).click();
    await page.keyboard.press("Control+s");
    await expect(page.getByText(/All changes saved|Saved/)).toBeVisible({ timeout: 20_000 });

    const workspacePath = new URL(page.url()).pathname.split("/").slice(0, 3).join("/");
    const projectId = new URL(page.url()).pathname.split("/")[4];
    await page.goto(`${workspacePath}/sites/${projectId}/publish`);

    await expect(page.getByText(/no identifier/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /publish/i })).toBeDisabled();

    // And the finding is a way back to the field, not just a complaint.
    await page.getByRole("link", { name: "Open in builder" }).first().click();
    await expect(page).toHaveURL(/\/builder\//, { timeout: 20_000 });
    await expect(page.getByLabel("Video identifier")).toBeVisible();
  });
});

test.describe("previewing from a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows the desktop layout at its real width, scaled to fit the phone", async ({ page }) => {
    await signUp(page);

    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Sites" }).click();
    await page.getByRole("button", { name: "New site" }).click();
    await page.getByLabel("Site name").fill("Phone Preview");
    await page.getByRole("button", { name: "Create site" }).click();
    await expect(page.getByText("Phone Preview")).toBeVisible({ timeout: 20_000 });

    // The builder refuses to open on a phone, and offers preview instead. That is the route here.
    await page.getByRole("link", { name: "Open" }).first().click();
    await page.getByRole("link", { name: "Mobile preview" }).click();
    await expect(page).toHaveURL(/\/preview\//, { timeout: 20_000 });

    // A phone opens on the phone layout...
    await expect(page.getByRole("button", { name: "Mobile", exact: true })).toHaveAttribute("aria-pressed", "true");

    // ...and can still ask what the desktop layout looks like, which must report 1440 rather than
    // redefining the site as mobile because the host is small.
    await page.getByRole("button", { name: "Desktop", exact: true }).click();
    await expect
      .poll(async () =>
        page.frameLocator('iframe[title="Site preview"]').locator("body").evaluate(() => window.innerWidth),
      )
      .toBe(1440);

    const box = await page.locator('iframe[title="Site preview"]').boundingBox();
    expect(box).not.toBeNull();
    // Scaled down to fit the phone rather than overflowing it.
    expect(box!.width).toBeLessThanOrEqual(390);
  });

  test("mounts no way to change the document", async ({ page }) => {
    await signUp(page);

    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Sites" }).click();
    await page.getByRole("button", { name: "New site" }).click();
    await page.getByLabel("Site name").fill("Phone Read Only");
    await page.getByRole("button", { name: "Create site" }).click();
    await expect(page.getByText("Phone Read Only")).toBeVisible({ timeout: 20_000 });

    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/api/")) writes.push(request.url());
    });

    await page.getByRole("link", { name: "Open" }).first().click();
    await page.getByRole("link", { name: "Mobile preview" }).click();
    await expect(page).toHaveURL(/\/preview\//, { timeout: 20_000 });
    await page.getByRole("button", { name: "Tablet", exact: true }).click();

    expect(writes).toEqual([]);
  });
});

test.describe("reaching the live site from a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("says a new site is not published, and offers no address for it", async ({ page }) => {
    await signUp(page);

    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Sites" }).click();
    await page.getByRole("button", { name: "New site" }).click();
    await page.getByLabel("Site name").fill("Phone Site");
    await page.getByRole("button", { name: "Create site" }).click();
    await expect(page.getByText("Phone Site")).toBeVisible();

    // The state most customers see first, and the one a link would lie about.
    await expect(page.getByText(/Not published yet/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Visit site" })).toHaveCount(0);

    // And the action that changes it, one tap from the same card.
    await page.getByRole("link", { name: "Publish" }).first().click();
    await expect(page).toHaveURL(/\/publish$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Publish" })).toBeVisible();

    await page.getByRole("button", { name: "Publish now" }).click();
    // Publishing asks first, because visitors see the result immediately.
    await page.getByRole("dialog").getByRole("button", { name: "Yes, publish" }).click();

    // Publishing has to leave the site reachable. It used to move a pointer and stop there, so a
    // customer published successfully and their site was served from nowhere — and the list told
    // them it was not published at all.
    await expect(page.getByText(/phone-site\./)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("This site does not have a public address yet.")).toHaveCount(0);

    await page.goto(`${new URL(page.url()).pathname.split("/").slice(0, 3).join("/")}/sites`);
    await expect(page.getByRole("link", { name: "Visit site" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Not published yet/)).toHaveCount(0);
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
