import { walkElements } from "./elements";
import { type Finding } from "./audit";
import type { BuilderPage } from "./project";

/**
 * Performance budgets.
 *
 * Every number here is checked against something the build or the document actually produces. There
 * is deliberately no estimate of a score, a load time or a Core Web Vital: those depend on a device
 * and a network this code cannot see, and a made-up number that looks precise is worse than no
 * number, because someone will act on it.
 *
 * What is measurable from here: how many bytes a document is, how much JavaScript the bundle ships,
 * how many image bytes a page can request, how many font files a page needs, and whether the markup
 * lets the browser reserve space before things arrive.
 */
export const PERFORMANCE_BUDGETS = {
  /** One route's builder document. Past this, editing gets slow before visitors ever notice. */
  documentBytes: 500_000,
  /**
   * Compressed JavaScript a *visitor to a published site* downloads. The renderer serves server
   * HTML, so this is currently zero and the budget exists to keep it that way: any script added to
   * public output has to be argued for against this number.
   */
  publishedSiteJavaScriptBytes: 60_000,
  /**
   * Compressed JavaScript for the authenticated application — dashboard and editor. It is allowed
   * to be far heavier: it is loaded by someone who chose to open a design tool, once, behind a
   * login, and it carries the canvas, the rich-text editor and the drag layer. Measured at ~386 KB
   * with the whole application in one chunk; the headroom here is not permission to grow into it,
   * and code-splitting the editor away from the dashboard is the way back down.
   */
  applicationBundleBytes: 450_000,
  /** Total image bytes a single route may request at the largest variant. */
  routeImageBytes: 1_500_000,
  /** A single image. Beyond this, a variant is missing or the source was never resized. */
  singleImageBytes: 400_000,
  /** Distinct font files. Each is a render-blocking request on a cold visit. */
  fontFiles: 4,
  /** Images allowed to load eagerly. Everything above the fold competes for the same bandwidth. */
  eagerImages: 2,
} as const;

export type PerformanceFinding = Finding & {
  /** Measured value and the budget it was compared against, so the report is arguable. */
  measured: number;
  budget: number;
};

export type RouteAssets = {
  path: string;
  documentBytes: number;
  images: ReadonlyArray<{ elementId: string; bytes: number; hasDimensions: boolean; eager: boolean }>;
  fontFiles: readonly string[];
};

/**
 * Audits one route against the budgets.
 *
 * Each finding names the element and says what to do, because "this page is slow" is not something
 * anyone can act on.
 */
export function auditRoutePerformance(route: RouteAssets): PerformanceFinding[] {
  const findings: PerformanceFinding[] = [];

  const push = (
    code: string,
    severity: Finding["severity"],
    detail: string,
    measured: number,
    budget: number,
    elementId?: string,
  ) => {
    findings.push({ code, severity, path: route.path, detail, measured, budget, ...(elementId === undefined ? {} : { elementId }) });
  };

  if (route.documentBytes > PERFORMANCE_BUDGETS.documentBytes) {
    push(
      "document-too-large",
      "warning",
      "This page has grown large enough to slow the editor. Splitting it into sections on separate pages usually helps.",
      route.documentBytes,
      PERFORMANCE_BUDGETS.documentBytes,
    );
  }

  const imageBytes = route.images.reduce((total, image) => total + image.bytes, 0);
  if (imageBytes > PERFORMANCE_BUDGETS.routeImageBytes) {
    push(
      "route-image-weight",
      "warning",
      "The images on this page add up to more than a phone connection handles comfortably. Removing or shrinking the largest ones has the most effect.",
      imageBytes,
      PERFORMANCE_BUDGETS.routeImageBytes,
    );
  }

  for (const image of route.images) {
    if (image.bytes > PERFORMANCE_BUDGETS.singleImageBytes) {
      push(
        "image-too-large",
        "warning",
        "This image is larger than any screen needs. Re-uploading it will generate smaller versions.",
        image.bytes,
        PERFORMANCE_BUDGETS.singleImageBytes,
        image.elementId,
      );
    }

    if (!image.hasDimensions) {
      push(
        "missing-dimensions",
        "error",
        "This image has no size, so the page moves as it loads and a visitor can tap the wrong thing.",
        0,
        1,
        image.elementId,
      );
    }
  }

  const eager = route.images.filter((image) => image.eager).length;
  if (eager > PERFORMANCE_BUDGETS.eagerImages) {
    push(
      "too-many-eager-images",
      "warning",
      "Several images load immediately and compete for the same connection. Only the ones visible before scrolling should.",
      eager,
      PERFORMANCE_BUDGETS.eagerImages,
    );
  }

  const fonts = new Set(route.fontFiles).size;
  if (fonts > PERFORMANCE_BUDGETS.fontFiles) {
    push(
      "too-many-fonts",
      "warning",
      "Each font file delays the first text a visitor sees. Reusing weights you already load is the cheapest fix.",
      fonts,
      PERFORMANCE_BUDGETS.fontFiles,
    );
  }

  return findings;
}

/**
 * The bundle check, run against the built artefact rather than against an intention.
 *
 * The two artefacts are judged separately because they are downloaded by different people under
 * different circumstances. Holding the application to the published-site budget would either fail
 * forever or force the published budget up to meet it, and a budget raised to match what was
 * already shipped measures nothing.
 */
export function auditBundle(
  bytes: number,
  target: "application" | "published-site" = "application",
): PerformanceFinding[] {
  const budget =
    target === "application"
      ? PERFORMANCE_BUDGETS.applicationBundleBytes
      : PERFORMANCE_BUDGETS.publishedSiteJavaScriptBytes;

  if (bytes <= budget) return [];

  return [
    {
      code: "javascript-budget",
      severity: "warning",
      path: "/",
      detail:
        target === "application"
          ? "The application bundle is over budget. Loading the editor separately from the dashboard is the usual fix."
          : "A published site is downloading JavaScript it did not before. Public routes are served as HTML; anything added here reaches every visitor of every site.",
      measured: bytes,
      budget,
    },
  ];
}

/**
 * Which images a page loads eagerly.
 *
 * Everything below the fold should wait, and the renderer already marks images lazy. This reports
 * what the document asks for so the budget check has something measured to work from.
 */
export function collectPageImages(page: BuilderPage, bytesOf: (mediaId: string) => number): RouteAssets["images"] {
  const images: Array<{ elementId: string; bytes: number; hasDimensions: boolean; eager: boolean }> = [];

  for (const section of page.sections) {
    for (const element of walkElements(section.elements)) {
      if (element.type !== "image") continue;

      images.push({
        elementId: element.id,
        bytes: element.source.kind === "media" ? bytesOf(element.source.mediaId) : 0,
        // A media-backed image has stored variants and therefore intrinsic dimensions; an external
        // URL has neither, which is why it cannot reserve space.
        hasDimensions: element.source.kind === "media",
        eager: false,
      });
    }
  }

  return images;
}
