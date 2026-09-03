import { mapDocumentElements, type DocumentLike } from "./document-traversal";
import { elementDefinition, ELEMENT_REGISTRY } from "./element-registry";
import { type BuilderElement, type ElementType } from "./elements";
import { DEFAULT_FORM_PRESENTATION } from "./forms";

/**
 * Element payloads carry a version, and moving between versions is a pure function.
 *
 * The rule that makes this safe for other people's saved work: **migration happens on read, in
 * memory, and is written only when the person saves something.** Opening a page does not rewrite
 * it, and a published snapshot is never touched at all — it is immutable by contract, so a document
 * that is live stays exactly as it was published even after the code that renders it moves on.
 *
 * A stored element with no version is version 1, which is what every document written before this
 * existed means. A stored element from a *newer* deployment is refused rather than guessed at: half
 * of a payload nobody in this build understands is worse than an element that visibly did not load.
 */

/** One step: the payload as the previous version stored it, returned as the next version stores it. */
export type ElementMigration = (payload: Record<string, unknown>) => Record<string, unknown>;

/**
 * Steps per type, keyed by the version they upgrade *from*.
 *
 * A step runs on read and returns the payload as the next version stores it. Adding one after the
 * fact cannot repair the documents it needed to fix, which is why the mechanism exists before the
 * first change rather than after it.
 */
/** What a version-1 form block held before the definition owned what a form says. */
const LEGACY_FORM_DEFAULTS = {
  submitLabel: "Send",
  successMessage: "Thank you. Your message has been sent.",
  errorMessage: "Your message could not be sent. Please try again.",
  consentText: "",
  consentRequired: false,
} as const;

const text = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);

export const ELEMENT_MIGRATIONS: Partial<Record<ElementType, Record<number, ElementMigration>>> = {
  form: {
    /**
     * 1 → 2: what the form says moves to the definition; the block keeps presentation.
     *
     * The old values are not thrown away. A migration is a pure function over one element payload —
     * it cannot reach the collection holding the definition, and a block whose `formId` is empty has
     * no definition to write into — so they are parked on the element as `legacyCopy`, which nothing
     * renders. The builder offers them as the starting point when a form is created from this block
     * and clears them on binding.
     *
     * A block still carrying the untouched defaults has nothing worth preserving, so it migrates to
     * a clean element rather than one carrying a copy of the constants above.
     */
    1: (payload) => {
      const { submitLabel, successMessage, errorMessage, consentText, consentRequired, ...rest } = payload;

      const legacy = {
        submitLabel: text(submitLabel, LEGACY_FORM_DEFAULTS.submitLabel),
        successMessage: text(successMessage, LEGACY_FORM_DEFAULTS.successMessage),
        errorMessage: text(errorMessage, LEGACY_FORM_DEFAULTS.errorMessage),
        consentText: text(consentText, LEGACY_FORM_DEFAULTS.consentText),
        consentRequired: consentRequired === true,
      };

      const authored = (Object.keys(legacy) as Array<keyof typeof legacy>).some(
        (key) => legacy[key] !== LEGACY_FORM_DEFAULTS[key],
      );

      return {
        ...rest,
        presentation: { ...DEFAULT_FORM_PRESENTATION },
        ...(authored ? { legacyCopy: legacy } : {}),
      };
    },
  },
  gallery: {
    /**
     * 1 → 2: bare media ids become items that can carry their own alternative text.
     *
     * Every image in a version-1 gallery rendered with an empty alt, because there was nowhere to
     * put one. The text starts empty and readiness asks for it: inventing a description of a
     * picture nobody has seen would be worse than saying nothing.
     */
    1: (payload) => {
      const ids = Array.isArray(payload.mediaIds) ? payload.mediaIds : [];
      const { mediaIds: _dropped, ...rest } = payload;

      return {
        ...rest,
        items: ids
          .filter((id): id is string => typeof id === "string")
          .map((mediaId) => ({ mediaId, alt: "", decorative: false, caption: "" })),
      };
    },
  },
};

export function currentElementVersion(type: ElementType): number {
  return ELEMENT_REGISTRY[type]?.schemaVersion ?? 1;
}

/** The version a stored element declares. Absent means 1. */
export function storedElementVersion(element: { version?: unknown }): number {
  const declared = element.version;
  return typeof declared === "number" && Number.isInteger(declared) && declared >= 1 ? declared : 1;
}

/** True when an element was written by a deployment newer than this one. */
export function isFutureElement(element: BuilderElement): boolean {
  const type = element.type as ElementType;
  if (ELEMENT_REGISTRY[type] === undefined) return true;
  return storedElementVersion(element) > currentElementVersion(type);
}

/**
 * Brings one element to the current version.
 *
 * Returns the same object when there is nothing to do, so a caller can tell whether a document
 * actually changed without comparing it field by field.
 */
export function migrateElement(element: BuilderElement): BuilderElement {
  const type = element.type as ElementType;
  if (ELEMENT_REGISTRY[type] === undefined) return element;

  const target = currentElementVersion(type);
  let version = storedElementVersion(element);
  if (version >= target) {
    // Already current, or from the future. Neither is ours to rewrite.
    const migratedChildren = migrateChildren(element);
    return migratedChildren ?? element;
  }

  const steps = ELEMENT_MIGRATIONS[type] ?? {};
  let payload = { ...element } as Record<string, unknown>;

  while (version < target) {
    const step = steps[version];
    payload = step === undefined ? payload : step(payload);
    version += 1;
  }

  const migrated = { ...payload, version: target } as BuilderElement;
  return migrateChildren(migrated) ?? migrated;
}

/** Migrates a container's children, returning null when none of them changed. */
function migrateChildren(element: BuilderElement): BuilderElement | null {
  if (element.type !== "container") return null;

  const children = element.children.map(migrateElement);
  if (children.every((child, index) => child === element.children[index])) return null;
  return { ...element, children };
}

export type ElementMigrationReport = {
  /** Elements that moved version, and the version they moved from. */
  migrated: Array<{ elementId: string; type: string; from: number; to: number }>;
  /** Elements written by a newer deployment, which this build refuses to interpret. */
  future: Array<{ elementId: string; type: string; version: number }>;
};

/**
 * Migrates every element of a document.
 *
 * Same-object-when-unchanged, so the editor can load a document without marking it dirty and
 * without prompting somebody to save a change they did not make.
 */
export function migrateDocumentElements<T extends DocumentLike>(
  document: T,
): { document: T; report: ElementMigrationReport } {
  const report: ElementMigrationReport = { migrated: [], future: [] };

  const visit = (element: BuilderElement): BuilderElement => {
    if (isFutureElement(element)) {
      report.future.push({
        elementId: element.id,
        type: String(element.type),
        version: storedElementVersion(element),
      });
      return element;
    }

    const from = storedElementVersion(element);
    const migrated = migrateElement(element);
    if (migrated !== element && from !== currentElementVersion(element.type as ElementType)) {
      report.migrated.push({
        elementId: element.id,
        type: String(element.type),
        from,
        to: currentElementVersion(element.type as ElementType),
      });
    }
    return migrated;
  };

  /*
   * Shared sections are part of the document.
   *
   * This walked `pages` alone, so a header or a footer — the blocks a visitor sees on every page of
   * a site — stayed on whatever payload version they were written at, and the document that came
   * back claimed to be migrated.
   */
  const next = mapDocumentElements(document as unknown as DocumentLike, visit) as unknown as T;
  return next === (document as unknown as T) ? { document, report } : { document: next, report };
}

/** The version a newly created element of this type is stamped with. */
export function stampVersion(type: ElementType): { version: number } {
  return { version: elementDefinition(type).schemaVersion };
}
