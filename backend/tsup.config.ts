import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/renderer-server.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Workspace source is bundled; runtime dependencies stay external in node_modules.
  noExternal: [/^@websitebuilder\//],
});
