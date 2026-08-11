/**
 * Starts the API for E2E against a throwaway in-memory MongoDB.
 *
 * The suite must not depend on a developer's own database: one that does passes on the machine that
 * has the right data and fails everywhere else, which is the same as not having it. This process
 * owns its database for its lifetime and takes it with it when it exits.
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, "..", "..", "..", "backend");

const mongo = await MongoMemoryServer.create();

const child = spawn("npx", ["tsx", "src/server.ts"], {
  cwd: backendDir,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "development",
    LOG_LEVEL: "warn",
    API_PORT: "3000",
    MONGODB_URI: mongo.getUri(),
    MONGODB_DB_NAME: "e2e",
    // Deterministic and disposable: it exists only for the life of this process.
    BETTER_AUTH_SECRET: "e2e-secret-that-is-long-enough-to-be-valid-000",
    BETTER_AUTH_URL: "http://localhost:4173",
    FRONTEND_ORIGIN: "http://localhost:4173",
    PLATFORM_PUBLIC_ORIGIN: "http://localhost:4173",
    PLATFORM_ROOT_DOMAIN: "localhost",
  },
});

// Shutdown arrives twice: once as the signal Playwright sends, once as the child exiting because
// of it. Stopping the database twice throws, and a non-zero exit here fails a run whose tests all
// passed — so teardown happens once and reports success.
let stopping = false;

const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;

  child.kill("SIGTERM");
  await mongo.stop().catch(() => {});
  process.exit(code);
};

process.on("SIGTERM", () => void stop(0));
process.on("SIGINT", () => void stop(0));

// A signalled exit is a requested shutdown, not a failure; only a real non-zero code is one.
child.on("exit", (code) => void stop(code ?? 0));
