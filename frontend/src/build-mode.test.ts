import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The published bundle must be a production build.
 *
 * A development build shipped once, because the image set NODE_ENV=development to answer a warning
 * about npm and Vite reads that to choose its mode. Nothing about the deploy looked wrong — the
 * site loaded — while `import.meta.env.DEV` was true and every guard reading it was inverted.
 * `allowHttp` is one of those: it permits `http://` links that production refuses.
 */
const DIST = join(import.meta.dirname, "..", "dist", "assets");

function bundles(): string[] {
  try {
    return readdirSync(DIST)
      .filter((entry) => entry.endsWith(".js"))
      .map((entry) => readFileSync(join(DIST, entry), "utf8"));
  } catch {
    return [];
  }
}

describe("built bundle", () => {
  const files = bundles();

  // Skipped, and reported as skipped, when nothing has been built. `npm run build` must run first.
  it.skipIf(files.length === 0)("was compiled in production mode", () => {
    const source = files.join("\n");

    // Vite inlines `import.meta.env.DEV`; in a production build every use becomes a false literal.
    expect(source).toContain("allowHttp:!1");
    expect(source).not.toContain("allowHttp:!0");
  });

  it.skipIf(files.length === 0)("ships no development-only warnings", () => {
    // React's development build carries these; the production one does not.
    expect(files.join("\n")).not.toContain("react-dom.development.js");
  });
});
