import { DEVICE_SAFE_PADDING, deviceReferenceWidth, type DeviceMode } from "./devices";
import { applyConstraints } from "./resolve";
import type { BuilderElement } from "./elements";
import { mapDocumentElements, type DocumentLike } from "./document-traversal";
import type { BuilderPage } from "./project";

/**
 * Gives an existing document safe narrow layouts without changing what it looks like on desktop.
 *
 * Every site in the database was authored on a 1440 canvas by a product that never wrote a device
 * override, because nothing in it could. Simply starting to honour overrides would change nothing
 * for them: their elements would keep the coordinates they have, which on a phone means most of
 * them are off the screen.
 *
 * So the unsafe ones are given an explicit override, once, deterministically. Three properties make
 * this safe to run on other people's work:
 *
 * - **Desktop is never touched.** Not "usually" — the function has no branch that writes to it.
 * - **Nothing already authored is overwritten.** A device that already has a value keeps it, so
 *   running this over a document somebody has since refined cannot undo their refinement.
 * - **It is idempotent.** Running it twice produces the same document, because the second pass finds
 *   the override the first one wrote and leaves it alone.
 *
 * What it deliberately does not do is move elements that already fit. A migration that "improves"
 * a layout nobody complained about is a migration that changes someone's site without being asked.
 */

/** The devices a migration may write. Desktop is absent on purpose. */
const NARROW_DEVICES: DeviceMode[] = ["tablet", "mobile"];

/**
 * Fits one page's elements to one device, on request.
 *
 * The same rule the migration applies, aimed at a single device because somebody asked for it. It
 * differs from the automatic pass in one way that matters: it replaces an existing override, since
 * a person pressing "fit to this device" is asking for exactly that. Everything else holds —
 * desktop is untouched, other devices are untouched, and it is one undoable step.
 */
export function autoFitPageToDevice(
  page: BuilderPage,
  device: DeviceMode,
): { page: BuilderPage; changed: string[] } {
  if (device === "desktop") return { page, changed: [] };

  const changed: string[] = [];
  const sections = page.sections.map((section) => {
    if (section.layoutMode !== "free") return section;

    const elements = section.elements.map((element) => {
      if (escapesAt(element, device) === null) return element;
      changed.push(element.id);

      return {
        ...element,
        breakpointOverrides: {
          ...element.breakpointOverrides,
          [device]: {
            ...element.breakpointOverrides?.[device],
            geometry: safeGeometryFor(element, device),
            referenceWidth: deviceReferenceWidth(device),
          },
        },
      } as BuilderElement;
    });

    return elements.every((element, index) => element === section.elements[index])
      ? section
      : { ...section, elements };
  });

  return changed.length === 0 ? { page, changed } : { page: { ...page, sections }, changed };
}

export type MigrationReport = {
  /** Elements that received an override, and the device that received it. */
  changed: Array<{ elementId: string; device: DeviceMode; reason: "overflow" | "off-canvas" }>;
};

/** True when this element, as it resolves today, leaves the visible page at that device's width. */
function escapesAt(element: BuilderElement, device: DeviceMode): "overflow" | "off-canvas" | null {
  const width = deviceReferenceWidth(device);
  const resolved = applyConstraints({
    geometry: element.geometry,
    layout: element.responsiveLayout,
    containerWidth: width,
  });

  if (resolved.x >= width || resolved.x + resolved.width <= 0) return "off-canvas";
  if (resolved.x < 0 || resolved.x + resolved.width > width) return "overflow";
  return null;
}

/**
 * The geometry an escaping element gets on a narrow device.
 *
 * Inside the safe padding, as wide as it can be without exceeding what it was authored at — an
 * element does not become bigger because the screen got smaller. Vertical position is untouched:
 * the element's place in the page is the author's decision, and only its horizontal fit was broken.
 */
function safeGeometryFor(element: BuilderElement, device: DeviceMode) {
  const canvas = deviceReferenceWidth(device);
  const padding = DEVICE_SAFE_PADDING[device];
  const available = Math.max(1, canvas - padding * 2);

  return {
    x: padding,
    width: Math.min(element.geometry.width, available),
  };
}

function migrateElement(element: BuilderElement, report: MigrationReport): BuilderElement {
  let overrides = element.breakpointOverrides;

  for (const device of NARROW_DEVICES) {
    // Somebody has already decided what this element does here. That decision stands.
    if (overrides?.[device]?.geometry !== undefined) continue;

    const reason = escapesAt(element, device);
    if (reason === null) continue;

    overrides = {
      ...overrides,
      [device]: {
        ...overrides?.[device],
        geometry: safeGeometryFor(element, device),
        referenceWidth: deviceReferenceWidth(device),
      },
    };
    report.changed.push({ elementId: element.id, device, reason });
  }

  if (overrides === element.breakpointOverrides) return element;
  return { ...element, breakpointOverrides: overrides } as BuilderElement;
}

export function migratePageResponsive(page: BuilderPage, report: MigrationReport): BuilderPage {
  const migrated = mapDocumentElements({ pages: [page], sharedSections: [] }, (element, location) =>
    // Only free sections can strand an element: grid and flex children are in normal flow and the
    // browser already reflows them.
    location.layoutMode === "free" ? migrateElement(element, report) : element,
  );
  return migrated.pages[0] ?? page;
}

/**
 * Migrates a whole draft document.
 *
 * Returns the same object when nothing needed changing, so a caller can tell whether there is
 * anything to save without comparing documents.
 */
export function migrateDocumentResponsive<T extends DocumentLike>(
  document: T,
): { document: T; report: MigrationReport } {
  const report: MigrationReport = { changed: [] };

  /*
   * Every element, wherever it is.
   *
   * This walked `pages` and, inside a section, only its direct children — so a paragraph inside a
   * container and everything in a shared header kept the desktop coordinate they were authored at.
   * Readiness, which does walk both, then blocked publication on exactly those elements: an old site
   * could be edited and saved and never published, and the reason named a block the author could not
   * tell apart from the one beside it that worked.
   */
  const next = mapDocumentElements(document, (element, location) =>
    location.layoutMode === "free" ? migrateElement(element, report) : element,
  );

  return next === document ? { document, report } : { document: next, report };
}
