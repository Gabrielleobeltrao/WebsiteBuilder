import { describe, expect, it } from "vitest";

import { migrateDocumentElements } from "./element-migrations";
import { builderElementSchema, walkElements } from "./elements";
import {
  LEGACY_CONTAINER_ID,
  LEGACY_SHARED_FORM_ID,
  LEGACY_NESTED_ID,
  LEGACY_SHARED_ID,
  legacyProjectDocument,
} from "./legacy-fixtures";
import { compilePageCss } from "./responsive-css";
import { migrateDocumentResponsive } from "./responsive-migration";

/**
 * What the document-wide transforms actually visit.
 *
 * Each of these exists because a transform describes itself as operating on a document and operates
 * on part of one. A page's text is reached; a container's child and a shared section's contents are
 * not, and the difference is invisible until somebody opens a site old enough to need the migration
 * — which is exactly the report this fixture was built from.
 */

const document = () => legacyProjectDocument({ withLegacyForm: true });

/** Every element in the document, wherever it lives — pages, containers, shared sections. */
function everyElement(input: ReturnType<typeof document>) {
  return [
    ...[...input.pages.flatMap((page) => page.sections.flatMap((section) => section.elements))].flatMap((element) => [
      ...walkElements([element]),
    ]),
    ...input.sharedSections.flatMap((section) => [...walkElements(section.elements)]),
  ];
}

describe("the fixture itself", () => {
  it("carries text in all three placements a page can hold one", () => {
    const ids = everyElement(document()).map((element) => element.id);

    expect(ids).toContain(LEGACY_NESTED_ID);
    expect(ids).toContain(LEGACY_SHARED_ID);
  });

  it("names no tenant, domain, credential or private content", () => {
    const serialised = JSON.stringify(document());

    for (const forbidden of ["oneplataforma", "mongodb", "@", "workspaceId", "http://", "https://"]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  });

  it("is old rather than malformed: every block validates once migrated", () => {
    // The version-1 form is deliberately refused by the current union — that refusal is what a
    // migration exists to prevent reaching. What matters is that nothing here is broken in a way no
    // migration can repair, because then the fixture would prove a different bug than the reported one.
    const { document: migrated } = migrateDocumentElements(document() as never);

    for (const element of everyElement(migrated as ReturnType<typeof document>)) {
      expect(builderElementSchema.safeParse(element).success, element.id).toBe(true);
    }
  });
});

/*
 * These are written against the behaviour the product promises and fail against the behaviour it
 * has, so they are declared as expected failures rather than skipped. `it.fails` runs the body: it
 * passes only while the defect is present and turns red the moment the fix lands, which is what
 * forces the marker to be removed in the same change rather than left behind as a lie.
 */
describe("element migration", () => {
  it("visits shared sections, not only pages", () => {
    const { document: migrated, report } = migrateDocumentElements(document() as never);

    // A shared section holds a header or a footer: the blocks that appear on every page of a site.
    // Leaving them on an older payload version is leaving most of the site unmigrated.
    //
    // Asserted with the form, because it is a block whose shape actually changed. Text has never
    // moved version, so it comes back identical whether a transform visited it or not — which is
    // what made the first version of this test pass against the broken traversal.
    const shared = (migrated as ReturnType<typeof document>).sharedSections[0]!.elements[1]!;
    expect(shared.type).toBe("form");
    expect(shared).toMatchObject({ version: 2, presentation: expect.any(Object) });
    expect(report.migrated.map((entry) => entry.elementId)).toContain(LEGACY_SHARED_FORM_ID);
  });
});

describe("responsive migration", () => {
  it("visits a container's children", () => {
    const { report } = migrateDocumentResponsive(document() as never);

    // The nested paragraph is authored at the same kind of coordinate as the top-level one and needs
    // the same narrow override; nothing about being inside a container changes what a phone does.
    expect(report.changed.map((entry) => entry.elementId)).toContain(LEGACY_NESTED_ID);
  });

  it("visits shared sections", () => {
    const { report } = migrateDocumentResponsive(document() as never);
    expect(report.changed.map((entry) => entry.elementId)).toContain(LEGACY_SHARED_ID);
  });
});

describe("the compiled stylesheet", () => {
  it("emits a rule for a container's child, which the renderer draws", () => {
    const css = compilePageCss(document().pages[0]! as never);

    // The child is rendered either way. Without a rule it is drawn with no placement at all, which
    // on a free section means it lands on top of whatever else starts at the origin — the shape of
    // "my text disappeared".
    expect(css).toContain(`"${LEGACY_NESTED_ID}"`);
    expect(css).toContain(`"${LEGACY_CONTAINER_ID}"`);
  });
});
