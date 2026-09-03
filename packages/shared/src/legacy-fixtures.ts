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

/** The shared section a header or a footer lives in, carrying text of its own. */
export function legacySharedSection(): BuilderSection {
  return {
    ...createEmptySection(),
    id: LEGACY_SHARED_SECTION_ID,
    name: "Shared band",
    layoutMode: "free",
    elements: [fixtureText({ id: LEGACY_SHARED_ID, x: 60, y: 60, width: 480, content: LEGACY_SHARED_TEXT })],
  };
}

/**
 * The document as it is stored, with no element carrying a payload version.
 *
 * Absent means version 1, which is what everything written before element versioning existed means.
 * Nothing here is invalid; it is simply old, and old is the state the transforms have to survive.
 */
export function legacyProjectDocument(): BuilderDocumentInput {
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

  const shared = legacySharedSection();

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
