import { describe, expect, it } from "vitest";

import { diagnoseStoredProject, isSafeToOverwrite } from "./document-diagnosis";
import { legacyProjectDocument, LEGACY_SHARED_ID } from "./legacy-fixtures";
import { createProjectDocument } from "./project";
import { SCHEMA_VERSION } from "./schema-version";

/**
 * The four answers a stored record can get, and what each one licenses.
 *
 * Writes were validated from the start and reads were not: a record came back from Mongo, was spread
 * into the project shape and trusted. What that produces is not a clean failure but a page rendered
 * with a piece missing, or a publication refused naming an element nobody can find.
 */

/** A stored record: the document plus the bookkeeping Mongo keeps beside it. */
const stored = (document: unknown, overrides: Record<string, unknown> = {}) => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceId: "w1",
  createdByUserId: "u1",
  revision: 3,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  ...(document as Record<string, unknown>),
  ...overrides,
});

describe("a document this build wrote", () => {
  it("comes back current, with nothing to migrate", () => {
    const diagnosis = diagnoseStoredProject(stored(createProjectDocument({ name: "Acme", slug: "acme" })));

    expect(diagnosis.status).toBe("current");
    expect(diagnosis.document?.name).toBe("Acme");
    expect(isSafeToOverwrite(diagnosis)).toBe(true);
  });
});

describe("a document from an older build", () => {
  it("opens, rather than needing to be recreated", () => {
    const diagnosis = diagnoseStoredProject(stored(legacyProjectDocument()));

    expect(diagnosis.status).toBe("migrated");
    expect(diagnosis.document).not.toBeNull();
    expect(isSafeToOverwrite(diagnosis)).toBe(true);
  });

  it("is migrated in memory and never rewritten by the read", () => {
    const record = stored(legacyProjectDocument());
    const before = JSON.stringify(record);

    diagnoseStoredProject(record);

    expect(JSON.stringify(record)).toBe(before);
  });

  it("is idempotent: diagnosing the result again changes nothing further", () => {
    const first = diagnoseStoredProject(stored(legacyProjectDocument()));
    const second = diagnoseStoredProject(first.document!);

    expect(second.status).toBe("current");
    expect(JSON.stringify(second.document)).toBe(JSON.stringify(first.document));
  });

  it("keeps the desktop the author wrote", () => {
    const source = legacyProjectDocument();
    const authored = source.pages[0]!.sections[0]!.elements[0]!;
    const diagnosis = diagnoseStoredProject(stored(source));

    const after = diagnosis.document!.pages[0]!.sections[0]!.elements[0]!;
    expect(after.geometry).toEqual(authored.geometry);
    expect(after.responsiveLayout).toEqual(authored.responsiveLayout);
  });
});

describe("a document from a newer build", () => {
  it("is reported as future rather than parsed as current", () => {
    const diagnosis = diagnoseStoredProject(
      stored(createProjectDocument({ name: "Acme", slug: "acme" }), { schemaVersion: SCHEMA_VERSION + 1 }),
    );

    expect(diagnosis.status).toBe("future");
    expect(diagnosis.issues[0]?.message).toContain(String(SCHEMA_VERSION + 1));
  });

  it("is never safe to overwrite, because a newer build made it", () => {
    const diagnosis = diagnoseStoredProject(
      stored(createProjectDocument({ name: "Acme", slug: "acme" }), { schemaVersion: SCHEMA_VERSION + 1 }),
    );

    expect(isSafeToOverwrite(diagnosis)).toBe(false);
  });

  it("reports a block written by a newer build, naming it", () => {
    const source = createProjectDocument({ name: "Acme", slug: "acme" });
    const legacy = legacyProjectDocument();
    source.pages[0]!.sections[0]!.elements = [
      { ...(legacy.pages[0]!.sections[0]!.elements[0]! as object), version: 999 } as never,
    ];

    const diagnosis = diagnoseStoredProject(stored(source));

    expect(diagnosis.status).toBe("future");
    expect(isSafeToOverwrite(diagnosis)).toBe(false);
    expect(diagnosis.issues[0]?.path.elementId).toBe("legacy-top-level");
  });
});

describe("a document that does not parse", () => {
  it("says which page, section and element, not which array index", () => {
    const source = legacyProjectDocument();
    // Array positions move; ids do not, and the ids are what the editor addresses.
    (source.pages[0]!.sections[0]!.elements[0] as { geometry: unknown }).geometry = "not a geometry";

    const diagnosis = diagnoseStoredProject(stored(source));

    expect(diagnosis.status).toBe("invalid");
    expect(diagnosis.document).toBeNull();
    expect(isSafeToOverwrite(diagnosis)).toBe(false);

    const issue = diagnosis.issues[0]!;
    expect(issue.path.pageId).toBe(source.pages[0]!.id);
    expect(issue.path.sectionId).toBe("legacy-section");
    expect(issue.path.elementId).toBe("legacy-top-level");
  });

  it("locates a shared section's element too, which is where half a site lives", () => {
    const source = legacyProjectDocument();
    (source.sharedSections[0]!.elements[0] as { zIndex: unknown }).zIndex = "first";

    const diagnosis = diagnoseStoredProject(stored(source));

    expect(diagnosis.status).toBe("invalid");
    expect(JSON.stringify(diagnosis.issues)).toContain(LEGACY_SHARED_ID.slice(0, 6));
  });

  it("refuses a record that is not a document at all", () => {
    for (const value of [null, 42, "a document", []]) {
      expect(diagnoseStoredProject(value).status).toBe("invalid");
    }
  });
});
