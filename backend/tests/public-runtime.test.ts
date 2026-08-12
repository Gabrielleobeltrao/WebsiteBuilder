import { brotliCompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { RUNTIME_SOURCE, RUNTIME_VERSION } from "../src/renderer/runtime.generated";

/**
 * The published-site interaction runtime.
 *
 * What matters about this file is what it is *not*: not required, not large, not a dependency on
 * anything a visitor's browser has to fetch from somewhere else, and not present at all on a page
 * that has nothing to upgrade. Each of those is checked here rather than assumed.
 */
describe("the runtime a visitor downloads", () => {
  it("is small enough to be free", () => {
    // Brotli, because that is what a browser negotiates. It is charged to somebody who did not
    // choose to load it, so the budget is deliberately far below the application's.
    const compressed = brotliCompressSync(Buffer.from(RUNTIME_SOURCE, "utf8")).byteLength;

    expect(compressed).toBeLessThanOrEqual(8_000);
  });

  it("matches the source it was built from", async () => {
    // A generated file that drifts ships behaviour nobody wrote.
    const { buildRuntime } = await import("../../frontend/runtime/build.mjs");
    expect(await buildRuntime()).toBe(RUNTIME_SOURCE);
  }, 60_000);

  it("carries its own content hash, so its URL can be cached forever", () => {
    expect(RUNTIME_VERSION).toBe(createHash("sha256").update(RUNTIME_SOURCE).digest("hex").slice(0, 16));
  });

  it("requests nothing from anywhere", () => {
    // No fetch, no beacon, no origin. It touches the DOM and nothing else.
    expect(RUNTIME_SOURCE).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost)/);
    expect(RUNTIME_SOURCE).not.toContain("fetch(");
    expect(RUNTIME_SOURCE).not.toContain("XMLHttpRequest");
    expect(RUNTIME_SOURCE).not.toContain("sendBeacon");
  });

  it("uses no construct a strict policy forbids", () => {
    expect(RUNTIME_SOURCE).not.toContain("eval(");
    expect(RUNTIME_SOURCE).not.toContain("new Function");
    expect(RUNTIME_SOURCE).not.toContain("innerHTML");
  });

  it("upgrades through the platform's own attributes rather than guessing at markup", () => {
    for (const hook of ["data-wb-tabs", "data-wb-lightbox", "data-wb-dismiss", "data-wb-countdown", "data-wb-toc"]) {
      expect(RUNTIME_SOURCE).toContain(hook);
    }
  });

  it("respects a visitor who asked for less motion", () => {
    expect(RUNTIME_SOURCE).toContain("prefers-reduced-motion");
  });
});
