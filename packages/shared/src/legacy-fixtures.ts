import type { BuilderElement } from "./elements";
import { createEmptySection, createPage, createProjectDocument } from "./project";
import type { BuilderDocumentInput, BuilderSection } from "./project";
import { fixtureText } from "./responsive-fixtures";

/**
 * A document shaped like the ones this product wrote before the transforms it now depends on.
 *
 * Built from the failure report rather than from a customer's record: it carries no tenant, no
 * domain, no credential and no private copy, and the affected project itself is never read, moved
 * or rewritten to produce it. What it does preserve is the three placements a page can put text in,
 * because the transforms disagree about which of them they visit:
 *
 *   - top level of a page section, which every transform reaches;
 *   - inside a container, which element migration reaches and responsive migration and the CSS
 *     compiler do not;
 *   - inside a shared section, which neither migration reaches at all.
 *
 * A fixture that only had the first placement would pass every check and prove nothing, which is
 * how these gaps survived a suite that already covered migration and publication in detail.
 */

export const LEGACY_TOP_LEVEL_TEXT = "Top level paragraph";
export const LEGACY_NESTED_TEXT = "Paragraph inside a container";
export const LEGACY_SHARED_TEXT = "Paragraph in a shared section";

export const LEGACY_TOP_LEVEL_ID = "legacy-top-level";
export const LEGACY_CONTAINER_ID = "legacy-container";
export const LEGACY_NESTED_ID = "legacy-nested";
export const LEGACY_SHARED_ID = "legacy-shared-text";
export const LEGACY_SHARED_SECTION_ID = "legacy-shared-section";

/**
 * A container holding one text element.
 *
 * Containers are the ordinary way to group two things that must move together, so a nested text
 * element is not an exotic shape — it is what the second thing a designer draws looks like.
 */
function legacyContainer(child: BuilderElement): BuilderElement {
  return {
    id: LEGACY_CONTAINER_ID,
    name: "",
    type: "container",
    geometry: { x: 40, y: 40, width: 600, height: 300, rotation: 0 },
    responsiveLayout: {
      width: { value: 600, unit: "px" },
      height: { value: 300, unit: "px" },
      horizontalConstraint: "left",
      verticalConstraint: "top",
      visible: true,
    },
    zIndex: 1,
    locked: false,
    hidden: false,
    layout: "free",
    layoutByBreakpoint: {},
    children: [child],
  } as unknown as BuilderElement;
}

export const LEGACY_SHARED_FORM_ID = "legacy-shared-form";

/**
 * A form as version 1 stored one.
 *
 * Text has never changed shape, so it proves nothing about whether a transform reached it: an
 * already-current element comes back identical either way. The form did change — it carried its own
 * copy of the questions before placement and definition were separated — so it is the block that
 * shows whether a migration actually visited a shared section.
 */
function legacyFormV1(): BuilderElement {
  return {
    id: LEGACY_SHARED_FORM_ID,
    name: "",
    type: "form",
    version: 1,
    formId: "contact",
    submitLabel: "Send",
    successMessage: "Thank you.",
    errorMessage: "That did not send.",
    consentText: "",
    consentRequired: false,
    geometry: { x: 60, y: 200, width: 480, height: 360, rotation: 0 },
    responsiveLayout: {
      width: { value: 480, unit: "px" },
      height: { value: 360, unit: "px" },
      horizontalConstraint: "left",
      verticalConstraint: "top",
      visible: true,
    },
    zIndex: 2,
    locked: false,
    hidden: false,
  } as unknown as BuilderElement;
}

/**
 * The shared section a header or a footer lives in, carrying content of its own.
 *
 * The version-1 form is opt-in. It is the block that proves a migration reached this section, and it
 * references a form id that exists in no workspace — which blocks publication for a reason that has
 * nothing to do with the failure being reproduced. A test proves one thing at a time.
 */
export function legacySharedSection(options: { withLegacyForm?: boolean } = {}): BuilderSection {
  return {
    ...createEmptySection(),
    id: LEGACY_SHARED_SECTION_ID,
    name: "Shared band",
    layoutMode: "free",
    elements: [
      fixtureText({ id: LEGACY_SHARED_ID, x: 60, y: 60, width: 480, content: LEGACY_SHARED_TEXT }),
      ...(options.withLegacyForm === true ? [legacyFormV1()] : []),
    ],
  };
}

/**
 * The document as it is stored, with no element carrying a payload version.
 *
 * Absent means version 1, which is what everything written before element versioning existed means.
 * Nothing here is invalid; it is simply old, and old is the state the transforms have to survive.
 */
export function legacyProjectDocument(options: { withLegacyForm?: boolean } = {}): BuilderDocumentInput {
  const base = createProjectDocument({ name: "Legacy fixture", slug: "legacy-fixture" });
  const page = createPage({ name: "Home", slug: "", isHome: true });

  const topLevel = fixtureText({
    id: LEGACY_TOP_LEVEL_ID,
    x: 40,
    y: 400,
    width: 520,
    content: LEGACY_TOP_LEVEL_TEXT,
  });
  const nested = fixtureText({ id: LEGACY_NESTED_ID, x: 20, y: 20, width: 400, content: LEGACY_NESTED_TEXT });

  const shared = legacySharedSection(options);

  return {
    ...base,
    pages: [
      {
        ...page,
        sections: [
          { ...createEmptySection(), id: "legacy-section", layoutMode: "free", elements: [topLevel, legacyContainer(nested)] },
          // A reference to the shared section, which is how a page carries a header it does not own.
          { ...createEmptySection(), id: "legacy-shared-ref", layoutMode: "free", elements: [], sharedSectionId: shared.id },
        ],
      },
    ],
    sharedSections: [shared],
  };
}

/** Every text this fixture puts on the page, in the order a reader meets them. */
export const LEGACY_TEXTS = [LEGACY_TOP_LEVEL_TEXT, LEGACY_NESTED_TEXT, LEGACY_SHARED_TEXT] as const;
