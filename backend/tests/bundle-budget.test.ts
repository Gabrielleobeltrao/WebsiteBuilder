import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { auditBundle, PERFORMANCE_BUDGETS } from "@websitebuilder/shared";

/**
 * The JavaScript budget, checked against the built artefact rather than against an intention.
 * Compressed, because that is what a visitor downloads.
 */
const ASSETS = join(import.meta.dirname, "..", "..", "frontend", "dist", "assets");

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
