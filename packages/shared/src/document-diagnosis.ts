import { migrateDocumentElements, type ElementMigrationReport } from "./element-migrations";
import { builderProjectSchema, type BuilderProject } from "./project";
import { migrateDocumentResponsive, type MigrationReport } from "./responsive-migration";
import { SCHEMA_VERSION } from "./schema-version";

/**
 * The one place a stored project document is turned into a document this build may act on.
 *
 * Writes have always been validated; reads were not. A record came back from Mongo, was spread into
 * the project shape and trusted — so a document written by an older build, or by a newer one, or one
 * that had drifted, reached the editor, the compiler and the renderer as though it were current.
 * What that produces is not a clean failure: it is a page that renders with a piece missing, or a
 * publication refused for a reason that names an element nobody can find.
 *
 * So every read passes through here and comes out as one of four answers, and the caller decides
 * what each one means:
 *
 *   current  — parses as written, nothing to do.
 *   migrated — parses after pure in-memory migrations. The stored record is not touched; only a save
 *              the person makes themselves persists the newer shape.
 *   future   — carries a schema or element version this build does not know. Readable enough to show,
 *              never safe to overwrite: a deployment that rewrote it would delete work done by a
 *              newer one.
 *   invalid  — does not parse, and the paths say where.
 */

export type DocumentPath = {
  pageId?: string;
  sectionId?: string;
  elementId?: string;
  /** The schema path, for the parts of a document that are not an element — seo, breakpoints, slug. */
  field?: string;
};

export type DocumentIssue = {
  path: DocumentPath;
  message: string;
};

export type DocumentDiagnosis =
  | {
      status: "current" | "migrated";
      /** The document as this build understands it, migrated in memory and never written back. */
      document: BuilderProject;
      elements: ElementMigrationReport;
      responsive: MigrationReport;
      issues: [];
    }
  | {
      status: "future";
      /** Present when the record still parses; absent when the newer shape is unreadable here. */
      document: BuilderProject | null;
      elements: ElementMigrationReport;
      responsive: MigrationReport;
      issues: DocumentIssue[];
    }
  | {
      status: "invalid";
      document: null;
      elements: ElementMigrationReport;
      responsive: MigrationReport;
      issues: DocumentIssue[];
    };

const EMPTY_ELEMENTS: ElementMigrationReport = { migrated: [], future: [] };
const EMPTY_RESPONSIVE: MigrationReport = { changed: [] };

/**
 * Turns a Zod path into the identity a person can act on.
 *
 * `pages.0.sections.2.elements.1.content` names a position in an array, which tells whoever reads
 * the error nothing: array indices move. The ids do not, and they are what the editor addresses.
 */
type StoredSection = { id?: string; elements?: Array<{ id?: string }> };
type StoredRecord = {
  pages?: Array<{ id?: string; sections?: StoredSection[] }>;
  sharedSections?: StoredSection[];
};

function locate(raw: unknown, path: ReadonlyArray<string | number>): DocumentPath {
  const record = raw as StoredRecord;
  const located: DocumentPath = { field: path.join(".") };

  /*
   * A shared section is addressed directly, not through a page.
   *
   * It is where a site's header and footer live — most of what a visitor sees on most pages — so an
   * issue there that reported only an array index would name the least findable half of the site.
   */
  if (path[0] === "sharedSections" && typeof path[1] === "number") {
    const section = record.sharedSections?.[path[1]];
    if (section?.id !== undefined) located.sectionId = section.id;
    if (path[2] === "elements" && typeof path[3] === "number") {
      const element = section?.elements?.[path[3]];
      if (element?.id !== undefined) located.elementId = element.id;
    }
    return located;
  }

  if (path[0] !== "pages" || typeof path[1] !== "number") return located;
  const page = record.pages?.[path[1]];
  if (page?.id !== undefined) located.pageId = page.id;

  if (path[2] !== "sections" || typeof path[3] !== "number") return located;
  const section = page?.sections?.[path[3]];
  if (section?.id !== undefined) located.sectionId = section.id;

  if (path[4] !== "elements" || typeof path[5] !== "number") return located;
  const element = section?.elements?.[path[5]];
  if (element?.id !== undefined) located.elementId = element.id;

  return located;
}

/**
 * The document, without the bookkeeping stored beside it.
 *
 * `builderProjectSchema` is strict and describes a *document*: what a person authored. The stored
 * record is that plus what storage keeps — the pointer to the active published version, and whatever
 * a later feature adds next to it. Validating the whole record against the document's schema called
 * every published site invalid, which is a boundary that rejects the very thing it exists to admit.
 */
function documentPartOf(raw: unknown): Record<string, unknown> {
  const record = raw as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(builderProjectSchema.shape)) {
    if (key in record) picked[key] = record[key];
  }
  return picked;
}

/** The schema version a record claims, when it claims one at all. */
function storedSchemaVersion(raw: unknown): number | null {
  const value = (raw as { schemaVersion?: unknown }).schemaVersion;
  return typeof value === "number" ? value : null;
}

export function diagnoseStoredProject(raw: unknown): DocumentDiagnosis {
  // An array is an object, and a document is not an array. Nor is one without pages a document this
  // build can migrate: every transform below indexes `pages`, and would throw rather than report.
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray((raw as StoredRecord).pages)) {
    return {
      status: "invalid",
      document: null,
      elements: EMPTY_ELEMENTS,
      responsive: EMPTY_RESPONSIVE,
      issues: [{ path: {}, message: "The stored record is not a document." }],
    };
  }

  const claimed = storedSchemaVersion(raw);
  if (claimed !== null && claimed > SCHEMA_VERSION) {
    // Readable or not, this build must not write it back. Saying so is the whole point: the
    // alternative is a deployment silently overwriting a document a newer one produced.
    const parsed = builderProjectSchema.safeParse(documentPartOf(raw));
    return {
      status: "future",
      document: parsed.success ? ({ ...(raw as BuilderProject) }) : null,
      elements: EMPTY_ELEMENTS,
      responsive: EMPTY_RESPONSIVE,
      issues: [
        {
          path: { field: "schemaVersion" },
          message: `This document was written as schema version ${claimed}; this build understands ${SCHEMA_VERSION}.`,
        },
      ],
    };
  }

  /*
   * Migrations run before validation, not after.
   *
   * An old element is not invalid — it is a shape a pure function turns into the current one, and
   * validating first would reject exactly the documents these migrations exist to rescue.
   */
  const { document: versioned, report: elements } = migrateDocumentElements(raw as never);
  const { document: normalized, report: responsive } = migrateDocumentResponsive(versioned as never);

  if (elements.future.length > 0) {
    return {
      status: "future",
      document: null,
      elements,
      responsive,
      issues: elements.future.map((entry) => ({
        path: { elementId: entry.elementId },
        message: `The block "${entry.type}" is stored at version ${entry.version}, which this build does not know.`,
      })),
    };
  }

  const parsed = builderProjectSchema.safeParse(documentPartOf(normalized));
  if (!parsed.success) {
    return {
      status: "invalid",
      document: null,
      elements,
      responsive,
      issues: parsed.error.issues.map((issue) => ({
        path: locate(normalized, issue.path as ReadonlyArray<string | number>),
        message: issue.message,
      })),
    };
  }

  const untouched = elements.migrated.length === 0 && responsive.changed.length === 0;
  return {
    status: untouched ? "current" : "migrated",
    // The migrated document, with the storage bookkeeping it arrived with left in place: callers
    // read `activePublishedVersionId` and the timestamps from the same object they always did.
    document: { ...(normalized as BuilderProject) },
    elements,
    responsive,
    issues: [],
  };
}

/** Whether this build may write over the stored record without destroying somebody else's work. */
export function isSafeToOverwrite(diagnosis: DocumentDiagnosis): boolean {
  return diagnosis.status === "current" || diagnosis.status === "migrated";
}
