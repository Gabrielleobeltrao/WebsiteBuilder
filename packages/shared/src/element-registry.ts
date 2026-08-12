import { ELEMENT_TYPES, type BuilderElement, type ElementType } from "./elements";
import type { SiteFeatureKey } from "./project";
import { ICON_NAMES } from "./visual-elements";

/**
 * One description per block, and the only place that describes one.
 *
 * Before this, a block's existence was asserted in five places that had to be kept in agreement by
 * hand: the schema union, the authoring catalog, the create-element switch, the inspector routing
 * and the renderer. They drifted — fourteen schemas were saved and validated by the document while
 * nothing in the product could create them, and feature detection compared element types against
 * strings no element could ever have.
 *
 * Everything here is data. The React halves — which inspector and which renderer a block uses —
 * live in the frontend as total records over the same union, so a block added without either is a
 * typecheck failure rather than a runtime surprise.
 */

export const ELEMENT_CATEGORIES = ["layout", "basic", "media", "interactive", "marketing", "navigation"] as const;
export type ElementCategory = (typeof ELEMENT_CATEGORIES)[number];

/**
 * Where a block may be placed.
 *
 * A page is the ordinary document. Blog and CMS templates are rendered against a record, so a block
 * that reads from one is meaningless on a page and must not be offered there.
 */
export const ELEMENT_CONTEXTS = ["page", "blogTemplate", "cmsTemplate"] as const;
export type ElementContext = (typeof ELEMENT_CONTEXTS)[number];

/**
 * Behaviour a block needs from the public interaction runtime.
 *
 * Declared per block so a published page loads the runtime only when something on it uses one of
 * these, and loads nothing when the page is static — which is most pages.
 */
export const RUNTIME_CAPABILITIES = [
  "tabs",
  "accordion",
  "lightbox",
  "carousel",
  "dismiss",
  "navigation",
  "countdown",
  "reveal",
  "tableOfContents",
] as const;
export type RuntimeCapability = (typeof RUNTIME_CAPABILITIES)[number];

/** The size a newly inserted block gets on the 1440 canvas, before any override. */
export type DefaultSize = { width: number; height: number };

export type ElementDefinition = {
  type: ElementType;
  /**
   * The payload version this definition writes. A stored element carrying an older version is
   * migrated on read; a stored element carrying a newer one belongs to a newer deployment and is
   * refused rather than silently misread.
   */
  schemaVersion: number;
  category: ElementCategory;
  /** Suffix under the `builder:elements` namespace. Never a literal string. */
  labelKey: ElementType;
  /**
   * Extra search terms, as translation keys under `builder:catalog.keywords`. Searching for
   * "botão" should find the button even though its label is "Button" in the other locale.
   */
  keywords: readonly string[];
  /** Name in the catalog icon set. Not the block's own content. */
  icon: string;
  defaultSize: DefaultSize;
  contexts: readonly ElementContext[];
  /** Whether the block holds other blocks. Only a container does today. */
  acceptsChildren: boolean;
  /** Whether a free section may position it by coordinate. A page-wide bar cannot be. */
  freePositionable: boolean;
  /** The optional module a reference to this block activates. */
  feature?: SiteFeatureKey;
  runtime?: RuntimeCapability;
  /** Builds the type-specific half of a new element. The base half is the editor's concern. */
  defaults: () => Record<string, unknown>;
};

const EMPTY_LINK = { kind: "none" } as const;

/**
 * The catalog.
 *
 * A `Record` over the union rather than an array: adding a type to `ElementType` without describing
 * it here does not compile, which is the property that keeps this the single source of truth rather
 * than one more list to remember.
 */
export const ELEMENT_REGISTRY: Record<ElementType, ElementDefinition> = {
  container: {
    type: "container",
    schemaVersion: 1,
    category: "layout",
    labelKey: "container",
    keywords: ["group", "box", "columns"],
    icon: "square",
    defaultSize: { width: 480, height: 240 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: true,
    freePositionable: true,
    defaults: () => ({ layout: "free", children: [], layoutByBreakpoint: {} }),
  },
  divider: {
    type: "divider",
    schemaVersion: 1,
    category: "layout",
    labelKey: "divider",
    keywords: ["rule", "separator", "line"],
    icon: "minus",
    defaultSize: { width: 480, height: 16 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({ thickness: 1, color: "#e2e8f0", style: "solid" }),
  },
  spacer: {
    type: "spacer",
    schemaVersion: 1,
    category: "layout",
    labelKey: "spacer",
    keywords: ["gap", "space"],
    icon: "move-vertical",
    defaultSize: { width: 480, height: 48 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({}),
  },

  text: {
    type: "text",
    schemaVersion: 1,
    category: "basic",
    labelKey: "text",
    keywords: ["paragraph", "heading", "title", "copy"],
    icon: "type",
    defaultSize: { width: 320, height: 64 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({
      content: "Text",
      tag: "p",
      style: {
        fontFamily: "Inter",
        fontSize: { value: 16, unit: "px" },
        fontWeight: 400,
        fontStyle: "normal",
        textAlign: "left",
        color: "#111827",
        lineHeight: 1.5,
      },
    }),
  },
  icon: {
    type: "icon",
    schemaVersion: 1,
    category: "basic",
    labelKey: "icon",
    keywords: ["symbol", "glyph"],
    icon: "star",
    defaultSize: { width: 48, height: 48 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({ icon: ICON_NAMES[0], size: 32, color: "#111827", link: EMPTY_LINK }),
  },
  iconList: {
    type: "iconList",
    schemaVersion: 1,
    category: "basic",
    labelKey: "iconList",
    keywords: ["bullets", "features", "checklist"],
    icon: "list",
    defaultSize: { width: 360, height: 140 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({
      items: [
        { icon: "check", text: "First item" },
        { icon: "check", text: "Second item" },
      ],
      iconSize: 20,
      gap: 12,
    }),
  },
  button: {
    type: "button",
    schemaVersion: 1,
    category: "basic",
    labelKey: "button",
    keywords: ["cta", "action", "link"],
    icon: "mouse-pointer-click",
    defaultSize: { width: 180, height: 48 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({
      text: "Button",
      // Deliberately unconfigured: a button that silently points nowhere is worse than one that
      // visibly needs configuring.
      link: EMPTY_LINK,
      style: {
        fontSize: { value: 16, unit: "px" },
        fontWeight: 600,
        textColor: "#ffffff",
        backgroundColor: "#12806f",
        borderRadius: 6,
        horizontalAlign: "center",
      },
    }),
  },
  table: {
    type: "table",
    schemaVersion: 1,
    category: "basic",
    labelKey: "table",
    keywords: ["grid", "rows", "columns", "data"],
    icon: "table",
    defaultSize: { width: 640, height: 200 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({
      headers: ["Column A", "Column B"],
      rows: [
        ["", ""],
        ["", ""],
      ],
      hasHeaderRow: true,
      caption: "",
    }),
  },

  richText: {
    type: "richText",
    schemaVersion: 1,
    category: "basic",
    labelKey: "richText",
    keywords: ["prose", "article", "formatted", "paragraphs"],
    icon: "type",
    defaultSize: { width: 640, height: 240 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({ content: { type: "doc", content: [] } }),
  },

  image: {
    type: "image",
    schemaVersion: 1,
    category: "media",
    labelKey: "image",
    keywords: ["photo", "picture", "media"],
    icon: "image",
    defaultSize: { width: 400, height: 260 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({
      source: { kind: "empty" },
      alt: "",
      decorative: false,
      style: { objectFit: "cover", borderRadius: 0 },
    }),
  },
  gallery: {
    type: "gallery",
    schemaVersion: 2,
    category: "media",
    labelKey: "gallery",
    keywords: ["photos", "grid", "album"],
    icon: "images",
    defaultSize: { width: 640, height: 320 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    runtime: "lightbox",
    defaults: () => ({ items: [], columns: 3, gap: 12, lightbox: true }),
  },
  video: {
    type: "video",
    schemaVersion: 1,
    category: "media",
    labelKey: "video",
    keywords: ["youtube", "vimeo", "embed", "player"],
    icon: "play",
    defaultSize: { width: 640, height: 360 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({ provider: "youtube", videoId: "", title: "" }),
  },
  downloadButton: {
    type: "downloadButton",
    schemaVersion: 1,
    category: "media",
    labelKey: "downloadButton",
    keywords: ["file", "pdf", "attachment"],
    icon: "download",
    defaultSize: { width: 220, height: 48 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({ mediaId: "", label: "Download" }),
  },

  accordion: {
    type: "accordion",
    schemaVersion: 1,
    category: "interactive",
    labelKey: "accordion",
    keywords: ["faq", "questions", "collapse"],
    icon: "chevron-down",
    defaultSize: { width: 640, height: 200 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    runtime: "accordion",
    defaults: () => ({
      items: [{ question: "Question", answer: "Answer" }],
      allowMultiple: false,
    }),
  },
  tabs: {
    type: "tabs",
    schemaVersion: 1,
    category: "interactive",
    labelKey: "tabs",
    keywords: ["panels", "sections"],
    icon: "columns",
    defaultSize: { width: 640, height: 240 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    runtime: "tabs",
    defaults: () => ({
      items: [
        { label: "First", content: "" },
        { label: "Second", content: "" },
      ],
    }),
  },
  announcementBar: {
    type: "announcementBar",
    schemaVersion: 1,
    category: "interactive",
    labelKey: "announcementBar",
    keywords: ["banner", "notice", "promo"],
    icon: "megaphone",
    defaultSize: { width: 1440, height: 48 },
    contexts: ["page"],
    acceptsChildren: false,
    // A bar spans the page. Letting it be dragged to a coordinate would promise a placement the
    // published output cannot honour.
    freePositionable: false,
    runtime: "dismiss",
    defaults: () => ({
      text: "Announcement",
      link: EMPTY_LINK,
      backgroundColor: "#111827",
      textColor: "#ffffff",
      dismissible: true,
    }),
  },

  form: {
    type: "form",
    schemaVersion: 1,
    category: "interactive",
    labelKey: "form",
    keywords: ["contact", "lead", "fields", "submit"],
    icon: "clipboard-list",
    defaultSize: { width: 480, height: 360 },
    contexts: ["page"],
    acceptsChildren: false,
    freePositionable: true,
    // The one block that activates an optional module. Inserting it is what makes the Forms
    // destination appear; removing the last one is what hides it again.
    feature: "forms",
    defaults: () => ({
      formId: "",
      submitLabel: "Send",
      successMessage: "Thank you. Your message has been sent.",
      errorMessage: "Your message could not be sent. Please try again.",
      consentText: "",
      consentRequired: false,
    }),
  },

  pricingTable: {
    type: "pricingTable",
    schemaVersion: 1,
    category: "marketing",
    labelKey: "pricingTable",
    keywords: ["plans", "price", "tiers"],
    icon: "credit-card",
    defaultSize: { width: 960, height: 420 },
    contexts: ["page"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({
      plans: [
        { name: "Plan", price: "0", period: "month", features: [], highlighted: false, link: EMPTY_LINK, ctaLabel: "Choose" },
      ],
    }),
  },

  testimonial: {
    type: "testimonial",
    schemaVersion: 1,
    category: "marketing",
    labelKey: "testimonial",
    keywords: ["quote", "review", "customer", "praise"],
    icon: "star",
    defaultSize: { width: 480, height: 220 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({ quote: "", personName: "", personRole: "", avatarMediaId: "" }),
  },
  counter: {
    type: "counter",
    schemaVersion: 1,
    category: "marketing",
    labelKey: "counter",
    keywords: ["number", "statistic", "progress", "metric"],
    icon: "plus",
    defaultSize: { width: 240, height: 120 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    runtime: "reveal",
    defaults: () => ({ value: 0, prefix: "", suffix: "", label: "", display: "number" }),
  },
  contactInfo: {
    type: "contactInfo",
    schemaVersion: 1,
    category: "marketing",
    labelKey: "contactInfo",
    keywords: ["phone", "email", "address", "hours", "contact"],
    icon: "phone",
    defaultSize: { width: 360, height: 200 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({ items: [{ kind: "email", label: "Email", value: "" }], iconSize: 20 }),
  },

  carousel: {
    type: "carousel",
    schemaVersion: 1,
    category: "media",
    labelKey: "carousel",
    keywords: ["slider", "slides", "rotator"],
    icon: "images",
    defaultSize: { width: 960, height: 420 },
    contexts: ["page"],
    acceptsChildren: false,
    freePositionable: true,
    runtime: "carousel",
    defaults: () => ({ slides: [], autoplaySeconds: 0 }),
  },
  countdown: {
    type: "countdown",
    schemaVersion: 1,
    category: "interactive",
    labelKey: "countdown",
    keywords: ["timer", "launch", "deadline", "clock"],
    icon: "clock",
    defaultSize: { width: 360, height: 120 },
    contexts: ["page"],
    acceptsChildren: false,
    freePositionable: true,
    runtime: "countdown",
    defaults: () => ({ target: "", expiredText: "" }),
  },

  siteLogo: {
    type: "siteLogo",
    schemaVersion: 1,
    category: "navigation",
    labelKey: "siteLogo",
    keywords: ["logo", "brand", "mark", "identity"],
    icon: "image",
    defaultSize: { width: 180, height: 60 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({ mediaId: "", alt: "", fallbackText: "", linksHome: true }),
  },
  navigationMenu: {
    type: "navigationMenu",
    schemaVersion: 1,
    category: "navigation",
    labelKey: "navigationMenu",
    keywords: ["menu", "nav", "pages", "header"],
    icon: "menu",
    defaultSize: { width: 640, height: 48 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    runtime: "navigation",
    defaults: () => ({ items: [], orientation: "horizontal", collapseBelow: 768 }),
  },
  tableOfContents: {
    type: "tableOfContents",
    schemaVersion: 1,
    category: "navigation",
    labelKey: "tableOfContents",
    keywords: ["contents", "outline", "index", "headings"],
    icon: "list",
    defaultSize: { width: 320, height: 240 },
    // Only where there is long-form prose to summarise. On an ordinary page it would list
    // whatever headings happened to be there, which is not a table of contents.
    contexts: ["blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    runtime: "tableOfContents",
    defaults: () => ({ title: "", minLevel: 2, maxLevel: 3 }),
  },

  socialLinks: {
    type: "socialLinks",
    schemaVersion: 1,
    category: "navigation",
    labelKey: "socialLinks",
    keywords: ["instagram", "facebook", "profiles"],
    icon: "share",
    defaultSize: { width: 240, height: 48 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({ items: [], iconSize: 24, gap: 12 }),
  },
  breadcrumbs: {
    type: "breadcrumbs",
    schemaVersion: 1,
    category: "navigation",
    labelKey: "breadcrumbs",
    keywords: ["path", "trail"],
    icon: "chevron-right",
    defaultSize: { width: 480, height: 32 },
    contexts: ["page", "blogTemplate", "cmsTemplate"],
    acceptsChildren: false,
    freePositionable: true,
    defaults: () => ({ separator: "chevron", label: "Breadcrumb" }),
  },
};

/** Every definition, in catalog order: category order first, then declaration order. */
export const ELEMENT_DEFINITIONS: readonly ElementDefinition[] = ELEMENT_CATEGORIES.flatMap((category) =>
  ELEMENT_TYPES.map((type) => ELEMENT_REGISTRY[type]).filter((definition) => definition.category === category),
);

export function elementDefinition(type: ElementType): ElementDefinition {
  return ELEMENT_REGISTRY[type];
}

/** The blocks a given document context may contain. */
export function elementsForContext(context: ElementContext): readonly ElementDefinition[] {
  return ELEMENT_DEFINITIONS.filter((definition) => definition.contexts.includes(context));
}

/**
 * Element types that count as a reference to an optional module.
 *
 * Derived rather than listed. The list this replaced named types no element could ever have, so
 * every count it produced was zero and the feature lifecycle it fed could never leave "unused".
 */
export function featureElementTypes(feature: SiteFeatureKey): readonly ElementType[] {
  return ELEMENT_TYPES.filter((type) => ELEMENT_REGISTRY[type].feature === feature);
}

/** The runtime capabilities a set of elements needs, deduplicated and in declaration order. */
export function runtimeCapabilitiesFor(elements: Iterable<BuilderElement>): RuntimeCapability[] {
  const needed = new Set<RuntimeCapability>();
  for (const element of elements) {
    const capability = ELEMENT_REGISTRY[element.type as ElementType]?.runtime;
    if (capability !== undefined) needed.add(capability);
  }
  return RUNTIME_CAPABILITIES.filter((capability) => needed.has(capability));
}
