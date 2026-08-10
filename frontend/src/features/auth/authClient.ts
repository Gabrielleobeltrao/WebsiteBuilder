import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Same-origin auth client. The base URL is a relative path on purpose: production serves the SaaS
 * from one origin and proxies `/api/*` to the private backend, so an absolute URL here would
 * reintroduce the cross-origin cookie problem that architecture exists to avoid.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [organizationClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
