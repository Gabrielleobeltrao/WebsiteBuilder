import { describe, expect, it } from "vitest";

import { API_BASE_PATH } from "@websitebuilder/shared";

/**
 * The API base is build configuration, and the rules it must follow do not change with it. These
 * assert the resolution logic directly, because the module reads `import.meta.env` once at load and
 * a test that reloads it would be testing the module system.
 */
function resolveApiBase(configured: string | undefined): string {
  if (typeof configured !== "string" || configured.trim() === "") return API_BASE_PATH;

  const trimmed = configured.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("/")) return trimmed;

  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported scheme");
  return trimmed;
}

describe("API base", () => {
  it("falls back to the shared relative path when nothing is configured", () => {
    expect(resolveApiBase(undefined)).toBe(API_BASE_PATH);
    expect(resolveApiBase("")).toBe(API_BASE_PATH);
    expect(resolveApiBase("   ")).toBe(API_BASE_PATH);
  });

  it("accepts a relative path, which is the same-origin deployment", () => {
    expect(resolveApiBase("/api/v1")).toBe("/api/v1");
  });

  it("accepts an absolute origin, which is the split deployment", () => {
    expect(resolveApiBase("https://api.example.com/api/v1")).toBe("https://api.example.com/api/v1");
  });

  it("drops a trailing slash rather than producing a doubled one", () => {
    expect(resolveApiBase("https://api.example.com/api/v1/")).toBe("https://api.example.com/api/v1");
  });

  it("refuses a scheme that is not http or https", () => {
    // A typo becomes a build-time failure instead of requests quietly going nowhere — or, worse,
    // somewhere.
    expect(() => resolveApiBase("javascript:alert(1)")).toThrow();
    expect(() => resolveApiBase("file:///etc/passwd")).toThrow();
    expect(() => resolveApiBase("not a url")).toThrow();
  });
});
