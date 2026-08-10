import { z } from "zod";

/**
 * Infrastructure labels a customer project may never claim, because the wildcard DNS record for
 * `*.${PLATFORM_ROOT_DOMAIN}` would otherwise let a project shadow an operational hostname.
 * Deployments may add more through `PLATFORM_RESERVED_SUBDOMAINS`; they may never remove these.
 */
export const RESERVED_SUBDOMAINS = [
  "www",
  "app",
  "api",
  "admin",
  "origin",
  "customers",
  "coolify",
  "status",
  "mail",
  "cdn",
  "assets",
  "static",
  "docs",
  "support",
] as const;

export const HOME_PAGE_SLUG = "/";

const PROJECT_SLUG_MIN = 3;
const PROJECT_SLUG_MAX = 63;

/** Strips diacritics so "Sobre Nós" and "Sobre Nos" normalise to the same slug. */
function toAsciiLower(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Normalises a page path segment. The homepage keeps the reserved "/" slug; every other page
 * becomes a lowercase kebab-case segment with no leading or trailing separator.
 */
export function normalizePageSlug(input: string): string {
  if (input.trim() === HOME_PAGE_SLUG) return HOME_PAGE_SLUG;
  return toAsciiLower(input)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/**
 * Normalises a project slug into a DNS label usable as `${slug}.${PLATFORM_ROOT_DOMAIN}`.
 * Returns an empty string when nothing usable survives, so the caller reports a validation error
 * instead of silently publishing a project under a generated hostname.
 */
export function normalizeProjectSlug(input: string): string {
  const normalized = toAsciiLower(input)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PROJECT_SLUG_MAX)
    .replace(/-+$/g, "");
  return normalized.length >= PROJECT_SLUG_MIN ? normalized : "";
}

export function isReservedSubdomain(slug: string, extraReserved: readonly string[] = []): boolean {
  const candidate = slug.toLowerCase();
  return (
    RESERVED_SUBDOMAINS.includes(candidate as (typeof RESERVED_SUBDOMAINS)[number]) ||
    extraReserved.some((reserved) => reserved.trim().toLowerCase() === candidate)
  );
}

/**
 * Normalises an incoming request hostname before it is resolved to a tenant: no port, no trailing
 * dot, lowercase, no control characters. Returns null when the value cannot be a valid hostname,
 * which the renderer answers with a neutral unknown-host response.
 */
export function normalizeHostname(input: string): string | null {
  const withoutPort = input.trim().replace(/:\d+$/, "");
  const withoutTrailingDot = withoutPort.replace(/\.$/, "");
  if (withoutTrailingDot.length === 0 || withoutTrailingDot.length > 253) return null;
  if (/[\u0000-\u001f\u007f\s]/.test(withoutTrailingDot)) return null;

  let ascii: string;
  try {
    // URL performs IDN -> Punycode conversion, so "café.example" resolves like "xn--caf-dma.example".
    ascii = new URL(`https://${withoutTrailingDot}`).hostname;
  } catch {
    return null;
  }
  if (!/^[a-z0-9.-]+$/.test(ascii)) return null;
  const labels = ascii.split(".");
  if (labels.some((label) => label.length === 0 || label.length > 63)) return null;
  if (labels.some((label) => label.startsWith("-") || label.endsWith("-"))) return null;
  return ascii;
}

export const pageSlugSchema = z
  .string()
  .refine((value) => value === HOME_PAGE_SLUG || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), {
    message: "must be \"/\" or a lowercase kebab-case segment",
  });

export const projectSlugSchema = z
  .string()
  .min(PROJECT_SLUG_MIN)
  .max(PROJECT_SLUG_MAX)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase DNS label")
  .refine((value) => !isReservedSubdomain(value), { message: "is a reserved platform hostname" });

export const hostnameSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeHostname(value);
  if (normalized === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "is not a valid hostname" });
    return z.NEVER;
  }
  return normalized;
});
