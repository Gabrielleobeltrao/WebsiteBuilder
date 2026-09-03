import { expect, test } from "@playwright/test";

/**
 * The viewport matrix.
 *
 * The one question a responsive rendering has to answer is whether the page fits the screen, and it
 * cannot be answered anywhere but in a browser with a layout engine. jsdom applies no media queries
 * and a unit test asserting geometry there is either vacuous or quietly wrong — so this file is
 * where "the phone layout works" stops being a claim about CSS strings and becomes a measurement.
 *
 * Five widths: the three the product exposes, one below the smallest phone the builder authors for,
 * and one between tablet and desktop where nobody ever set an override.
 */
const VIEWPORTS = [
  { name: "small phone", width: 320, height: 800 },
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "small laptop", width: 1024, height: 768 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
  test.describe(`a published page at ${viewport.width}px (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("does not scroll sideways", async ({ page }) => {
      await page.goto("/");

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      // `overflow-x: hidden` is deliberately absent from the published stylesheet: it would make a
      // broken layout look fixed while the content stayed unreachable. So this measures the real
      // thing, and a failure here is a real failure.
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    });

    test("keeps every element inside the screen", async ({ page }) => {
      await page.goto("/");

      const escaping = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        return [...document.querySelectorAll("[data-element-id]")]
          .map((node) => ({ id: node.getAttribute("data-element-id"), box: node.getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0 && (box.right > width + 1 || box.left < -1))
          .map(({ id, box }) => `${id} at ${Math.round(box.left)}–${Math.round(box.right)}`);
      });

      expect(escaping).toEqual([]);
    });

    test("lays itself out without any JavaScript", async ({ browser }) => {
      // The published page carries no script at all while analytics is off, so a layout that needed
      // one would simply never happen. This is the assertion that keeps it that way.
      const context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: viewport.width, height: viewport.height },
      });
      const page = await context.newPage();

      await page.goto("/");
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
      await expect(page.getByRole("heading", { name: "Published by the E2E fixture" })).toBeVisible();
      await context.close();
    });
  });
}

test.describe("what the page does at a width nobody authored", () => {
  test.use({ viewport: { width: 700, height: 900 } });

  test("uses the tablet rules rather than falling back to desktop", async ({ page }) => {
    await page.goto("/");

    // 700 is between the tablet reference and the phone ceiling. The compiler emits constraints that
    // are true continuously rather than values sampled at three widths, which is what makes this
    // width behave at all instead of picking whichever sample was closest.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
});

/**
 * A container's children, in a browser.
 *
 * Every check above walks `[data-element-id]`, which includes nested elements — but the fixture had
 * none, so the compiler could omit their rules and the suite stayed green. The published page now
 * carries text inside a free container, and the question is the one a reader asks: is it where it
 * was put, and is it on the screen.
 */
for (const viewport of VIEWPORTS) {
  test.describe(`text inside a container at ${viewport.width}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("is visible and placed inside its container", async ({ page }) => {
      await page.goto("/");

      const child = page.locator('[data-element-id="nested-paragraph"]');
      await expect(child).toBeVisible();
      await expect(child).toHaveText("Text inside a container");

      const boxes = await page.evaluate(() => {
        const rect = (id: string) => document.querySelector(`[data-element-id="${id}"]`)?.getBoundingClientRect();
        const parent = rect("nested-box");
        const child = rect("nested-paragraph");
        return parent === undefined || child === undefined
          ? null
          : { parent: { left: parent.left, right: parent.right }, child: { left: child.left, right: child.right } };
      });

      expect(boxes).not.toBeNull();
      // Without a compiled rule the child was drawn at the container's origin with no offset, which
      // is what "the text disappeared behind something else" looks like from the outside.
      expect(boxes!.child.left).toBeGreaterThan(boxes!.parent.left);
      expect(Math.round(boxes!.child.right)).toBeLessThanOrEqual(Math.round(boxes!.parent.right) + 1);
    });
  });
}
