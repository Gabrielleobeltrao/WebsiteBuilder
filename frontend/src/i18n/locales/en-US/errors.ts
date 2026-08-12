/**
 * Keyed by the stable, language-neutral error codes the API returns. Backend messages are for logs
 * and developers; what a user reads is always resolved here.
 */
export default {
  VALIDATION_ERROR: "Some information is not valid. Check the highlighted fields.",
  UNAUTHENTICATED: "You need to sign in to continue.",
  FORBIDDEN: "You do not have permission to do this.",
  NOT_FOUND: "We could not find what you were looking for.",
  REVISION_CONFLICT: "This was changed somewhere else after you opened it. Reload to see the newest version.",
  RESOURCE_IN_USE: "Something still uses this, so it cannot be removed yet.",
  SLUG_TAKEN: "That address is already in use. Choose another one.",
  PAYLOAD_TOO_LARGE: "This content is too large to save.",
  RATE_LIMITED: "Too many attempts. Wait a moment and try again.",
  UNSUPPORTED_MEDIA_TYPE: "This file type is not supported.",
  UNKNOWN_HOST: "This address is not connected to a published site.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable. Try again shortly.",
  INTERNAL_ERROR: "Something went wrong on our side. Try again.",
  NETWORK_ERROR: "We could not reach the server. Check your connection and try again.",
} as const;
