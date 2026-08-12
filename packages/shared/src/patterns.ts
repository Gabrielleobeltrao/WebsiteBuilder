import { elementDefinition } from "./element-registry";
import type { BuilderElement, ElementType, SectionLayoutMode } from "./elements";
import type { BuilderSection } from "./project";

/**
 * Starter compositions, made of ordinary blocks.
 *
 * A hero, a pricing table, an FAQ — none of these is a *type*. Each is an arrangement of blocks
 * that already exist, and adding an element type for one would be adding a type for a layout: it
 * would render as one opaque thing, resist being taken apart, and need its own inspector for
 * settings the blocks inside it already have.
 *
 * So a pattern is a factory. Inserting one produces a normal section holding normal elements, in
 * one undoable step, and from that moment the page has no idea a pattern existed. Deleting this
 * whole file later would not break a single page that was built with one.
 *
 * The copy is supplied by the caller from its own locale, so an inserted pattern reads in the
 * language the person is working in — and is then ordinary editable text, not a translated string
 * that changes under them when they switch languages.
 */

export const PATTERN_CATEGORIES = ["page", "section", "content"] as const;
export type PatternCategory = (typeof PATTERN_CATEGORIES)[number];

/** Copy a pattern needs, keyed by a name the caller resolves in its own locale. */
export type PatternCopy = (key: string) => string;

export type PatternDefinition = {
  id: string;
  category: PatternCategory;
  /** Blocks this pattern is made of, so the catalog can say what it will insert. */
  uses: readonly ElementType[];
  build: (input: { copy: PatternCopy; createId: () => string }) => BuilderSection;
};

/** One element, from the registry's own defaults plus whatever this pattern overrides. */
function block(
  type: ElementType,
  createId: () => string,
  geometry: { x: number; y: number; width: number; height: number },
  overrides: Record<string, unknown> = {},
): BuilderElement {
  const definition = elementDefinition(type);
  return {
    id: createId(),
    name: "",
    geometry: { ...geometry, rotation: 0 },
    responsiveLayout: {
      width: { value: geometry.width, unit: "px" },
      height: { value: geometry.height, unit: "px" },
      horizontalConstraint: "left",
      verticalConstraint: "top",
      visible: true,
    },
    zIndex: 1,
    locked: false,
    hidden: false,
    type,
    version: definition.schemaVersion,
    ...definition.defaults(),
    ...overrides,
  } as BuilderElement;
}

function section(input: {
  createId: () => string;
  name: string;
  layoutMode: SectionLayoutMode;
  elements: BuilderElement[];
  backgroundColor?: string;
}): BuilderSection {
  return {
    id: input.createId(),
    name: input.name,
    layoutMode: input.layoutMode,
    heightByBreakpoint: {},
    layoutByBreakpoint: {},
    elements: input.elements.map((element, index) => ({ ...element, zIndex: index + 1 })),
    backgroundColor: input.backgroundColor ?? "#ffffff",
    hidden: false,
    // Ordinary content: a pattern's section is not a shared header or footer even when it looks
    // like one, because a shared section is one record every page points at and this is a copy the
    // person is free to change.
    role: "content",
  };
}

const heading = (createId: () => string, text: string, tag: "h1" | "h2" | "h3", size: number) =>
  block("text", createId, { x: 0, y: 0, width: 640, height: 64 }, {
    content: text,
    tag,
    style: {
      fontFamily: "Inter",
      fontSize: { value: size, unit: "px" },
      fontWeight: 700,
      fontStyle: "normal",
      textAlign: "left",
      color: "#111827",
      lineHeight: 1.2,
    },
  });

const paragraph = (createId: () => string, text: string) =>
  block("text", createId, { x: 0, y: 0, width: 640, height: 72 }, { content: text });

/**
 * The catalog.
 *
 * Every pattern is flex or grid rather than free: a starter arrangement has to survive being seen
 * on a phone, and a free section would place its blocks at coordinates chosen for a 1440 canvas.
 */
export const PATTERNS: readonly PatternDefinition[] = [
  {
    id: "header",
    category: "page",
    uses: ["siteLogo", "navigationMenu", "button"],
    build: ({ copy, createId }) =>
      section({
        createId,
        name: copy("header.name"),
        layoutMode: "flex",
        elements: [
          block("siteLogo", createId, { x: 0, y: 0, width: 180, height: 48 }, { fallbackText: copy("header.brand") }),
          block("navigationMenu", createId, { x: 0, y: 0, width: 480, height: 48 }, {
            items: [
              { label: copy("header.home"), link: { kind: "none" } },
              { label: copy("header.about"), link: { kind: "none" } },
              { label: copy("header.contact"), link: { kind: "none" } },
            ],
          }),
          block("button", createId, { x: 0, y: 0, width: 160, height: 44 }, { text: copy("header.cta") }),
        ],
      }),
  },
  {
    id: "footer",
    category: "page",
    uses: ["text", "navigationMenu", "socialLinks"],
    build: ({ copy, createId }) =>
      section({
        createId,
        name: copy("footer.name"),
        layoutMode: "flex",
        backgroundColor: "#111827",
        elements: [
          paragraph(createId, copy("footer.rights")),
          block("navigationMenu", createId, { x: 0, y: 0, width: 360, height: 44 }, {
            items: [
              { label: copy("footer.privacy"), link: { kind: "none" } },
              { label: copy("footer.terms"), link: { kind: "none" } },
            ],
            orientation: "vertical",
          }),
          block("socialLinks", createId, { x: 0, y: 0, width: 200, height: 44 }),
        ],
      }),
  },
  {
    id: "hero",
    category: "section",
    uses: ["text", "button"],
    build: ({ copy, createId }) =>
      section({
        createId,
        name: copy("hero.name"),
        layoutMode: "flex",
        elements: [
          heading(createId, copy("hero.title"), "h1", 44),
          paragraph(createId, copy("hero.subtitle")),
          block("button", createId, { x: 0, y: 0, width: 200, height: 48 }, { text: copy("hero.cta") }),
        ],
      }),
  },
  {
    id: "splitHero",
    category: "section",
    uses: ["text", "button", "image"],
    build: ({ copy, createId }) =>
      section({
        createId,
        name: copy("splitHero.name"),
        layoutMode: "grid",
        elements: [
          heading(createId, copy("splitHero.title"), "h1", 40),
          paragraph(createId, copy("splitHero.subtitle")),
          block("button", createId, { x: 0, y: 0, width: 200, height: 48 }, { text: copy("splitHero.cta") }),
          block("image", createId, { x: 0, y: 0, width: 520, height: 360 }, { alt: copy("splitHero.imageAlt") }),
        ],
      }),
  },
  {
    id: "featureGrid",
    category: "section",
    uses: ["text", "iconList"],
    build: ({ copy, createId }) =>
      section({
        createId,
        name: copy("featureGrid.name"),
        layoutMode: "grid",
        elements: [
          heading(createId, copy("featureGrid.title"), "h2", 32),
          block("iconList", createId, { x: 0, y: 0, width: 360, height: 160 }, {
            items: [
              { icon: "check", text: copy("featureGrid.first") },
              { icon: "check", text: copy("featureGrid.second") },
              { icon: "check", text: copy("featureGrid.third") },
            ],
          }),
        ],
      }),
  },
  {
    id: "trustRow",
    category: "section",
    uses: ["text", "gallery"],
    build: ({ copy, createId }) =>
      section({
        createId,
        name: copy("trustRow.name"),
        layoutMode: "flex",
        elements: [
          paragraph(createId, copy("trustRow.title")),
          block("gallery", createId, { x: 0, y: 0, width: 960, height: 120 }, { columns: 5, lightbox: false }),
        ],
      }),
  },
  {
    id: "gallery",
    category: "section",
    uses: ["text", "gallery"],
    build: ({ copy, createId }) =>
      section({
        createId,
        name: copy("gallery.name"),
        layoutMode: "flex",
        elements: [
          heading(createId, copy("gallery.title"), "h2", 32),
          block("gallery", createId, { x: 0, y: 0, width: 960, height: 420 }),
        ],
      }),
  },
  {
    id: "testimonials",
    category: "section",
    uses: ["text", "testimonial"],
    build: ({ copy, createId }) =>
      section({
        createId,
        name: copy("testimonials.name"),
        layoutMode: "grid",
        elements: [
          heading(createId, copy("testimonials.title"), "h2", 32),
          block("testimonial", createId, { x: 0, y: 0, width: 420, height: 200 }, {
            quote: copy("testimonials.quote"),
            personName: copy("testimonials.person"),
            personRole: copy("testimonials.role"),
          }),
        ],
      }),
  },
  {
    id: "pricing",
    category: "section",
    uses: ["text", "pricingTable"],
    build: ({ copy, createId }) =>
      section({
        createId,
        name: copy("pricing.name"),
        layoutMode: "flex",
        elements: [
          heading(createId, copy("pricing.title"), "h2", 32),
          block("pricingTable", createId, { x: 0, y: 0, width: 960, height: 420 }, {
            plans: [
              {
                name: copy("pricing.planName"),
                price: copy("pricing.price"),
                period: copy("pricing.period"),
                features: [copy("pricing.feature")],
                highlighted: false,
                link: { kind: "none" },
                ctaLabel: copy("pricing.cta"),
              },
            ],
          }),
        ],
      }),
  },
  {
    id: "faq",
    category: "section",
    uses: ["text", "accordion"],
    build: ({ copy, createId }) =>
      section({
        createId,
        name: copy("faq.name"),
        layoutMode: "flex",
        elements: [
          heading(createId, copy("faq.title"), "h2", 32),
          block("accordion", createId, { x: 0, y: 0, width: 720, height: 240 }, {
            items: [
              { question: copy("faq.question"), answer: copy("faq.answer") },
            ],
          }),
        ],
      }),
  },
  {
    id: "leadForm",
    category: "section",
    uses: ["text", "form"],
    build: ({ copy, createId }) =>
      section({
        createId,
        name: copy("leadForm.name"),
        layoutMode: "flex",
        elements: [
          heading(createId, copy("leadForm.title"), "h2", 32),
          paragraph(createId, copy("leadForm.subtitle")),
          block("form", createId, { x: 0, y: 0, width: 520, height: 360 }, { submitLabel: copy("leadForm.submit") }),
        ],
      }),
  },
  {
    id: "contact",
    category: "section",
    uses: ["text", "contactInfo"],
    build: ({ copy, createId }) =>
      section({
        createId,
        name: copy("contact.name"),
        layoutMode: "grid",
        elements: [
          heading(createId, copy("contact.title"), "h2", 32),
          block("contactInfo", createId, { x: 0, y: 0, width: 400, height: 200 }, {
            items: [
              { kind: "email", label: copy("contact.email"), value: "" },
              { kind: "phone", label: copy("contact.phone"), value: "" },
              { kind: "address", label: copy("contact.address"), value: "" },
            ],
          }),
        ],
      }),
  },
  {
    id: "cta",
    category: "section",
    uses: ["text", "button"],
    build: ({ copy, createId }) =>
      section({
        createId,
        name: copy("cta.name"),
        layoutMode: "flex",
        backgroundColor: "#f8fafc",
        elements: [
          heading(createId, copy("cta.title"), "h2", 32),
          block("button", createId, { x: 0, y: 0, width: 220, height: 48 }, { text: copy("cta.button") }),
        ],
      }),
  },
  {
    id: "articleHeader",
    category: "content",
    uses: ["text", "breadcrumbs", "image"],
    build: ({ copy, createId }) =>
      section({
        createId,
        name: copy("articleHeader.name"),
        layoutMode: "flex",
        elements: [
          block("breadcrumbs", createId, { x: 0, y: 0, width: 480, height: 32 }, { label: copy("articleHeader.trail") }),
          heading(createId, copy("articleHeader.title"), "h1", 40),
          paragraph(createId, copy("articleHeader.standfirst")),
          block("image", createId, { x: 0, y: 0, width: 960, height: 420 }, { alt: copy("articleHeader.imageAlt") }),
        ],
      }),
  },
];

export function patternById(id: string): PatternDefinition | undefined {
  return PATTERNS.find((pattern) => pattern.id === id);
}
