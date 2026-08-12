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

  it("names no origin of its own", () => {
    /*
     * It used to request nothing at all. It now posts one thing — a form the visitor filled in —
     * and only ever to the address the server wrote into that form's `action`. What is asserted is
     * the part a string can prove: no URL is baked into the file, and no transport that would
     * escape the page's `connect-src 'self'` is used.
     */
    expect(RUNTIME_SOURCE).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost)/);
    expect(RUNTIME_SOURCE).not.toContain("XMLHttpRequest");
    expect(RUNTIME_SOURCE).not.toContain("sendBeacon");
    // The one request it makes takes its address from the document.
    expect(RUNTIME_SOURCE).toContain('getAttribute("action")');
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

describe("what a page without a form downloads", () => {
  it("is nothing: the runtime is referenced only by a page that needs it", async () => {
    const { createProjectDocument, elementDefinition, runtimeCapabilitiesFor } = await import("@websitebuilder/shared");

    const plain = createProjectDocument({ name: "Acme", slug: "acme" });
    expect(runtimeCapabilitiesFor(plain.pages[0]!.sections.flatMap((section) => section.elements))).toEqual([]);

    // The same page with a form on it asks for exactly one capability, and only then.
    const withForm = createProjectDocument({ name: "Acme", slug: "acme" });
    withForm.pages[0]!.sections[0]!.elements = [
      {
        id: "form-block",
        name: "",
        geometry: { x: 0, y: 0, width: 480, height: 360, rotation: 0 },
        responsiveLayout: {
          width: { value: 480, unit: "px" },
          height: { value: 360, unit: "px" },
          horizontalConstraint: "left",
          verticalConstraint: "top",
          visible: true,
        },
        zIndex: 1,
        locked: false,
        hidden: false,
        type: "form",
        version: elementDefinition("form").schemaVersion,
        ...elementDefinition("form").defaults(),
      },
    ] as never;

    expect(runtimeCapabilitiesFor(withForm.pages[0]!.sections.flatMap((section) => section.elements))).toEqual([
      "formSubmit",
    ]);
  });
});
