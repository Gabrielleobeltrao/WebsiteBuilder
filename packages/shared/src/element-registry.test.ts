import { describe, expect, it } from "vitest";

import {
  ELEMENT_CATEGORIES,
  ELEMENT_DEFINITIONS,
  ELEMENT_REGISTRY,
  elementDefinition,
  elementsForContext,
  featureElementTypes,
  runtimeCapabilitiesFor,
  RUNTIME_CAPABILITIES,
} from "./element-registry";
import { builderElementSchema, ELEMENT_TYPES, type BuilderElement } from "./elements";
import { SITE_FEATURE_KEYS } from "./project";

/**
 * The registry's contract.
 *
 * TypeScript already refuses a block that has no definition — the registry is a total record over
 * the union. What it cannot check is whether the *values* in a definition describe something the
 * document would actually accept, which is what this file is for: every default is parsed by the
 * real schema, so a block whose defaults drifted from its schema fails here rather than the first
 * time somebody inserts it.
 */

/** The base half an editor supplies. Only the type-specific half comes from the registry. */
const base = {
  id: "00000000-0000-4000-8000-000000000000",
  name: "",
  geometry: { x: 0, y: 0, width: 100, height: 40, rotation: 0 },
  responsiveLayout: {
    width: { value: 100, unit: "px" },
    height: { value: 40, unit: "px" },
    horizontalConstraint: "left",
    verticalConstraint: "top",
    visible: true,
  },
  zIndex: 1,
  locked: false,
  hidden: false,
};

describe("every block is fully described", () => {
  it("has a definition for every type in the union", () => {
    expect(Object.keys(ELEMENT_REGISTRY).sort()).toEqual([...ELEMENT_TYPES].sort());
  });

  it("produces defaults the document schema accepts", () => {
    for (const type of ELEMENT_TYPES) {
      const candidate = { ...base, type, ...elementDefinition(type).defaults() };
      const parsed = builderElementSchema.safeParse(candidate);

      expect(parsed.success, `${type}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`).toBe(true);
    }
  });

  it("names its label after its own type, so a catalog entry cannot point at another block's copy", () => {
    for (const type of ELEMENT_TYPES) {
      expect(elementDefinition(type).labelKey).toBe(type);
    }
  });

  it("declares a category the catalog knows about, and an icon", () => {
    for (const definition of ELEMENT_DEFINITIONS) {
      expect(ELEMENT_CATEGORIES).toContain(definition.category);
      expect(definition.icon.length).toBeGreaterThan(0);
      expect(definition.defaultSize.width).toBeGreaterThan(0);
      expect(definition.defaultSize.height).toBeGreaterThan(0);
    }
  });

  it("lists every block exactly once, grouped by category", () => {
    expect(ELEMENT_DEFINITIONS).toHaveLength(ELEMENT_TYPES.length);
    expect(new Set(ELEMENT_DEFINITIONS.map((definition) => definition.type)).size).toBe(ELEMENT_TYPES.length);

    const categories = ELEMENT_DEFINITIONS.map((definition) => definition.category);
    expect([...categories].sort((a, b) => ELEMENT_CATEGORIES.indexOf(a) - ELEMENT_CATEGORIES.indexOf(b))).toEqual(
      categories,
    );
  });

  it("declares only runtime capabilities the runtime knows", () => {
    for (const definition of ELEMENT_DEFINITIONS) {
      if (definition.runtime !== undefined) expect(RUNTIME_CAPABILITIES).toContain(definition.runtime);
    }
  });

  it("allows every block somewhere", () => {
    for (const definition of ELEMENT_DEFINITIONS) {
      expect(definition.contexts.length, definition.type).toBeGreaterThan(0);
    }
  });
});

describe("context restrictions", () => {
  it("offers the ordinary page every block that is not template-only", () => {
    const page = elementsForContext("page").map((definition) => definition.type);
    expect(page).toContain("text");
    expect(page).toContain("gallery");
  });

  it("keeps a page-wide bar out of contexts that render inside a record", () => {
    expect(elementsForContext("blogTemplate").map((definition) => definition.type)).not.toContain("announcementBar");
  });
});

describe("feature references", () => {
  it("derives its element types from the registry rather than from a separate list", () => {
    // The list this replaced named types no element could have, so every optional feature stayed
    // "unused" no matter what a site contained.
    for (const feature of SITE_FEATURE_KEYS) {
      for (const type of featureElementTypes(feature)) {
        expect(ELEMENT_TYPES).toContain(type);
        expect(elementDefinition(type).feature).toBe(feature);
      }
    }
  });
});

describe("runtime capabilities of a page", () => {
  const element = (type: (typeof ELEMENT_TYPES)[number]): BuilderElement =>
    ({ ...base, type, ...elementDefinition(type).defaults() }) as BuilderElement;

  it("asks for nothing when nothing on the page is interactive", () => {
    expect(runtimeCapabilitiesFor([element("text"), element("image"), element("divider")])).toEqual([]);
  });

  it("asks only for what the page actually contains", () => {
    expect(runtimeCapabilitiesFor([element("tabs"), element("text")])).toEqual(["tabs"]);
  });

  it("deduplicates and keeps a stable order", () => {
    const capabilities = runtimeCapabilitiesFor([
      element("gallery"),
      element("tabs"),
      element("gallery"),
      element("accordion"),
    ]);

    expect(capabilities).toEqual(["tabs", "accordion", "lightbox"]);
  });
});
