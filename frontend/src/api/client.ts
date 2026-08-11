import { API_BASE_PATH, apiErrorSchema, type ApiErrorCode, type ApiErrorDetail } from "@websitebuilder/shared";

/**
 * Typed fetch wrapper.
 *
 * The API base comes from build configuration: a relative path when the API shares the origin, or
 * an absolute origin when it is deployed as its own host. It is never derived from anything a
 * request or a document supplies — an API URL that user data can influence is how a session token
 * ends up being sent somewhere nobody intended.
 *
 * `credentials: "include"` is what carries the session cookie to a different host on the same
 * registrable domain. The server answers only the one origin it was configured with.
 */
const API_BASE = resolveApiBase();

function resolveApiBase(): string {
  const configured = import.meta.env.VITE_API_URL;
  if (typeof configured !== "string" || configured.trim() === "") return API_BASE_PATH;

  const trimmed = configured.trim().replace(/\/+$/, "");

  // A relative path is used as given. An absolute one must be a real origin, so a typo becomes a
  // build-time failure rather than requests quietly going nowhere.
  if (trimmed.startsWith("/")) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported scheme");
    return trimmed;
  } catch {
    throw new Error("VITE_API_URL must be a relative path or an absolute http(s) URL");
  }
}
export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode | "NETWORK_ERROR",
    public readonly status: number,
    public readonly details?: ApiErrorDetail[],
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("NETWORK_ERROR", 0);
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new ApiError(parsed.data.error.code, response.status, parsed.data.error.details);
    }
    throw new ApiError("INTERNAL_ERROR", response.status);
  }

  if (typeof payload !== "object" || payload === null || !("data" in payload)) {
    throw new ApiError("INTERNAL_ERROR", response.status);
  }
  return (payload as { data: T }).data;
}
