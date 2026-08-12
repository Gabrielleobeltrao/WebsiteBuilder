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
