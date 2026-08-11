import { API_BASE_PATH } from "@websitebuilder/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The resolver reads `import.meta.env` on every call, so each case stubs it and re-imports nothing.
 * Both clients depend on these answers agreeing — when they did not, one of them called the
 * application's own origin and parsed `index.html` as JSON.
 */
async function withEnv<T>(value: string | undefined, run: (module: typeof import("./endpoint")) => T): Promise<T> {
  vi.stubEnv("VITE_API_URL", value ?? "");
  const module = await import("./endpoint");
  return run(module);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("same origin", () => {
  it("falls back to the shared relative path when nothing is configured", async () => {
    await withEnv(undefined, ({ apiBase, apiOrigin }) => {
      expect(apiBase()).toBe(API_BASE_PATH);
      expect(apiOrigin()).toBeNull();
    });
  });

  it("treats a relative path as this origin, so the auth client stays unconfigured", async () => {
    await withEnv("/api/v1", ({ apiBase, apiOrigin }) => {
      expect(apiBase()).toBe("/api/v1");
      expect(apiOrigin()).toBeNull();
    });
  });
});

describe("split deployment", () => {
  it("gives the API its full base and the auth client the bare origin", async () => {
    // Auth lives at a different path on the same host, so it needs the origin rather than the base.
    await withEnv("https://api.example.com/api/v1", ({ apiBase, apiOrigin }) => {
      expect(apiBase()).toBe("https://api.example.com/api/v1");
      expect(apiOrigin()).toBe("https://api.example.com");
    });
  });

  it("drops a trailing slash rather than producing a doubled one", async () => {
    await withEnv("https://api.example.com/api/v1/", ({ apiBase }) => {
      expect(apiBase()).toBe("https://api.example.com/api/v1");
    });
  });

  it("keeps a non-default port, which a naive origin would lose", async () => {
    await withEnv("http://localhost:3000/api/v1", ({ apiOrigin }) => {
      expect(apiOrigin()).toBe("http://localhost:3000");
    });
  });
});

describe("refusals", () => {
  it("refuses a scheme that is neither http nor https", async () => {
    // A typo becomes a build-time failure instead of requests going somewhere nobody intended.
    for (const value of ["javascript:alert(1)", "file:///etc/passwd"]) {
      await withEnv(value, ({ apiBase }) => {
        expect(() => apiBase()).toThrow();
      });
    }
  });

  it("refuses something that is not a URL at all", async () => {
    await withEnv("api.example.com", ({ apiBase }) => {
      expect(() => apiBase()).toThrow();
    });
  });
});
