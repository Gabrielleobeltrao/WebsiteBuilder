/**
 * Return paths come from the URL, so they are attacker-controlled. Only a same-origin absolute
 * path is ever accepted — anything else (a scheme, a protocol-relative URL, a backslash trick)
 * collapses to the dashboard root, which is what stops an open redirect after login.
 */
export const DEFAULT_RETURN_PATH = "/app";

export function safeReturnPath(candidate: string | null | undefined): string {
  if (typeof candidate !== "string") return DEFAULT_RETURN_PATH;

  const trimmed = candidate.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return DEFAULT_RETURN_PATH;
  if (!trimmed.startsWith("/")) return DEFAULT_RETURN_PATH;
  // "//host" and "/\host" are both browser-recognised protocol-relative URLs.
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return DEFAULT_RETURN_PATH;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return DEFAULT_RETURN_PATH;

  return trimmed;
}
