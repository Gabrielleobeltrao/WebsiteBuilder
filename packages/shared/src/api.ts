import { z } from "zod";

/**
 * Error codes are stable, language-neutral and part of the API contract. The frontend maps them to
 * locale resources; backend messages exist for logs and developers, never for end users.
 */
export const API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "REVISION_CONFLICT",
  "RESOURCE_IN_USE",
  "SLUG_TAKEN",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "UNSUPPORTED_MEDIA_TYPE",
  "UNKNOWN_HOST",
  "SERVICE_UNAVAILABLE",
  /**
   * The stored document is one this build must not act on.
   *
   * A newer deployment's record, or one that no longer parses. Distinct from a validation error,
   * which is about what the caller sent: this is about what is already there.
   */
  "UNSUPPORTED_DOCUMENT",
  "INTERNAL_ERROR",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ApiErrorDetail = { path: string; message: string };

export type ApiError = {
  error: { code: ApiErrorCode; message: string; details?: ApiErrorDetail[] };
};

export type ApiSuccess<T> = { data: T };

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

export const API_BASE_PATH = "/api/v1";

export const HTTP_STATUS_BY_ERROR_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  RESOURCE_IN_USE: 409,
  SLUG_TAKEN: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNKNOWN_HOST: 404,
  UNSUPPORTED_DOCUMENT: 409,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export const SUPPORTED_APP_LOCALES = ["pt-BR", "en-US"] as const;
export type SupportedAppLocale = (typeof SUPPORTED_APP_LOCALES)[number];
export const DEFAULT_APP_LOCALE: SupportedAppLocale = "en-US";

export const userPreferencesSchema = z
  .object({ locale: z.enum(SUPPORTED_APP_LOCALES) })
  .strict();

export type UserPreferencesInput = z.infer<typeof userPreferencesSchema>;

/** Summary returned by project listing endpoints. Never the whole builder document. */
export type ProjectSummary = {
  id: string;
  name: string;
  slug: string;
  clientId?: string;
  pageCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Whether a version of this site is live. Not the same as having somewhere to serve it. */
  isPublished: boolean;
  /**
   * The address a visitor can open right now.
   *
   * Present only when the site is genuinely serving — it has an active published version *and* a
   * live primary hostname. A site that was never published, or whose address is still being
   * verified, has no live URL, and offering one would be a link to a page that does not exist.
   */
  liveUrl?: string;
  /**
   * Everything the site list's disclosure shows, measured in the same request as the list itself.
   *
   * A card that asked its own question would mean one request per site: the list gets slower with
   * every site a customer adds, and the page jumps as each answer lands. So the answers travel with
   * the row, and the ones nobody is measuring say so rather than reporting a zero.
   */
  summary?: ProjectCardSummary;
};

/** Codes the card can state without loading a builder document. The site's own page is the full answer. */
export const PROJECT_CARD_BLOCKERS = ["no-address", "blog-setup"] as const;
export type ProjectCardBlocker = (typeof PROJECT_CARD_BLOCKERS)[number];

export type ProjectCardSummary = {
  /** Edits saved since the live version was compiled. False for a site that was never published. */
  hasPendingChanges: boolean;
  /**
   * Known blockers only, and named so.
   *
   * A list cannot run the full pre-publish audit for every site without loading every document,
   * which is the cost this whole shape exists to avoid. These are the ones a batched query answers;
   * the site's own dashboard runs the rest.
   */
  knownBlockers: readonly ProjectCardBlocker[];
  /**
   * Traffic over the window, or the reason there is none to show.
   *
   * `unavailable` is not zero. Server counting starts at the first publication, so a site that has
   * never been live has nothing measured rather than no visitors, and `visitors` is null until the
   * site owner turns on browser measurement — the two numbers have different sources and different
   * consent, and collapsing either into 0 tells the reader something untrue.
   */
  traffic:
    | { state: "measured"; days: number; views: number; visitors: number | null }
    | { state: "unavailable" };
};

export const createProjectInputSchema = z
  .object({ name: z.string().trim().min(1).max(160), clientId: z.string().min(1).optional() })
  .strict();

export const renameProjectInputSchema = z
  .object({ name: z.string().trim().min(1).max(160) })
  .strict();

export const saveDocumentInputSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .passthrough();
