import { describe, expect, it } from "vitest";

import {
  currentElementVersion,
  isFutureElement,
  migrateDocumentElements,
  migrateElement,
  storedElementVersion,
} from "./element-migrations";
import { elementDefinition } from "./element-registry";
import { builderElementSchema, type BuilderElement } from "./elements";
import { createPage, createProjectDocument } from "./project";

/**
 * Opening somebody's saved page must not change it.
 *
 * That is the property these defend: a legacy document — one written before element versions
 * existed — parses, renders and comes back byte-identical unless a migration genuinely had
 * something to do. A document from a newer deployment is left alone entirely rather than
 * half-interpreted by a build that does not know what its fields mean.
 */

const base = {
  id: "11111111-1111-4111-8111-111111111111",
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

/** A real element of one type: base fields plus exactly that type's defaults. */
const of = (type: Parameters<typeof elementDefinition>[0], overrides: Record<string, unknown> = {}): BuilderElement =>
  ({ ...base, type, version: elementDefinition(type).schemaVersion, ...elementDefinition(type).defaults(), ...overrides }) as BuilderElement;

const element = (overrides: Record<string, unknown> = {}): BuilderElement => of("text", overrides);

function documentWith(elements: BuilderElement[]) {
  const document = createProjectDocument({ name: "Acme", slug: "acme" });
  const page = createPage({ name: "Home", slug: "home", order: 0 });
  page.isHome = true;
  page.sections[0]!.elements = elements;
  return { ...document, pages: [page] };
}

describe("a legacy element", () => {
  it("has no version and is read as version 1", () => {
    const legacy = element();
    delete (legacy as { version?: number }).version;

    expect(storedElementVersion(legacy)).toBe(1);
    expect(builderElementSchema.safeParse(legacy).success).toBe(true);
  });

  it("is returned unchanged when its version is already current", () => {
    const current = element({ version: currentElementVersion("text") });
    expect(migrateElement(current)).toBe(current);
  });

  it("leaves a whole document untouched when nothing needs migrating", () => {
    const document = documentWith([element()]);
    const { document: result, report } = migrateDocumentElements(document);

    // Identity, not equality: the editor decides whether a document is dirty by comparing objects,
    // and a fresh object would ask somebody to save a change they did not make.
    expect(result).toBe(document);
    expect(report.migrated).toEqual([]);
  });
});

describe("an element from a newer deployment", () => {
  const future = () => element({ version: currentElementVersion("text") + 5 });

  it("is recognised rather than guessed at", () => {
    expect(isFutureElement(future())).toBe(true);
  });

  it("is left exactly as stored", () => {
    const stored = future();
    expect(migrateElement(stored)).toBe(stored);
  });

  it("is reported, so a page can say what it could not read", () => {
    const { report } = migrateDocumentElements(documentWith([future()]));

    expect(report.future).toEqual([
      { elementId: "11111111-1111-4111-8111-111111111111", type: "text", version: currentElementVersion("text") + 5 },
    ]);
    expect(report.migrated).toEqual([]);
  });
});

describe("nested elements", () => {
  it("migrates a container's children, not only its top level", () => {
    const child = element({ id: "22222222-2222-4222-8222-222222222222" });
    delete (child as { version?: number }).version;

    const container = of("container", { id: "33333333-3333-4333-8333-333333333333", children: [child] });

    const migrated = migrateElement(container);
    expect(builderElementSchema.safeParse(migrated).success).toBe(true);
  });
});

describe("every block declares a version its defaults were written for", () => {
  it("stamps a created element with the registry's version", () => {
    for (const type of ["text", "gallery", "tabs"] as const) {
      expect(currentElementVersion(type)).toBe(elementDefinition(type).schemaVersion);
    }
  });
});
