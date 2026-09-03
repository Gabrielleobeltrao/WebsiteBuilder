/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
// `loadEnv` comes from vite itself; `vitest/config` re-exports `defineConfig` and not it.
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Ports, from this workspace's own `.env`.
 *
 * The API and the renderer have taken their ports from the environment from the start; the web
 * server's was written here and the proxy target beside it, so a developer with something else on
 * those ports could move half of the stack and not the other half. The defaults are deliberately
 * unusual numbers: the conventional ones are what every other project on the machine also takes.
 *
 * Read from `frontend/.env` rather than a file at the repository root, because deployment gives each
 * service its own environment and a root file exists on no machine that runs this in production.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "");
  const webPort = Number(env.WEB_PORT || 7410);
  const apiTarget = `http://localhost:${Number(env.API_PORT || 7411)}`;

  return {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: webPort,
    /*
     * Fail rather than move.
     *
     * Vite's default is to take the next free port, and the backend's cookie origin, auth URL and
     * CORS list are all pinned to the configured one — so a silent move produces a dev server that
     * loads and cannot sign in, which is a much harder thing to work out than "port in use".
     */
    strictPort: true,
    // Same-origin API in development mirrors production, where the gateway proxies /api to the
    // private backend. Nothing in the app may ever build a cross-origin API URL.
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
  // The E2E suite runs against the production build through this server, so it needs the same
  // proxy. Without it the built app would be tested with no API at all, which tests nothing.
  preview: {
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
  };
});
