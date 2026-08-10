import { describe, expect, it } from "vitest";

import {
  isDangerousUrl,
  normalizePhone,
  parseExternalUrl,
  resolveSafeLinkHref,
  safeLinkSchema,
  type SafeLink,
} from "./links";

const resolvePagePath = (pageId: string) => (pageId === "home" ? "/" : pageId === "about" ? "/about" : null);

describe("parseExternalUrl", () => {
  const dangerous = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)  ",
    "java\tscript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "about:blank",
    "blob:https://example.com/1234",
    "//example.com",
    "/relative/path",
    "",
    "   ",
    "not a url",
  ];

  for (const input of dangerous) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      expect(parseExternalUrl(input, { allowHttp: true })).toBeNull();
      expect(isDangerousUrl(input)).toBe(true);
    });
  }

  it("accepts absolute https URLs", () => {
    expect(parseExternalUrl("https://example.com/path?q=1")?.toString()).toBe("https://example.com/path?q=1");
  });

  it("rejects http unless development explicitly allows it", () => {
    expect(parseExternalUrl("http://localhost:5173")).toBeNull();
    expect(parseExternalUrl("http://localhost:5173", { allowHttp: true })?.hostname).toBe("localhost");
  });

  it("rejects an absurdly long URL instead of storing it", () => {
    expect(parseExternalUrl(`https://example.com/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("safeLinkSchema", () => {
  it("rejects an external link carrying a dangerous protocol", () => {
    expect(safeLinkSchema.safeParse({ kind: "external", url: "javascript:alert(1)", newTab: false }).success).toBe(
      false,
    );
  });

  it("rejects unknown properties rather than storing them", () => {
    expect(safeLinkSchema.safeParse({ kind: "internal", pageId: "home", onClick: "steal()" }).success).toBe(false);
  });

  it("accepts each supported link kind", () => {
    const links: SafeLink[] = [
      { kind: "none" },
      { kind: "internal", pageId: "home" },
      { kind: "external", url: "https://example.com", newTab: true },
      { kind: "email", email: "person@example.com" },
      { kind: "phone", phone: "+55 (11) 99999-9999" },
      { kind: "whatsapp", phone: "5511999999999", message: "Olá" },
    ];
    for (const link of links) expect(safeLinkSchema.safeParse(link).success).toBe(true);
  });

  it("rejects a phone number with too few digits", () => {
    expect(safeLinkSchema.safeParse({ kind: "phone", phone: "123" }).success).toBe(false);
  });
});

describe("resolveSafeLinkHref", () => {
  it("returns null for an unconfigured link so nothing navigates", () => {
    expect(resolveSafeLinkHref({ kind: "none" }, { resolvePagePath })).toBeNull();
  });

  it("returns null for an internal link whose page was deleted", () => {
    expect(resolveSafeLinkHref({ kind: "internal", pageId: "gone" }, { resolvePagePath })).toBeNull();
  });

  it("resolves an internal page to its path", () => {
    expect(resolveSafeLinkHref({ kind: "internal", pageId: "about" }, { resolvePagePath })).toEqual({
      href: "/about",
    });
  });

  it("adds noopener noreferrer to new-tab external links", () => {
    expect(
      resolveSafeLinkHref({ kind: "external", url: "https://example.com", newTab: true }, { resolvePagePath }),
    ).toEqual({ href: "https://example.com/", target: "_blank", rel: "noopener noreferrer" });
  });

  it("never produces an href for a dangerous stored URL, even if it bypassed validation", () => {
    const smuggled = { kind: "external", url: "javascript:alert(1)", newTab: false } as SafeLink;
    expect(resolveSafeLinkHref(smuggled, { resolvePagePath })).toBeNull();
  });

  it("builds mailto, tel and wa.me hrefs from typed data", () => {
    expect(resolveSafeLinkHref({ kind: "email", email: "Person@Example.com" }, { resolvePagePath })).toEqual({
      href: "mailto:person@example.com",
    });
    expect(resolveSafeLinkHref({ kind: "phone", phone: "+55 11 99999-9999" }, { resolvePagePath })).toEqual({
      href: "tel:+5511999999999",
    });
    expect(
      resolveSafeLinkHref({ kind: "whatsapp", phone: "5511999999999", message: "a b&c" }, { resolvePagePath }),
    ).toEqual({
      href: "https://wa.me/5511999999999?text=a%20b%26c",
      target: "_blank",
      rel: "noopener noreferrer",
    });
  });
});

describe("normalizePhone", () => {
  it("keeps only digits behind a single leading plus", () => {
    expect(normalizePhone("+55 (11) 99999-9999")).toBe("+5511999999999");
    expect(normalizePhone("abc")).toBe("");
  });
});
