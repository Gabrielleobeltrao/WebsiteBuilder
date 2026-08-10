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
      loadEnv({ ...production, MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB_NAME: "builder" }),
    ).not.toThrow();
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
