import { expect, test } from "@playwright/test";

/**
 * Boundary widths, on a real page.
 *
 * The three the product exposes are checked elsewhere. These are the ones *between* them — one
 * pixel either side of each breakpoint — because that is where a layout compiled from constraints
 * either holds continuously or reveals that it was sampled at three widths and guessed in between.
 */
const BOUNDARIES = [320, 390, 767, 768, 1023, 1024, 1440];

for (const width of BOUNDARIES) {
  test.describe(`a published page at exactly ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("does not scroll sideways", async ({ page }) => {
      await page.goto("/");

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      // One pixel of horizontal scroll is the whole page moving under a thumb on a phone.
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    });

    test("keeps every block inside the screen", async ({ page }) => {
      await page.goto("/");

      const escaping = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        return [...document.querySelectorAll("[data-element-id]")]
          .map((node) => ({ id: node.getAttribute("data-element-id"), box: node.getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0 && (box.right > limit + 1 || box.left < -1))
          .map(({ id, box }) => `${id} at ${Math.round(box.left)}–${Math.round(box.right)}`);
      });

      expect(escaping).toEqual([]);
    });
  });
}

test.describe("content that is longer than its box", () => {
  test.use({ viewport: { width: 320, height: 900 } });

  test("wraps rather than widening the page", async ({ page }) => {
    await page.goto("/");

    // A long unbroken string — a URL, a German compound, a Portuguese "desenvolvimento" in a
    // narrow column — is the usual cause of a page that scrolls sideways on one device only.
    const widest = await page.evaluate(() => {
      let widest = 0;
      for (const node of document.querySelectorAll("p, h1, h2, h3, li, td, th")) {
        widest = Math.max(widest, node.getBoundingClientRect().width);
      }
      return widest;
    });

    expect(widest).toBeLessThanOrEqual(320);
  });
});
