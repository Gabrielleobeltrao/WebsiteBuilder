import { API_BASE_PATH } from "@websitebuilder/shared";

/**
 * Where the API is, decided once.
 *
 * In production it is `/api/v1` on this same origin: the gateway proxies `/api/*` to a backend that
 * has no public hostname at all. Nothing to configure, nothing to get wrong, and no cross-origin
 * request for a browser to attach credentials to.
 *
 * `VITE_API_URL` remains only for local development, where the API really does answer somewhere
 * else. It is build configuration and is never derived from a request or a document — an API URL
 * that user data can influence is how a session token ends up somewhere nobody intended.
 *
 * Two clients read this: the typed fetch wrapper and Better Auth. They must agree. When they did
 * not, one kept calling an origin where `/api/*` fell through to the SPA, and a login page parsed
 * as JSON surfaced as a rejected sign-in with nothing pointing at the cause.
 */
function configured(): string | null {
  const raw = import.meta.env.VITE_API_URL;
  if (typeof raw !== "string" || raw.trim() === "") return null;

  const trimmed = raw.trim().replace(/\/+$/, "");
  // A relative path means the API shares this origin; there is nothing to resolve.
  if (trimmed.startsWith("/")) return null;

  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("VITE_API_URL must be a relative path or an absolute http(s) URL");
  }
  return trimmed;
}

/** Base for the versioned API, absolute or relative. */
export function apiBase(): string {
  const raw = import.meta.env.VITE_API_URL;
  const trimmed = typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
  if (trimmed === "") return API_BASE_PATH;
  if (trimmed.startsWith("/")) return trimmed;

  // Validates, and throws on a scheme that is neither http nor https.
  configured();
  return trimmed;
}

/**
 * Origin the API answers on, or null when it shares this one.
 *
 * Auth lives at a different path on the same host as the versioned API, so it needs the origin
 * rather than the full base.
 */
export function apiOrigin(): string | null {
  const absolute = configured();
  return absolute === null ? null : new URL(absolute).origin;
}
