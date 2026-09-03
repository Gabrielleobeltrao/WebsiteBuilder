import { elementsForContext, SUPPORTED_APP_LOCALES } from "@websitebuilder/shared";
import { describe, expect, it } from "vitest";

import { NAMESPACES, resources } from "./resources";

/** Flattens a nested catalogue into dotted key paths so two locales can be compared exactly. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

describe("translation catalogues", () => {
  it("covers every supported locale", () => {
    expect(Object.keys(resources).sort()).toEqual([...SUPPORTED_APP_LOCALES].sort());
  });

  for (const namespace of NAMESPACES) {
    it(`has identical keys in both locales for "${namespace}"`, () => {
      const english = keyPaths(resources["en-US"][namespace]).sort();
      const portuguese = keyPaths(resources["pt-BR"][namespace]).sort();

      expect(portuguese.filter((key) => !english.includes(key))).toEqual([]);
      expect(english.filter((key) => !portuguese.includes(key))).toEqual([]);
    });

    it(`has no empty string in "${namespace}"`, () => {
      for (const locale of SUPPORTED_APP_LOCALES) {
        const stack: Array<[string, unknown]> = Object.entries(resources[locale][namespace]);
        while (stack.length > 0) {
          const entry = stack.pop();
          if (!entry) break;
          const [key, value] = entry;
          if (typeof value === "string") {
            expect(value.trim(), `${locale}/${namespace}.${key} is empty`).not.toBe("");
          } else if (typeof value === "object" && value !== null) {
            stack.push(...Object.entries(value));
          }
        }
      }
    });
  }

  it("does not leave a Portuguese value identical to English for translatable prose", () => {
    // Product and status names legitimately match; long sentences matching means a forgotten
    // translation, which key parity alone cannot catch.
    const english = resources["en-US"].public.landing;
    const portuguese = resources["pt-BR"].public.landing;
    expect(portuguese.hero.title).not.toBe(english.hero.title);
    expect(portuguese.hero.subtitle).not.toBe(english.hero.subtitle);
    expect(portuguese.metaDescription).not.toBe(english.metaDescription);
  });
});

/**
 * Every block a blog layout offers must be nameable in both languages.
 *
 * The catalog labels a block through `builder.elements.<type>.name`. A context that offers a block
 * with no entry there shows its raw type id — English debug output inside a Portuguese panel.
 */
describe("names for the blocks each blog layout offers", () => {
  for (const context of ["blogIndexTemplate", "blogArticleTemplate"] as const) {
    it(`covers every block offered in ${context}`, () => {
      for (const definition of elementsForContext(context)) {
        for (const locale of SUPPORTED_APP_LOCALES) {
          const names = resources[locale].builder.elements as Record<string, string | undefined>;
          expect(names[definition.labelKey], `${definition.labelKey} in ${locale}`).toBeTruthy();
        }
      }
    });
  }
});
