import { pino, type Logger } from "pino";

import type { Env } from "./env";

/**
 * Backend logs are English and structured. Anything that could carry a credential, a session token
 * or a visitor's submitted content is redacted here rather than at each call site.
 */
export function createLogger(env: Pick<Env, "LOG_LEVEL" | "isTest">): Logger {
  return pino({
    level: env.isTest ? "silent" : env.LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body",
        "res.headers['set-cookie']",
        "*.password",
        "*.token",
        "*.secret",
        "*.MONGODB_URI",
        "*.CLOUDFLARE_API_TOKEN",
        "*.BETTER_AUTH_SECRET",
      ],
      censor: "[redacted]",
    },
  });
}
