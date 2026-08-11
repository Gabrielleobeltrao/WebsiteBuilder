/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    // Same-origin API in development mirrors production, where the gateway proxies /api to the
    // private backend. Nothing in the app may ever build a cross-origin API URL.
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: true } },
  },
  // The E2E suite runs against the production build through this server, so it needs the same
  // proxy. Without it the built app would be tested with no API at all, which tests nothing.
  preview: {
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: true } },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
