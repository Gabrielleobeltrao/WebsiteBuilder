import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const RENDERER_PORT = 3001;

/** The hostname the seed publishes to. Must match `e2e/support/seed-published-site.ts`. */
const PUBLISHED_SITE_HOST = `e2e-site.localhost:${RENDERER_PORT}`;

/**
 * E2E runs against the production build, so what is tested is what ships. The server is started by
 * Playwright itself and torn down after, which keeps the suite runnable from a clean checkout with
 * no developer-specific setup.
 */
export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/support/**",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    // Published-site specs run only in their own project, which points at the renderer.
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: "**/published-site*.spec.ts" },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
      // The visual editor is desktop-only by design, and mobile access to it is read-only preview.
      // Running the authoring journey here would be testing a state the product deliberately
      // refuses to enter.
      testIgnore: ["**/mvp-flow.spec.ts", "**/published-site*.spec.ts", "**/visual-regression.spec.ts"],
    },
    {
      // Published customer pages, served by the public renderer on their own hostname rather than
      // by the application. A different origin and a different process, so it is a different
      // project rather than a different baseURL inside an existing one.
      name: "published-site",
      testMatch: "**/published-site*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://${PUBLISHED_SITE_HOST}`,
        // Chromium maps *.localhost to loopback per RFC 6761, but a CI image may disagree and the
        // failure would look like a missing site rather than a resolver difference.
        launchOptions: { args: ["--host-resolver-rules=MAP *.localhost 127.0.0.1"] },
      },
    },
  ],
  // Two entries, three servers: the built frontend, and a launcher that owns one in-memory database
  // shared by the API and the public renderer. They must share it — the renderer serves what the API
  // published — and the launcher's health check answers only once both are up and a site is seeded.
  webServer: [
    {
      command: "node e2e/support/start-servers.mjs",
      url: "http://localhost:3000/api/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: `npm run preview -- --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
