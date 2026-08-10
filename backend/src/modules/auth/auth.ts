import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { organization } from "better-auth/plugins";
import type { Db } from "mongodb";

import type { Env } from "../../config/env";

/**
 * Better Auth owns sessions and organization membership. The application never issues its own
 * session token and never reads a role from the client: every authorisation decision starts from a
 * verified session and the membership records this plugin maintains.
 */
export function createAuth(options: { db: Db; env: Env }) {
  const { db, env } = options;

  if (!env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is required to configure authentication");
  }

  return betterAuth({
    database: mongodbAdapter(db),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: env.BETTER_AUTH_BASE_PATH,
    emailAndPassword: {
      enabled: true,
      // Verification e-mail delivery needs a provider, which this scope deliberately excludes.
      requireEmailVerification: false,
      minPasswordLength: 12,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      // The SaaS has one origin, so the session cookie does not need to be shared across
      // subdomains — narrower is safer.
      useSecureCookies: env.isProduction,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
    },
    // Only the product's own origin may drive the auth flow.
    trustedOrigins: [env.FRONTEND_ORIGIN, env.PLATFORM_PUBLIC_ORIGIN],
    plugins: [organization()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
