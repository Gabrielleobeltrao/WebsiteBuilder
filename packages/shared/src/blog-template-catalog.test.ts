import { describe, expect, it } from "vitest";

import { elementsForContext } from "./element-registry";
import { builderElementSchema } from "./elements";
import { legacyProjectDocument } from "./legacy-fixtures";

/**
 * What each blog layout is allowed to offer.
 *
 * One shared context meant both templates offered the same twenty-five blocks, so a designer laying
 * out an article was shown a post-list block with no list to draw, beside feature grids, data tables
 * and download buttons that have no relationship to a blog at all. The two layouts answer different
 * questions and now have different answers.
 */

const typesFor = (context: Parameters<typeof elementsForContext>[0]) =>
  elementsForContext(context).map((definition) => definition.type);

describe("the article layout", () => {
  it("offers the post's own fields", () => {
    expect(typesFor("blogArticleTemplate")).toContain("dynamicField");
  });

  it("does not offer a post list, because an article is one post", () => {
    expect(typesFor("blogArticleTemplate")).not.toContain("postCollection");
  });

  it("offers a table of contents, which is about this article's headings", () => {
    expect(typesFor("blogArticleTemplate")).toContain("tableOfContents");
  });
});

describe("the index layout", () => {
  it("offers the post list", () => {
    expect(typesFor("blogIndexTemplate")).toContain("postCollection");
  });

  it("does not offer a single post's fields, because there is no single post", () => {
    expect(typesFor("blogIndexTemplate")).not.toContain("dynamicField");
  });
});

describe("what neither layout offers", () => {
  it("leaves out blocks with no relationship to blog content", () => {
    for (const context of ["blogIndexTemplate", "blogArticleTemplate"] as const) {
      const offered = typesFor(context);
      for (const unrelated of ["form", "pricingTable", "countdown", "iconList", "table", "downloadButton", "counter"]) {
        expect(offered, `${unrelated} in ${context}`).not.toContain(unrelated);
      }
    }
  });

  it("still offers the layout and copy a template is built from", () => {
    for (const context of ["blogIndexTemplate", "blogArticleTemplate"] as const) {
      for (const kept of ["container", "text", "richText", "image", "divider", "spacer"]) {
        expect(typesFor(context), `${kept} in ${context}`).toContain(kept);
      }
    }
  });
});

describe("a template that already holds a block nobody may insert today", () => {
  it("keeps validating, so the stored layout still renders and can be edited", () => {
    // The catalog decides what may be *added*. It has never decided what a document may contain, and
    // a narrowed catalog that invalidated stored work would be a far worse trade than a wide one.
    const legacy = legacyProjectDocument({ withLegacyForm: true });
    const stored = legacy.sharedSections[0]!.elements;

    for (const element of stored) {
      const parsed = builderElementSchema.safeParse(element);
      // The version-1 form is refused for being old, not for being unoffered; the text is accepted.
      if (element.type !== "form") expect(parsed.success, element.id).toBe(true);
    }

    expect(typesFor("blogArticleTemplate")).not.toContain("form");
  });
});
