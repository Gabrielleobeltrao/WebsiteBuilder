import { loadEnv, type Env } from "../src/config/env";
import { createLogger } from "../src/config/logger";

/** Deterministic test environment: no real ports, no real database, silent logs. */
export function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    FRONTEND_ORIGIN: "http://localhost:7410",
    PLATFORM_ROOT_DOMAIN: "localhost",
    PLATFORM_PUBLIC_ORIGIN: "http://localhost:7410",
    ...overrides,
  } as NodeJS.ProcessEnv);
}

export function testLogger() {
  return createLogger({ LOG_LEVEL: "silent", isTest: true });
}
