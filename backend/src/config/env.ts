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
  /**
   * Where the API answers publicly. Separate from the application origin because the two are
   * deployed as different hosts; the renderer needs it to build media URLs, and it is the origin
   * Better Auth issues its session cookie for.
   */
  API_PUBLIC_ORIGIN: z.string().url().default("http://localhost:5173"),
  PLATFORM_RESERVED_SUBDOMAINS: z.string().default(""),
  /** How long a proxy may serve a published page before revalidating. */
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
  CLOUDFLARE_API_BASE_URL: z.string().url().default("https://api.cloudflare.com/client/v4"),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
  CLOUDFLARE_ZONE_ID: z.string().min(1).optional(),
  CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),
  /** The CNAME target customers point their hostname at. */
  CLOUDFLARE_SAAS_CNAME_TARGET: z.string().min(3).default("customers.localhost"),
  PUBLIC_RENDERER_ORIGIN: z.string().min(3).default("origin.localhost"),
  /** Versions kept per project. The active one is never pruned regardless of this number. */
  PUBLISHED_VERSION_RETENTION_COUNT: z.coerce.number().int().min(1).max(500).default(20),
  PUBLISH_MAX_DOCUMENT_BYTES: z.coerce.number().int().positive().default(4_000_000),
  DOMAIN_VERIFICATION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  DOMAIN_VERIFICATION_TIMEOUT_HOURS: z.coerce.number().int().positive().default(72),
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
  trustedProxyCidrs: string[];
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
    trustedProxyCidrs: env.TRUSTED_PROXY_CIDRS.split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  };
}
