import { describe, expect, it } from "vitest";

import { EnvironmentError, loadEnv } from "../src/config/env";

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
