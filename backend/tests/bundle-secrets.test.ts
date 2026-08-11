import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nothing backend-only may reach code the browser downloads.
 *
 * Vite inlines every `VITE_*` variable at build time, so a credential named with that prefix is a
 * published credential. This reads the actual build output rather than trusting the convention.
 */
const DIST = join(import.meta.dirname, "..", "..", "frontend", "dist");

const FORBIDDEN = [
  "MONGODB_URI",
  "BETTER_AUTH_SECRET",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ZONE_ID",
  "CLOUDFLARE_ACCOUNT_ID",
  "mongodb+srv://",
  "mongodb://",
];

function bundleFiles(directory: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return bundleFiles(path);
    return /\.(js|css|html|map)$/.test(entry) ? [path] : [];
  });
}

describe("frontend bundle", () => {
  const files = bundleFiles(DIST);

  // Skipped, and reported as skipped, when nothing has been built: `npm run build` must run first
  // for this to mean anything, and a silent pass would be worse than a visible skip.
  it.skipIf(files.length === 0)("contains no backend-only variable name or connection string", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const contents = readFileSync(file, "utf8");
      for (const needle of FORBIDDEN) {
        if (contents.includes(needle)) offenders.push(`${file}: ${needle}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
