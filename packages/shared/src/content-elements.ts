import { z } from "zod";

import { richTextDocumentSchema } from "./blog";
import { safeLinkSchema } from "./links";
import { elementBaseShape } from "./responsive";
import { ICON_NAMES } from "./visual-elements";

/**
 * The blocks that carry meaning a page cannot express by arranging the others.
 *
 * A composition — a hero, a feature card, a testimonial wall — is a pattern made of existing
 * blocks, and adding a type for it would be adding a type for a layout. What justifies a type here
 * is data or behaviour of its own: prose with structure, a menu bound to the site's pages, a value
 * that counts, a moment that passes.
 *
 * Every one of them is structured and validated. There is still no element anywhere in this product
 * that accepts HTML, script, or an arbitrary URL to load.
 */

const elementBase = elementBaseShape;

/**
 * Prose.
 *
 * Stored as the editor's own validated document, never as HTML. The node vocabulary is the blog's,
 * already allowlisted and already parsed by the server, so the two rich-text surfaces in the
 * product cannot diverge on what a paragraph is allowed to contain.
 */
export const richTextElementSchema = z
  .object({ ...elementBase, type: z.literal("richText"), content: richTextDocumentSchema })
  .strict();

/**
 * The site's navigation, bound to its pages.
 *
 * Items reference a page rather than repeating its address, so renaming or moving a page updates
 * every menu that points at it. An external item is a typed link like any other.
 */
export const navigationMenuElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("navigationMenu"),
    items: z
      .array(
        z
          .object({
            label: z.string().max(80),
            link: safeLinkSchema,
            children: z
              .array(z.object({ label: z.string().max(80), link: safeLinkSchema }).strict())
              .max(12)
              .optional(),
          })
          .strict(),
      )
      .max(20),
    orientation: z.enum(["horizontal", "vertical"]),
    /** Below this width the menu becomes a disclosure rather than a row that wraps into a wall. */
    collapseBelow: z.number().int().min(320).max(1440),
  })
  .strict();

/** The site's mark, linking home. An override is for a page that needs a different one. */
export const siteLogoElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("siteLogo"),
    mediaId: z.string().max(120),
    alt: z.string().max(200),
    /** Text shown when no image is chosen, so the header is never empty. */
    fallbackText: z.string().max(120),
    linksHome: z.boolean(),
  })
  .strict();

export const testimonialElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("testimonial"),
    quote: z.string().max(1000),
    personName: z.string().max(120),
    personRole: z.string().max(160),
    avatarMediaId: z.string().max(120),
    /** Absent means no rating shown. A zero-star rating is a claim; absence is not. */
    rating: z.number().int().min(1).max(5).optional(),
  })
  .strict();

export const carouselElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("carousel"),
    slides: z
      .array(
        z
          .object({
            mediaId: z.string().max(120),
            alt: z.string().max(500),
            heading: z.string().max(200),
            text: z.string().max(1000),
            link: safeLinkSchema,
            ctaLabel: z.string().max(60),
          })
          .strict(),
      )
      .max(20),
    /** Autoplay is off by default: motion nobody asked for is motion somebody has to fight. */
    autoplaySeconds: z.number().int().min(0).max(60),
  })
  .strict();

export const CONTACT_ITEM_KINDS = ["phone", "email", "address", "hours", "whatsapp"] as const;
export type ContactItemKind = (typeof CONTACT_ITEM_KINDS)[number];

export const contactInfoElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("contactInfo"),
    items: z
      .array(
        z
          .object({
            kind: z.enum(CONTACT_ITEM_KINDS),
            label: z.string().max(120),
            value: z.string().max(300),
          })
          .strict(),
      )
      .max(12),
    iconSize: z.number().int().min(12).max(48),
  })
  .strict();

/** A number that counts up, or a bar that fills. Both are one value with a maximum. */
export const counterElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("counter"),
    value: z.number().finite(),
    /** Only meaningful for a bar; a plain counter has no ceiling. */
    max: z.number().finite().positive().optional(),
    prefix: z.string().max(20),
    suffix: z.string().max(20),
    label: z.string().max(160),
    display: z.enum(["number", "bar"]),
  })
  .strict();

export const countdownElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("countdown"),
    /**
     * An absolute instant, stored with its offset.
     *
     * A wall-clock time without one means something different in every timezone, which is how a
     * launch counts down to the wrong moment for half the visitors.
     */
    target: z.string().max(40),
    /** What the block says once the moment has passed. Rendered server-side, so it is always true. */
    expiredText: z.string().max(200),
  })
  .strict();

export const tableOfContentsElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("tableOfContents"),
    title: z.string().max(120),
    /** Which heading levels to include. A list of every level is a list nobody reads. */
    minLevel: z.number().int().min(1).max(6),
    maxLevel: z.number().int().min(1).max(6),
  })
  .strict();

export const CONTENT_ELEMENT_SCHEMAS = [
  richTextElementSchema,
  navigationMenuElementSchema,
  siteLogoElementSchema,
  testimonialElementSchema,
  carouselElementSchema,
  contactInfoElementSchema,
  counterElementSchema,
  countdownElementSchema,
  tableOfContentsElementSchema,
] as const;

export type RichTextElement = z.infer<typeof richTextElementSchema>;
export type NavigationMenuElement = z.infer<typeof navigationMenuElementSchema>;
export type SiteLogoElement = z.infer<typeof siteLogoElementSchema>;
export type TestimonialElement = z.infer<typeof testimonialElementSchema>;
export type CarouselElement = z.infer<typeof carouselElementSchema>;
export type ContactInfoElement = z.infer<typeof contactInfoElementSchema>;
export type CounterElement = z.infer<typeof counterElementSchema>;
export type CountdownElement = z.infer<typeof countdownElementSchema>;
export type TableOfContentsElement = z.infer<typeof tableOfContentsElementSchema>;

export type ContentElement = z.infer<
  (typeof CONTENT_ELEMENT_SCHEMAS)[number]
>;

/** The icon each kind of contact detail is shown with, from the closed set. */
export const CONTACT_ICONS: Record<ContactItemKind, (typeof ICON_NAMES)[number]> = {
  phone: "phone",
  email: "mail",
  address: "map-pin",
  hours: "clock",
  whatsapp: "phone",
};

/**
 * Whether a countdown's target is a real instant with a zone.
 *
 * `2026-01-01T00:00` is not: it is midnight somewhere, and the block would count down to a
 * different moment for every visitor.
 */
export function hasTimezone(target: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(target.trim()) && !Number.isNaN(Date.parse(target));
}
