import { describe, expect, it } from "vitest";

import { EnvironmentError, loadEnv, presentVariables } from "../src/config/env";

describe("loadEnv", () => {
  it("applies development defaults", () => {
    const env = loadEnv({} as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_PORT).toBe(3000);
    expect(env.PUBLIC_RENDERER_PORT).toBe(3001);
    expect(env.isProduction).toBe(false);
  });

  it("rejects an invalid port instead of starting on a wrong one", () => {
    expect(() => loadEnv({ API_PORT: "not-a-port" } as NodeJS.ProcessEnv)).toThrow(EnvironmentError);
    expect(() => loadEnv({ API_PORT: "99999" } as NodeJS.ProcessEnv)).toThrow(EnvironmentError);
  });

  it("requires database configuration in production", () => {
    const production = {
      NODE_ENV: "production",
      FRONTEND_ORIGIN: "https://osistema.com",
      PLATFORM_PUBLIC_ORIGIN: "https://osistema.com",
      PLATFORM_ROOT_DOMAIN: "osistema.com",
    } as NodeJS.ProcessEnv;

    expect(() => loadEnv(production)).toThrow(EnvironmentError);
    expect(() =>
      loadEnv({
        ...production,
        MONGODB_URI: "mongodb://localhost:27017",
        MONGODB_DB_NAME: "builder",
        BETTER_AUTH_SECRET: "a".repeat(32),
      }),
    ).not.toThrow();
  });

  it("requires an authentication secret in production", () => {
    const production = {
      NODE_ENV: "production",
      FRONTEND_ORIGIN: "https://osistema.com",
      PLATFORM_PUBLIC_ORIGIN: "https://osistema.com",
      PLATFORM_ROOT_DOMAIN: "osistema.com",
      MONGODB_URI: "mongodb://localhost:27017",
      MONGODB_DB_NAME: "builder",
    } as NodeJS.ProcessEnv;

    expect(() => loadEnv(production)).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("rejects a session secret that is too short to be safe", () => {
    expect(() => loadEnv({ BETTER_AUTH_SECRET: "too-short" } as NodeJS.ProcessEnv)).toThrow(EnvironmentError);
  });

  it("names the missing variables without echoing any value", () => {
    try {
      loadEnv({ NODE_ENV: "production", MONGODB_URI: "mongodb://user:secret@host/db" } as NodeJS.ProcessEnv);
      expect.unreachable("expected an EnvironmentError");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentError);
      const message = (error as EnvironmentError).message;
      expect(message).toContain("MONGODB_DB_NAME");
      expect(message).not.toContain("secret");
    }
  });

  it("parses the reserved subdomain list", () => {
    const env = loadEnv({ PLATFORM_RESERVED_SUBDOMAINS: " Beta , internal ,," } as NodeJS.ProcessEnv);
    expect(env.reservedSubdomains).toEqual(["beta", "internal"]);
  });
});

describe("production safety", () => {
  const production = {
    NODE_ENV: "production",
    MONGODB_URI: "mongodb://localhost:27017",
    MONGODB_DB_NAME: "app",
    BETTER_AUTH_SECRET: "x".repeat(32),
    FRONTEND_ORIGIN: "https://osistema.com",
    PLATFORM_PUBLIC_ORIGIN: "https://osistema.com",
    PLATFORM_ROOT_DOMAIN: "osistema.com",
  } as NodeJS.ProcessEnv;

  it("names the missing variable and never a value", () => {
    const error = (() => {
      try {
        loadEnv({ ...production, BETTER_AUTH_SECRET: undefined } as NodeJS.ProcessEnv);
        return null;
      } catch (thrown) {
        return thrown as EnvironmentError;
      }
    })();

    // Names the variable and says which mistake it is: an operator reading a container log has
    // nothing else to go on, and "not set" and "too short" need different fixes.
    expect(error?.missing).toContain("BETTER_AUTH_SECRET is not set");
    // A message that quotes the value is a secret printed into every log collector.
    expect(error?.message).not.toContain("x".repeat(32));
  });

  it("distinguishes a secret that is too short from one that is absent", () => {
    const failure = (secret: string | undefined) => {
      try {
        loadEnv({ ...production, BETTER_AUTH_SECRET: secret } as NodeJS.ProcessEnv);
        return null;
      } catch (thrown) {
        return (thrown as EnvironmentError).missing.join(" ");
      }
    };

    // Two different mistakes needing two different fixes, and an operator reading a container log
    // has only this line to tell them apart.
    expect(failure(undefined)).toContain("is not set");
    expect(failure("too-short")).toContain("32");
    expect(failure("too-short")).not.toContain("is not set");

    // Neither ever quotes the value.
    expect(failure("too-short")).not.toContain("too-short");
  });

  it("treats whitespace as absent rather than as a value", () => {
    // A variable set to an empty string in a deployment UI is the same mistake as not setting it.
    expect(() => loadEnv({ ...production, MONGODB_DB_NAME: "   " } as NodeJS.ProcessEnv)).toThrow(EnvironmentError);
  });

  it("trusts no proxy until a range is configured", () => {
    expect(loadEnv(production).trustedProxyCidrs).toEqual([]);
    expect(loadEnv({ ...production, TRUSTED_PROXY_CIDRS: "10.0.0.0/8, 172.16.0.0/12" }).trustedProxyCidrs).toEqual([
      "10.0.0.0/8",
      "172.16.0.0/12",
    ]);
  });

  it("keeps every reserved subdomain the platform routes on", () => {
    const env = loadEnv({
      ...production,
      PLATFORM_RESERVED_SUBDOMAINS: "www,app,api,admin,origin,customers,coolify,status,mail,cdn,assets,static,docs,support",
    } as NodeJS.ProcessEnv);

    for (const reserved of ["api", "app", "origin", "customers"]) {
      expect(env.reservedSubdomains).toContain(reserved);
    }
  });

  it("defaults the publication limits rather than leaving them unset", () => {
    const env = loadEnv(production);
    expect(env.PUBLISHED_VERSION_RETENTION_COUNT).toBeGreaterThan(0);
    expect(env.PUBLISH_MAX_DOCUMENT_BYTES).toBeGreaterThan(0);
  });
});

describe("startup diagnostics", () => {
  it("reports which known variables arrived, by name only", () => {
    const present = presentVariables({
      BETTER_AUTH_SECRET: "x".repeat(40),
      MONGODB_URI: "mongodb://localhost:27017",
      UNRELATED: "ignored",
    } as NodeJS.ProcessEnv);

    expect(present).toEqual(["MONGODB_URI", "BETTER_AUTH_SECRET"]);
    // A value here is a value leaked into every log collector downstream.
    expect(present.join(" ")).not.toContain("x".repeat(40));
  });

  it("treats an empty or whitespace value as absent", () => {
    expect(presentVariables({ MONGODB_URI: "", MONGODB_DB_NAME: "   " } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("returns nothing when no environment arrived at all", () => {
    // Which is a different problem from one variable never being saved, and needs a different fix.
    expect(presentVariables({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe("service roles", () => {
  const production = {
    NODE_ENV: "production",
    MONGODB_URI: "mongodb://localhost:27017",
    MONGODB_DB_NAME: "app",
    PLATFORM_PUBLIC_ORIGIN: "https://websitebuilder.example.com",
    PLATFORM_ROOT_DOMAIN: "websitebuilder.example.com",
    FRONTEND_ORIGIN: "https://websitebuilder.example.com",
  } as NodeJS.ProcessEnv;

  it("accepts a valid production API environment", () => {
    const env = loadEnv({ ...production, BETTER_AUTH_SECRET: "x".repeat(40) }, "api");
    expect(env.isProduction).toBe(true);
  });

  it("accepts a valid production renderer environment without an auth secret", () => {
    // The renderer serves published snapshots and has no sessions. Demanding the signing secret
    // would hand a credential to a process that can only widen its blast radius.
    expect(() => loadEnv(production, "renderer")).not.toThrow();
  });

  it("still refuses an API without its secret", () => {
    expect(() => loadEnv(production, "api")).toThrow(EnvironmentError);
  });

  it("refuses either role without database configuration", () => {
    const { MONGODB_URI, ...withoutDatabase } = production;

    for (const role of ["api", "renderer"] as const) {
      expect(() => loadEnv(withoutDatabase as NodeJS.ProcessEnv, role)).toThrow(EnvironmentError);
    }
  });

  it("keeps error messages free of values for both roles", () => {
    const secret = "x".repeat(40);
    const failure = (role: "api" | "renderer") => {
      try {
        loadEnv({ ...production, MONGODB_URI: "", BETTER_AUTH_SECRET: secret }, role);
        return "";
      } catch (thrown) {
        return (thrown as EnvironmentError).message;
      }
    };

    for (const role of ["api", "renderer"] as const) {
      expect(failure(role)).toContain("MONGODB_URI");
      expect(failure(role)).not.toContain(secret);
    }
  });

  it("defaults to the API role, which is the stricter of the two", () => {
    // A caller that forgets to say which process it is gets the requirements that refuse more.
    expect(() => loadEnv(production)).toThrow(EnvironmentError);
  });
});

describe("a deployment platform sets blanks, not absences", () => {
  /**
   * This is the exact shape the production Compose file produces. `${VAR:-}` yields an empty
   * string, and Zod's `.optional()` and `.default()` recognise only `undefined`, so every
   * "leave it blank to disable" value was being validated as if someone had typed one deliberately.
   *
   * The backend refused to start in production because of it, with three Cloudflare variables it
   * does not need.
   */
  const asComposeWouldPassIt = {
    NODE_ENV: "production",
    MONGODB_URI: "mongodb://localhost:27017",
    MONGODB_DB_NAME: "app",
    BETTER_AUTH_SECRET: "x".repeat(40),
    PLATFORM_PUBLIC_ORIGIN: "https://websitebuilder.example.com",
    PLATFORM_ROOT_DOMAIN: "websitebuilder.example.com",
    FRONTEND_ORIGIN: "https://websitebuilder.example.com",
    PUBLIC_RENDERER_HOST: "origin.websitebuilder.example.com",
    // Unset by the operator; passed as empty by the platform.
    CLOUDFLARE_ZONE_ID: "",
    CLOUDFLARE_API_TOKEN: "",
    CLOUDFLARE_SAAS_CNAME_TARGET: "",
    TRUSTED_PROXY_CIDRS: "",
  } as NodeJS.ProcessEnv;

  it("starts with every optional value passed as an empty string", () => {
    expect(() => loadEnv(asComposeWouldPassIt, "api")).not.toThrow();
    expect(() => loadEnv(asComposeWouldPassIt, "renderer")).not.toThrow();
  });

  it("reads a blank optional value as absent rather than as a value", () => {
    const env = loadEnv(asComposeWouldPassIt, "api");

    expect(env.CLOUDFLARE_ZONE_ID).toBeUndefined();
    expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined();
  });

  it("falls back to the default when a defaulted value arrives blank", () => {
    const env = loadEnv(asComposeWouldPassIt, "api");
    expect(env.CLOUDFLARE_SAAS_CNAME_TARGET).toBe("customers.localhost");
  });

  it("still refuses a blank value that is genuinely required", () => {
    // Blank means absent, and absent is exactly what these may not be.
    expect(() => loadEnv({ ...asComposeWouldPassIt, MONGODB_URI: "" }, "api")).toThrow(EnvironmentError);
    expect(() => loadEnv({ ...asComposeWouldPassIt, BETTER_AUTH_SECRET: "   " }, "api")).toThrow(EnvironmentError);
  });

  it("still refuses a value that is present and wrong", () => {
    expect(() => loadEnv({ ...asComposeWouldPassIt, BETTER_AUTH_SECRET: "too-short" }, "api")).toThrow(
      EnvironmentError,
    );
  });
});

/**
 * Running beside other projects.
 *
 * The API and the renderer took their ports from the environment from the start; the web server's
 * was a literal in the Vite config and the three origins that describe it were literals here. So a
 * developer with something else on 5173 could move some of the stack and not the rest, and the
 * half-moved state is worse than the clash: the dev server loads and sign-in fails, because the
 * session cookie is issued for an origin the browser is not on.
 */
describe("moving the development ports", () => {
  it("points the origins at the web port when nothing names them", () => {
    const env = loadEnv({ WEB_PORT: "5273" });

    expect(env.FRONTEND_ORIGIN).toBe("http://localhost:5273");
    expect(env.PLATFORM_PUBLIC_ORIGIN).toBe("http://localhost:5273");
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:5273");
  });

  it("keeps the default port when nothing is set at all", () => {
    const env = loadEnv({});

    expect(env.WEB_PORT).toBe(5173);
    expect(env.FRONTEND_ORIGIN).toBe("http://localhost:5173");
  });

  it("never replaces an origin somebody set", () => {
    // Production names all three explicitly, and a derived value must not overwrite one of them.
    const env = loadEnv({ WEB_PORT: "5273", FRONTEND_ORIGIN: "https://app.example.com" });

    expect(env.FRONTEND_ORIGIN).toBe("https://app.example.com");
    expect(env.PLATFORM_PUBLIC_ORIGIN).toBe("http://localhost:5273");
  });
});
