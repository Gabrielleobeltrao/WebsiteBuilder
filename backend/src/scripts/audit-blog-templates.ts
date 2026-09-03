import { MongoClient } from "mongodb";

import { BlogRepository } from "../modules/blog/repository";
import { auditBlogTemplates } from "../modules/blog/repair";

/**
 * Counts the blogs that cannot serve their own routes, and changes nothing.
 *
 * Blogs enabled before template ids existed have `enabled: true` and no layouts, which blocks
 * publication of the whole site — not only the blog. Opening the blog screen repairs one, because
 * the settings endpoint repairs on read; this answers the question that cannot be answered that
 * way: how many are still in that state without anybody having looked.
 *
 * Read-only on purpose. The repair happens per site, when its owner is there to see it.
 *
 *   MONGODB_URI=... npm run audit:blog -w backend [-- --workspace <id>] [--json]
 */
export function formatAudit(
  candidates: ReadonlyArray<{ workspaceId: string; projectId: string; missing: readonly string[] }>,
): string {
  if (candidates.length === 0) return "No blog is missing a layout.";

  const lines = candidates.map(
    (candidate) => `${candidate.workspaceId}\t${candidate.projectId}\tmissing: ${candidate.missing.join(", ")}`,
  );
  return [`${candidates.length} blog(s) cannot serve their routes:`, ...lines].join("\n");
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (uri === undefined || uri === "") {
    throw new Error("MONGODB_URI is required. This script reads the database and writes nothing.");
  }

  const args = process.argv.slice(2);
  const workspaceIndex = args.indexOf("--workspace");
  const workspaceId = workspaceIndex === -1 ? undefined : args[workspaceIndex + 1];

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const repository = new BlogRepository(client.db());
    const candidates = await auditBlogTemplates({ repository }, workspaceId === undefined ? {} : { workspaceId });

    process.stdout.write(`${args.includes("--json") ? JSON.stringify(candidates, null, 2) : formatAudit(candidates)}\n`);
  } finally {
    await client.close();
  }
}

// Only when run directly, so importing the formatter for a test does not open a database.
if (process.argv[1]?.endsWith("audit-blog-templates.ts") === true) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
