/**
 * Builds the published-site tracker and writes it into the backend as a source constant.
 *
 * A generated file in version control is a deliberate trade. The alternative — reading the built
 * asset from disk at request time — works under `tsx` and fails in the production image, because
 * the backend bundles its sources and the image never carries a sibling `dist` directory. That
 * failure would only appear in production, on a customer's site, which is the worst place to find
 * out. Serving from a string constant behaves identically everywhere.
 *
 * The committed file is checked for drift by a test that runs this build and compares, so it cannot
 * silently fall out of step with the source it was built from.
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "src", "index.ts");
const output = join(here, "..", "..", "backend", "src", "renderer", "tracker.generated.ts");

/** Builds the tracker and returns its minified source. */
export async function buildTracker() {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "iife",
    // The oldest engines the published sites are expected to serve. Lower than the application's,
    // because a visitor did not choose their browser for this site.
    target: ["es2020", "chrome80", "firefox78", "safari14"],
    write: false,
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"' },
  });

  const file = result.outputFiles[0];
  if (file === undefined) throw new Error("the tracker build produced no output");
  return file.text;
}

export function trackerModule(source) {
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);

  return `/**
 * The published-site analytics tracker, built from \`frontend/tracker/src/index.ts\`.
 *
 * Generated — do not edit. Run \`npm run build:tracker\` after changing the source; a test fails if
 * this file and that source disagree.
 *
 * It lives here as a string rather than as an asset on disk because the backend bundles its sources
 * and the production image carries no sibling build output. A filesystem read would work in
 * development and fail in production.
 */
export const TRACKER_SOURCE = ${JSON.stringify(source)};

/** Content hash, used as the cache-busting query and as the immutable cache key. */
export const TRACKER_VERSION = ${JSON.stringify(hash)};
`;
}

// Only when run as a command. The drift test imports `buildTracker` to compare against the
// committed file, and an import that rewrote that file would make the comparison meaningless.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const source = await buildTracker();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, trackerModule(source), "utf8");
  process.stdout.write(`tracker built: ${Buffer.byteLength(source, "utf8")} bytes minified\n`);
}
