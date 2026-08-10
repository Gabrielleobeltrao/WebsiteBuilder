import { z } from "zod";

/**
 * Every link a user can configure is stored as typed data, never as a raw href. One function turns
 * that data into an href, so `javascript:`, `data:` and friends have no path into rendered output.
 * Client and server validate through the same schemas — the client for feedback, the server as the
 * actual trust boundary.
 */

const ALWAYS_ALLOWED_PROTOCOLS = ["https:"] as const;
const DEVELOPMENT_ONLY_PROTOCOLS = ["http:"] as const;

export type SafeLink =
  | { kind: "none" }
  | { kind: "internal"; pageId: string }
  | { kind: "external"; url: string; newTab: boolean }
  | { kind: "email"; email: string }
  | { kind: "phone"; phone: string }
  | { kind: "whatsapp"; phone: string; message?: string };

/**
 * Parses an external URL, returning null unless it is absolute and uses an allowed protocol.
 * `allowHttp` exists only so local development can link to `http://localhost`.
 */
export function parseExternalUrl(input: string, options: { allowHttp?: boolean } = {}): URL | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const allowed: readonly string[] = options.allowHttp
    ? [...ALWAYS_ALLOWED_PROTOCOLS, ...DEVELOPMENT_ONLY_PROTOCOLS]
    : ALWAYS_ALLOWED_PROTOCOLS;
  if (!allowed.includes(url.protocol)) return null;
  if (url.hostname.length === 0) return null;
  return url;
}

export function isDangerousUrl(input: string): boolean {
  return parseExternalUrl(input, { allowHttp: true }) === null;
}

/** Keeps a leading "+" and digits only, so a phone number can never smuggle characters into href. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  return digits.length === 0 ? "" : `+${digits}`;
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((value) => /^\+\d{6,20}$/.test(value), { message: "must be a phone number with 6 to 20 digits" });

export const externalUrlSchema = z.string().superRefine((value, ctx) => {
  if (parseExternalUrl(value) === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be an absolute https URL" });
  }
});

export const safeLinkSchema: z.ZodType<SafeLink> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("internal"), pageId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("external"), url: externalUrlSchema, newTab: z.boolean() }).strict(),
  z.object({ kind: z.literal("email"), email: emailSchema }).strict(),
  z.object({ kind: z.literal("phone"), phone: phoneSchema }).strict(),
  z
    .object({ kind: z.literal("whatsapp"), phone: phoneSchema, message: z.string().max(1000).optional() })
    .strict(),
]);

export type ResolvedHref = {
  href: string;
  target?: "_blank";
  rel?: "noopener noreferrer";
};

export type ResolveLinkOptions = {
  /** Maps an internal page ID to its path. Return null when the page no longer exists. */
  resolvePagePath: (pageId: string) => string | null;
  allowHttp?: boolean;
};

/**
 * Turns typed link data into an href. Returns null for an unconfigured link, a deleted internal
 * target, or any value that fails validation — callers render a non-navigating element instead,
 * which is what makes a broken link visible rather than dangerous.
 */
export function resolveSafeLinkHref(link: SafeLink, options: ResolveLinkOptions): ResolvedHref | null {
  switch (link.kind) {
    case "none":
      return null;
    case "internal": {
      const path = options.resolvePagePath(link.pageId);
      return path === null ? null : { href: path };
    }
    case "external": {
      const url = parseExternalUrl(link.url, { allowHttp: options.allowHttp ?? false });
      if (url === null) return null;
      return link.newTab
        ? { href: url.toString(), target: "_blank", rel: "noopener noreferrer" }
        : { href: url.toString() };
    }
    case "email": {
      const parsed = emailSchema.safeParse(link.email);
      return parsed.success ? { href: `mailto:${parsed.data}` } : null;
    }
    case "phone": {
      const parsed = phoneSchema.safeParse(link.phone);
      return parsed.success ? { href: `tel:${parsed.data}` } : null;
    }
    case "whatsapp": {
      const parsed = phoneSchema.safeParse(link.phone);
      if (!parsed.success) return null;
      const digits = parsed.data.slice(1);
      const query = link.message ? `?text=${encodeURIComponent(link.message)}` : "";
      return { href: `https://wa.me/${digits}${query}`, target: "_blank", rel: "noopener noreferrer" };
    }
  }
}
