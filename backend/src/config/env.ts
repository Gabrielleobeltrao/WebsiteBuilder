import { z } from "zod";

/**
 * Environment is validated once, at startup, and the process refuses to run when a required value
 * is missing. Failures name the variable and never its value, so a misconfiguration is obvious in
 * logs without leaking a secret into them.
 */

const port = z.coerce.number().int().min(1).max(65_535);

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  API_PORT: port.default(3000),
  PUBLIC_RENDERER_PORT: port.default(3001),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
  PLATFORM_ROOT_DOMAIN: z.string().min(3).default("localhost"),
  PLATFORM_PUBLIC_ORIGIN: z.string().url().default("http://localhost:5173"),
  PLATFORM_RESERVED_SUBDOMAINS: z.string().default(""),
  /** Bytes accepted for a builder document save. Larger documents are rejected with 413. */
  JSON_BODY_LIMIT: z.string().default("8mb"),
  PUBLIC_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MONGODB_URI: z.string().min(1).optional(),
  MONGODB_DB_NAME: z.string().min(1).optional(),
  /** At least 32 bytes. Sessions signed with a weak secret are forgeable. */
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:5173"),
  BETTER_AUTH_BASE_PATH: z.string().startsWith("/").default("/api/auth"),
});

export type Env = z.infer<typeof baseSchema> & {
  isProduction: boolean;
  isTest: boolean;
  reservedSubdomains: string[];
};

export class EnvironmentError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Invalid environment configuration: ${missing.join(", ")}`);
    this.name = "EnvironmentError";
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = baseSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvironmentError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const env = parsed.data;

  // Values that may default in development but must be explicit in production.
  const requiredInProduction: Array<keyof typeof env> = [
    "MONGODB_URI",
    "MONGODB_DB_NAME",
    "BETTER_AUTH_SECRET",
  ];
  if (env.NODE_ENV === "production") {
    const missing = requiredInProduction.filter((key) => !env[key]);
    if (missing.length > 0) throw new EnvironmentError(missing.map(String));
  }

  return {
    ...env,
    isProduction: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",
    reservedSubdomains: env.PLATFORM_RESERVED_SUBDOMAINS.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  };
}
