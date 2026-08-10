import { expect, test } from "@playwright/test";

test.describe("public shell", () => {
  // The persistent sidebar is the desktop presentation; the phone drawer is covered below.
  test.use({ viewport: { width: 1280, height: 900 } });

  test("navigates between Home and Roadmap and keeps one navigation shell", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.getByRole("link", { name: "See the roadmap" }).click();
    await expect(page).toHaveURL(/\/roadmap$/);
    await expect(page.getByRole("heading", { level: 1, name: "Product roadmap" })).toBeVisible();

    await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(1);
  });

  test("filters the roadmap by status", async ({ page }) => {
    await page.goto("/roadmap");
    await page.getByRole("button", { name: "Released", exact: true }).click();
    await expect(page.getByRole("button", { name: "Released", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText("Real-time collaboration")).toHaveCount(0);
  });

  test("switches the interface language and keeps it after a reload", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Change language").first().selectOption("pt-BR");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Desenhe a página. Mantenha o controle.");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Desenhe a página. Mantenha o controle.");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  });

  test("sends an unauthenticated visitor from /app to login", async ({ page }) => {
    await page.goto("/app/w1/sites");
    await expect(page).toHaveURL(/\/login\?returnTo=/);
  });
});

test.describe("public shell on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens the navigation drawer, closes it with Escape and restores focus", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Open menu" });
    await trigger.click();

    const drawer = page.getByRole("dialog", { name: "Main navigation" });
    await expect(drawer).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("switches language from the drawer", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();

    const drawer = page.getByRole("dialog", { name: "Main navigation" });
    await drawer.getByLabel("Change language").selectOption("pt-BR");

    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Desenhe a página. Mantenha o controle.");
  });

  test("has no horizontal overflow at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
