import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { auditBundle, PERFORMANCE_BUDGETS } from "@websitebuilder/shared";

import { TRACKER_SOURCE, TRACKER_VERSION } from "../src/renderer/tracker.generated";

/**
 * The JavaScript budget, checked against the built artefact rather than against an intention.
 * Compressed, because that is what a visitor downloads.
 */
const DIST = join(import.meta.dirname, "..", "..", "frontend", "dist");
const ASSETS = join(DIST, "assets");

/**
 * What the *first* screen downloads: the entry module, plus every chunk the document tells the
 * browser to preload alongside it. Anything else is fetched only when its route is opened.
 */
function initialBundleBytes(): number | null {
  let html: string;
  try {
    html = readFileSync(join(DIST, "index.html"), "utf8");
  } catch {
    return null;
  }

  const referenced = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((match) => match[1] ?? "");
  if (referenced.length === 0) return null;

  return referenced.reduce((total, reference) => {
    const path = join(DIST, reference.replace(/^\//, ""));
    try {
      return total + gzipSync(readFileSync(path)).byteLength;
    } catch {
      return total;
    }
  }, 0);
}

function bundleBytes(): number | null {
  let entries: string[];
  try {
    entries = readdirSync(ASSETS);
  } catch {
    return null;
  }

  const scripts = entries.filter((entry) => entry.endsWith(".js"));
  if (scripts.length === 0) return null;

  return scripts.reduce((total, entry) => {
    const path = join(ASSETS, entry);
    if (!statSync(path).isFile()) return total;
    return total + gzipSync(readFileSync(path)).byteLength;
  }, 0);
}

describe("client JavaScript budget", () => {
  const bytes = bundleBytes();
  const initial = initialBundleBytes();

  it.skipIf(initial === null)("keeps the first screen under its own budget", () => {
    // The number a person waits for before anything renders. Summing every chunk hides exactly the
    // regression that matters: a route that stopped being lazily loaded moves this and leaves the
    // total unchanged.
    expect(auditBundle(initial ?? 0, "application-initial")).toEqual([]);
  });

  it.skipIf(initial === null)("does not ship the builder to a visitor who opened the landing page", () => {
    // The builder, the blog editor, the analytics charts and the CMS editor are each their own
    // chunk, so the entry must be a fraction of the total rather than most of it.
    expect((initial ?? 0) / (bytes ?? 1)).toBeLessThan(0.6);
  });

  // Skipped, and reported as skipped, when nothing has been built. A silent pass would be worse
  // than a visible skip.
  it.skipIf(bytes === null)("stays within the measured budget", () => {
    const findings = auditBundle(bytes ?? 0);

    expect(
      findings.map((finding) => `${finding.measured} bytes against a budget of ${finding.budget}`),
    ).toEqual([]);
  });

  it("leaves headroom that is not room to grow into", () => {
    // A budget raised to match what was already shipped measures nothing. This one sits above the
    // current measurement with enough margin to be actionable and not enough to be ignored.
    expect(bytes === null || bytes < PERFORMANCE_BUDGETS.applicationBundleBytes * 0.95).toBe(true);
  });
});

describe("the published-site tracker", () => {
  const tracker = TRACKER_SOURCE;

  it("stays within the budget a visitor pays for", () => {
    // Brotli, because that is what a browser negotiates and therefore what the visitor actually
    // downloads. The budget is charged against someone who did not choose to load this file.
    const compressed = brotliCompressSync(Buffer.from(tracker, "utf8")).byteLength;

    expect(compressed).toBeLessThanOrEqual(PERFORMANCE_BUDGETS.publishedSiteTrackerBytes);
  });

  it("matches the source it was built from", async () => {
    // The committed file is generated, and a generated file that drifts is worse than no file: it
    // ships behaviour nobody wrote. Rebuilding here is the only way to know they still agree.
    const { buildTracker } = await import("../../frontend/tracker/build.mjs");
    expect(await buildTracker()).toBe(tracker);
  }, 60_000);

  it("carries its own content hash, so its URL can be cached forever", () => {
    const hash = createHash("sha256").update(tracker).digest("hex").slice(0, 16);
    expect(TRACKER_VERSION).toBe(hash);
  });

  it("contains no reference to an origin it did not bundle", () => {
    expect(tracker).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost)/);
  });
});
