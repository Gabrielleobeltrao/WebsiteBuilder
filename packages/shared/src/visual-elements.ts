import { z } from "zod";

import { safeLinkSchema } from "./links";
import { elementBaseShape } from "./responsive";

/**
 * Essential visual elements.
 *
 * Every one of these is structured data validated against an allowlist. There is deliberately no
 * element that accepts HTML, CSS, JavaScript or an arbitrary iframe: a builder that lets a designer
 * paste a script tag is a builder that ships stored XSS to every visitor of every site it produces,
 * and no amount of sanitising afterwards fixes the shape of that hole.
 */

const elementBase = elementBaseShape;

/** Icons come from one bundled set. A name outside it renders nothing rather than a broken glyph. */
export const ICON_NAMES = [
  "arrow-right", "arrow-left", "check", "close", "chevron-down", "chevron-up",
  "mail", "phone", "map-pin", "clock", "calendar", "star", "heart", "search",
  "download", "external-link", "play", "menu", "plus", "minus", "info", "alert",
] as const;
export type IconName = (typeof ICON_NAMES)[number];

export const SOCIAL_NETWORKS = [
  "instagram", "facebook", "linkedin", "youtube", "tiktok", "whatsapp", "x", "github",
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/** Video providers whose embed URLs can be constructed from an id, never from a pasted iframe. */
export const VIDEO_PROVIDERS = ["youtube", "vimeo"] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

export const iconElementSchema = z
  .object({ ...elementBase, type: z.literal("icon"), icon: z.enum(ICON_NAMES), size: z.number().int().min(8).max(200), color: z.string().max(40), link: safeLinkSchema })
  .strict();

export const iconListElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("iconList"),
    items: z.array(z.object({ icon: z.enum(ICON_NAMES), text: z.string().max(200) }).strict()).max(20),
    iconSize: z.number().int().min(8).max(64),
    gap: z.number().int().min(0).max(48),
  })
  .strict();

export const dividerElementSchema = z
  .object({ ...elementBase, type: z.literal("divider"), thickness: z.number().int().min(1).max(20), color: z.string().max(40), style: z.enum(["solid", "dashed", "dotted"]) })
  .strict();

export const spacerElementSchema = z
  .object({ ...elementBase, type: z.literal("spacer") })
  .strict();

export const accordionElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("accordion"),
    items: z.array(z.object({ question: z.string().max(300), answer: z.string().max(3000) }).strict()).max(30),
    /** Whether more than one panel may be open. Both are valid patterns; the renderer honours it. */
    allowMultiple: z.boolean(),
  })
  .strict();

export const tabsElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("tabs"),
    items: z.array(z.object({ label: z.string().max(80), content: z.string().max(3000) }).strict()).min(1).max(12),
  })
  .strict();

export const galleryElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("gallery"),
    mediaIds: z.array(z.string().min(1)).max(60),
    columns: z.number().int().min(1).max(6),
    gap: z.number().int().min(0).max(48),
    lightbox: z.boolean(),
  })
  .strict();

export const videoElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("video"),
    provider: z.enum(VIDEO_PROVIDERS),
    /**
     * The provider's own id. The embed URL is built here; no URL from a document is ever loaded.
     *
     * Empty is a valid stored state and means "not configured yet": a block has to be insertable
     * before it can be filled in. The renderer shows a placeholder for it and readiness reports it,
     * which is the difference between an unfinished page and a broken one.
     */
    videoId: z.string().max(64).regex(/^[A-Za-z0-9_-]*$/, "must be a provider video id"),
    title: z.string().max(200),
  })
  .strict();

export const socialLinksElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("socialLinks"),
    items: z.array(z.object({ network: z.enum(SOCIAL_NETWORKS), url: z.string().url() }).strict()).max(12),
    iconSize: z.number().int().min(12).max(64),
    gap: z.number().int().min(0).max(48),
  })
  .strict();

export const downloadButtonElementSchema = z
  // Empty `mediaId` means no file chosen yet, for the same reason as the video id above.
  .object({ ...elementBase, type: z.literal("downloadButton"), mediaId: z.string().max(120), label: z.string().max(120) })
  .strict();

export const breadcrumbsElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("breadcrumbs"),
    separator: z.enum(["chevron", "slash", "dot"]),
    /**
     * Announced by a screen reader on the published site, so it belongs to the site's language and
     * not to the editor's. A Portuguese site should not say "Breadcrumb".
     */
    label: z.string().min(1).max(60),
  })
  .strict();

export const tableElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("table"),
    headers: z.array(z.string().max(120)).max(12),
    rows: z.array(z.array(z.string().max(500)).max(12)).max(200),
    /** A table without a header row is a layout table, which assistive technology cannot navigate. */
    hasHeaderRow: z.boolean(),
    caption: z.string().max(300),
  })
  .strict();

export const pricingTableElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("pricingTable"),
    plans: z
      .array(
        z
          .object({
            name: z.string().max(80),
            price: z.string().max(40),
            period: z.string().max(40),
            features: z.array(z.string().max(200)).max(20),
            highlighted: z.boolean(),
            link: safeLinkSchema,
            ctaLabel: z.string().max(60),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();

export const announcementBarElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("announcementBar"),
    text: z.string().max(300),
    link: safeLinkSchema,
    backgroundColor: z.string().max(40),
    textColor: z.string().max(40),
    dismissible: z.boolean(),
  })
  .strict();

/**
 * A form placed on a page.
 *
 * The element holds a *reference* and its presentation, never the field definitions: those live in
 * the forms module, are edited once, and are shared by every page that shows the form. A copy here
 * would drift from the definition that actually validates a submission.
 *
 * An empty `formId` is the state a freshly inserted block is in. Readiness reports it, and
 * publishing refuses a page whose form was never chosen — an empty form silently accepting nothing
 * is worse than a page that says what it needs.
 */
export const formElementSchema = z
  .object({
    ...elementBase,
    type: z.literal("form"),
    formId: z.string().max(120),
    submitLabel: z.string().max(80),
    successMessage: z.string().max(500),
    errorMessage: z.string().max(500),
    /** Shown beside the submit control when the site asks for consent before storing a submission. */
    consentText: z.string().max(500),
    consentRequired: z.boolean(),
  })
  .strict();

export type FormElement = z.infer<typeof formElementSchema>;

/** The members, exported separately so the document union can spread them in. */
export const VISUAL_ELEMENT_SCHEMAS = [
  iconElementSchema,
  iconListElementSchema,
  dividerElementSchema,
  spacerElementSchema,
  accordionElementSchema,
  tabsElementSchema,
  galleryElementSchema,
  videoElementSchema,
  socialLinksElementSchema,
  downloadButtonElementSchema,
  breadcrumbsElementSchema,
  tableElementSchema,
  pricingTableElementSchema,
  announcementBarElementSchema,
  formElementSchema,
] as const;

export const visualElementSchema = z.discriminatedUnion("type", [...VISUAL_ELEMENT_SCHEMAS]);

export type VisualElement = z.infer<typeof visualElementSchema>;
export type IconElement = z.infer<typeof iconElementSchema>;
export type AccordionElement = z.infer<typeof accordionElementSchema>;
export type TabsElement = z.infer<typeof tabsElementSchema>;
export type VideoElement = z.infer<typeof videoElementSchema>;
export type TableElement = z.infer<typeof tableElementSchema>;
export type SocialLinksElement = z.infer<typeof socialLinksElementSchema>;

/**
 * The embed URL for a video.
 *
 * Built from the provider and an id that is already constrained to an id-shaped string, so there is
 * no path by which a document supplies the URL an iframe loads. `youtube-nocookie` is used because
 * a site owner embedding a video has not asked to set tracking cookies on their visitors.
 */
export function videoEmbedUrl(element: Pick<VideoElement, "provider" | "videoId">): string {
  return element.provider === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${element.videoId}`
    : `https://player.vimeo.com/video/${element.videoId}`;
}

/** The one `allow` list an embedded player gets. Notably without `camera` and `microphone`. */
export const VIDEO_IFRAME_ALLOW = "accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture";

/**
 * Checks that a social URL actually belongs to the network it claims.
 *
 * A row labelled Instagram that opens somewhere else is the shape of a phishing link, and the
 * person who added it is usually not the person who notices.
 */
const SOCIAL_HOSTS: Record<SocialNetwork, readonly string[]> = {
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com"],
  linkedin: ["linkedin.com"],
  youtube: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com"],
  whatsapp: ["wa.me", "whatsapp.com"],
  x: ["x.com", "twitter.com"],
  github: ["github.com"],
};

export function socialUrlMatchesNetwork(network: SocialNetwork, url: string): boolean {
  let hostname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }

  return SOCIAL_HOSTS[network].some((host) => hostname === host || hostname.endsWith(`.${host}`));
}
