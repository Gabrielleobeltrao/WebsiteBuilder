import { API_BASE_PATH, apiErrorSchema, type ApiErrorCode, type ApiErrorDetail } from "@websitebuilder/shared";

/**
 * Typed fetch wrapper.
 *
 * Requests are same-origin by construction: the base path is relative, which mirrors production
 * where the gateway proxies `/api/*` to the private backend. Nothing here may build an absolute
 * API URL, because that would reintroduce the cross-origin cookie and CORS problems the
 * single-origin decision exists to avoid.
 */
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
    response = await fetch(`${API_BASE_PATH}${path}`, {
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
