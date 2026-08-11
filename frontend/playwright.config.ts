import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

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
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
      // The visual editor is desktop-only by design, and mobile access to it is read-only preview.
      // Running the authoring journey here would be testing a state the product deliberately
      // refuses to enter.
      testIgnore: "**/mvp-flow.spec.ts",
    },
  ],
  // Two servers: the built frontend, and the API against a throwaway in-memory database. The
  // preview server proxies /api to it, which is the same shape production uses.
  webServer: [
    {
      command: "node e2e/support/start-backend.mjs",
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
