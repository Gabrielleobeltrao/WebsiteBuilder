import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { apiOrigin } from "@/api/endpoint";

/**
 * The auth client points wherever the rest of the API does.
 *
 * It reads the same configuration as the typed fetch wrapper, because two clients disagreeing about
 * the backend's address is not a visible failure: `/api/auth/*` on this origin falls through to the
 * SPA and returns `index.html`, and a login page parsed as JSON surfaces as a rejected sign-in with
 * nothing pointing at the real cause.
 *
 * `baseURL` is omitted when the API shares this origin, which is what Better Auth expects for the
 * same-origin shape.
 */
const origin = apiOrigin();

export const authClient = createAuthClient({
  ...(origin === null ? {} : { baseURL: origin }),
  basePath: "/api/auth",
  plugins: [organizationClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
