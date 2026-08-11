import { z } from "zod";

/**
 * Environment is validated once, at startup, and the process refuses to run when a required value
 * is missing. Failures name the variable and never its value, so a misconfiguration is obvious in
 * logs without leaking a secret into them.
 */

const port = z.coerce.number().int().min(1).max(65_535);

/**
 * Treats an empty value as absent.
 *
 * A deployment platform sets a variable to `""` where a developer would leave it unset — Compose's
 * `${VAR:-}` produces exactly that — and Zod's `.optional()` and `.default()` only recognise
 * `undefined`. Without this, "leave it blank to disable" is a promise the schema breaks: an empty
 * string is checked as if someone had typed one deliberately, and a service that needs none of it
 * refuses to start.
 */
function blankAsAbsent<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), schema);
}

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  API_PORT: port.default(3000),
  PUBLIC_RENDERER_PORT: port.default(3001),
  FRONTEND_ORIGIN: blankAsAbsent(z.string().url().default("http://localhost:5173")),
  PLATFORM_ROOT_DOMAIN: blankAsAbsent(z.string().min(3).default("localhost")),
  PLATFORM_PUBLIC_ORIGIN: blankAsAbsent(z.string().url().default("http://localhost:5173")),
  PLATFORM_RESERVED_SUBDOMAINS: z.string().default(""),
  /** How long a proxy may serve a published page before revalidating. */
  /**
   * Analytics ingestion. Off by default so a deployment starts without an open write endpoint and
   * an operator turns it on deliberately — the feature is disabled per site as well, and these are
   * the two locks that have to be opened in different places.
   */
  ANALYTICS_INGESTION_ENABLED: blankAsAbsent(z.enum(["true", "false"]).default("false")),
  /** Batches per minute from one address, where a forwarded address can be trusted. */
  ANALYTICS_RATE_LIMIT_PER_ADDRESS: blankAsAbsent(z.coerce.number().int().min(1).max(10_000).default(60)),
  /** Batches per minute for one project, so one busy site cannot exhaust the process. */
  ANALYTICS_RATE_LIMIT_PER_PROJECT: blankAsAbsent(z.coerce.number().int().min(1).max(100_000).default(600)),
  PUBLIC_SITE_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().max(86_400).default(60),
  /**
   * Proxy ranges whose forwarded headers may be believed. Empty means none: on a host-routed
   * multi-tenant renderer, believing X-Forwarded-Host from an untrusted hop hands out any tenant.
   */
  TRUSTED_PROXY_CIDRS: z.string().default(""),
  /**
   * Cloudflare for SaaS. Absent means custom domains run against the in-memory fake, which is
   * correct for development and never for production.
   */
  CLOUDFLARE_API_BASE_URL: blankAsAbsent(z.string().url().default("https://api.cloudflare.com/client/v4")),
  CLOUDFLARE_ACCOUNT_ID: blankAsAbsent(z.string().min(1).optional()),
  CLOUDFLARE_ZONE_ID: blankAsAbsent(z.string().min(1).optional()),
  CLOUDFLARE_API_TOKEN: blankAsAbsent(z.string().min(1).optional()),
  /** The CNAME target customers point their hostname at. */
  CLOUDFLARE_SAAS_CNAME_TARGET: blankAsAbsent(z.string().min(3).default("customers.localhost")),
  /** Hostname, not an origin: it is used as a DNS name in routing rules and as a CNAME target. */
  PUBLIC_RENDERER_HOST: blankAsAbsent(z.string().min(3).default("origin.localhost")),
  /** Versions kept per project. The active one is never pruned regardless of this number. */
  PUBLISHED_VERSION_RETENTION_COUNT: z.coerce.number().int().min(1).max(500).default(20),
  PUBLISH_MAX_DOCUMENT_BYTES: z.coerce.number().int().positive().default(4_000_000),
  DOMAIN_VERIFICATION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  DOMAIN_VERIFICATION_TIMEOUT_HOURS: z.coerce.number().int().positive().default(72),
  /** Bytes accepted for a builder document save. Larger documents are rejected with 413. */
  JSON_BODY_LIMIT: z.string().default("8mb"),
  PUBLIC_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MONGODB_URI: blankAsAbsent(z.string().min(1).optional()),
  MONGODB_DB_NAME: blankAsAbsent(z.string().min(1).optional()),
  /** At least 32 bytes. Sessions signed with a weak secret are forgeable. */
  BETTER_AUTH_SECRET: blankAsAbsent(z.string().min(32).optional()),
  BETTER_AUTH_URL: blankAsAbsent(z.string().url().default("http://localhost:5173")),
  BETTER_AUTH_BASE_PATH: z.string().startsWith("/").default("/api/auth"),
});

export type Env = z.infer<typeof baseSchema> & {
  isProduction: boolean;
  isTest: boolean;
  reservedSubdomains: string[];
  trustedProxyCidrs: string[];
};

export class EnvironmentError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Invalid environment configuration:\n  ${missing.join("\n  ")}`);
    this.name = "EnvironmentError";
  }
}

/**
 * What is wrong with a required variable, without ever quoting it.
 *
 * A bare variable name cannot distinguish "not set" from "set but too short", and an operator
 * reading a container log has nothing else to go on. The constraint is safe to state; the value
 * never is, which is why the length is described rather than measured out loud.
 */
function describeRequired(name: string, value: string | undefined, minimum?: number): string | null {
  if (value === undefined || value.trim() === "") return `${name} is not set`;
  if (minimum !== undefined && value.length < minimum) {
    return `${name} is shorter than the required ${minimum} characters`;
  }
  return null;
}

/**
 * The variables this service reads, for diagnostics only.
 *
 * When startup fails, knowing which of these actually arrived separates "I did not set it" from "I
 * set it and the platform did not pass it" — two problems with different fixes that produce the
 * same message. Names only, never values.
 */
export const KNOWN_VARIABLES = [
  "NODE_ENV",
  "API_PORT",
  "PUBLIC_RENDERER_PORT",
  "MONGODB_URI",
  "MONGODB_DB_NAME",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "FRONTEND_ORIGIN",
  "PLATFORM_ROOT_DOMAIN",
  "PLATFORM_PUBLIC_ORIGIN",
  "PUBLIC_RENDERER_HOST",
  "CLOUDFLARE_ZONE_ID",
  "CLOUDFLARE_API_TOKEN",
] as const;

/**
 * The private ranges Docker allocates container addresses from.
 *
 * The API is reachable only through the gateway on a private network — it has no public route at
 * all — so every request it sees arrives from one of these. Trusting them is what lets it read the
 * visitor's address out of the forwarded chain instead of recording the gateway for everyone.
 */
export const PRIVATE_PROXY_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"] as const;

/** Which of the known variables arrived with a non-empty value. Names only. */
export function presentVariables(source: NodeJS.ProcessEnv = process.env): string[] {
  return KNOWN_VARIABLES.filter((name) => (source[name] ?? "").trim() !== "");
}

/**
 * Which process is being configured.
 *
 * The two services share a schema but not their requirements: the renderer serves published
 * snapshots and has no sessions, so holding it to the API's authentication secret would demand a
 * credential it must never be given. A secret handed to a process that does not need it is a secret
 * with a larger blast radius for no benefit.
 */
export type ServiceRole = "api" | "renderer";

export function loadEnv(source: NodeJS.ProcessEnv = process.env, role: ServiceRole = "api"): Env {
  const parsed = baseSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvironmentError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const env = parsed.data;

  // Values that may default in development but must be explicit in production. The secret carries
  // its minimum length here as well as in the schema: an optional field with a `min` reports
  // nothing when it is simply absent, which is the more common mistake.
  if (env.NODE_ENV === "production") {
    const problems = [
      describeRequired("MONGODB_URI", env.MONGODB_URI),
      describeRequired("MONGODB_DB_NAME", env.MONGODB_DB_NAME),
      // Only the API. The renderer has no sessions to sign.
      ...(role === "api" ? [describeRequired("BETTER_AUTH_SECRET", env.BETTER_AUTH_SECRET, 32)] : []),
    ].filter((problem): problem is string => problem !== null);

    if (problems.length > 0) throw new EnvironmentError(problems);
  }

  return {
    ...env,
    isProduction: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",
    reservedSubdomains: env.PLATFORM_RESERVED_SUBDOMAINS.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
    trustedProxyCidrs: env.TRUSTED_PROXY_CIDRS.split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  };
}
