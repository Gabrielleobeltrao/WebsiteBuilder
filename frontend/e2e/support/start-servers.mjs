/**
 * Starts the API and the public renderer for E2E, against one throwaway in-memory MongoDB.
 *
 * Both services must see the same database: the renderer serves a site the API published, and a
 * suite where they each own a database can only test halves. The database therefore belongs to this
 * launcher rather than to either child, and goes away with it.
 *
 * Startup is deliberately serialised — seed, then renderer, then API — so that Playwright's single
 * health check on the API means everything behind it is ready. A parallel start would pass that
 * check while the renderer was still binding and turn a real failure into a flaky one.
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, "..", "..", "..", "backend");

const API_PORT = "3000";
const RENDERER_PORT = "3001";
const PLATFORM_ORIGIN = "http://localhost:4173";

const mongo = await MongoMemoryServer.create();

const shared = {
  ...process.env,
  NODE_ENV: "development",
  LOG_LEVEL: "warn",
  MONGODB_URI: mongo.getUri(),
  MONGODB_DB_NAME: "e2e",
  PLATFORM_ROOT_DOMAIN: "localhost",
  PLATFORM_PUBLIC_ORIGIN: PLATFORM_ORIGIN,
};

const children = [];

/** Runs a one-shot script to completion, failing the run if it fails. */
function run(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", script], { cwd: backendDir, stdio: "inherit", env });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
    child.on("error", reject);
  });
}

/** Starts a long-running service and resolves once it answers its health endpoint. */
async function serve(script, env, healthUrl) {
  const child = spawn("npx", ["tsx", script], { cwd: backendDir, stdio: "inherit", env });
  children.push(child);

  const deadline = Date.now() + 120_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${script} did not answer ${healthUrl} in time`);
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// Seeding runs against the database directly, before either service starts, so a test never races
// a half-published fixture.
await run(join(here, "seed-published-site.ts"), shared);

await serve(
  "src/renderer-server.ts",
  { ...shared, PUBLIC_RENDERER_PORT: RENDERER_PORT, PUBLIC_RENDERER_HOST: `origin.localhost:${RENDERER_PORT}` },
  `http://127.0.0.1:${RENDERER_PORT}/healthz`,
);

await serve(
  "src/server.ts",
  {
    ...shared,
    API_PORT,
    // Deterministic and disposable: it exists only for the life of this process.
    BETTER_AUTH_SECRET: "e2e-secret-that-is-long-enough-to-be-valid-000",
    BETTER_AUTH_URL: PLATFORM_ORIGIN,
    FRONTEND_ORIGIN: PLATFORM_ORIGIN,
  },
  `http://127.0.0.1:${API_PORT}/api/v1/health`,
);

// Shutdown arrives twice: once as the signal Playwright sends, once as a child exiting because of
// it. Stopping the database twice throws, and a non-zero exit here fails a run whose tests all
// passed — so teardown happens once and reports success.
let stopping = false;

const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;

  for (const child of children) child.kill("SIGTERM");
  await mongo.stop().catch(() => {});
  process.exit(code);
};

process.on("SIGTERM", () => void stop(0));
process.on("SIGINT", () => void stop(0));

for (const child of children) child.on("exit", (code) => void stop(code ?? 0));
