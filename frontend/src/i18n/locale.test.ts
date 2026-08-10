import { describe, expect, it } from "vitest";

import { matchBrowserLocale, resolveLocale } from "./locale";

describe("matchBrowserLocale", () => {
  it("matches an exact supported tag", () => {
    expect(matchBrowserLocale(["pt-BR"])).toBe("pt-BR");
    expect(matchBrowserLocale(["en-US"])).toBe("en-US");
  });

  it("falls back to the primary subtag", () => {
    expect(matchBrowserLocale(["pt-PT"])).toBe("pt-BR");
    expect(matchBrowserLocale(["pt"])).toBe("pt-BR");
    expect(matchBrowserLocale(["en-GB"])).toBe("en-US");
  });

  it("skips unsupported languages and keeps browser order", () => {
    expect(matchBrowserLocale(["de-DE", "fr", "pt-BR"])).toBe("pt-BR");
    expect(matchBrowserLocale(["de", "ja"])).toBeNull();
  });
});

describe("resolveLocale precedence", () => {
  it("prefers the saved account preference over everything else", () => {
    expect(
      resolveLocale({ accountLocale: "en-US", storedLocale: "pt-BR", browserLanguages: ["pt-BR"] }),
    ).toBe("en-US");
  });

  it("uses an explicit local choice when there is no account preference", () => {
    expect(resolveLocale({ storedLocale: "pt-BR", browserLanguages: ["en-US"] })).toBe("pt-BR");
  });

  it("falls back to the browser, then to en-US", () => {
    expect(resolveLocale({ browserLanguages: ["pt-PT"] })).toBe("pt-BR");
    expect(resolveLocale({ browserLanguages: ["de-DE"] })).toBe("en-US");
    expect(resolveLocale({})).toBe("en-US");
  });

  it("ignores an unsupported stored or account value instead of breaking", () => {
    expect(resolveLocale({ accountLocale: "xx-XX", storedLocale: "pt-BR" })).toBe("pt-BR");
    expect(resolveLocale({ storedLocale: "klingon", browserLanguages: ["en-GB"] })).toBe("en-US");
  });

  it("does not let a changed browser language override a saved preference", () => {
    expect(resolveLocale({ accountLocale: "pt-BR", browserLanguages: ["en-US", "de-DE"] })).toBe("pt-BR");
  });
});
