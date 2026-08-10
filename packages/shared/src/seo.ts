import { z } from "zod";

const robotsSchema = z.object({ index: z.boolean(), follow: z.boolean() }).strict();

export const pageSeoSettingsSchema = z
  .object({
    title: z.string().max(200),
    description: z.string().max(400),
    canonicalPath: z.string().max(500).optional(),
    robots: robotsSchema,
    openGraph: z
      .object({
        title: z.string().max(200).optional(),
        description: z.string().max(400).optional(),
        mediaId: z.string().min(1).optional(),
        type: z.enum(["website", "article"]).optional(),
      })
      .strict()
      .optional(),
    twitter: z
      .object({
        card: z.enum(["summary", "summary_large_image"]),
        title: z.string().max(200).optional(),
        description: z.string().max(400).optional(),
        mediaId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    structuredDataType: z.enum(["WebPage", "AboutPage", "ContactPage", "Article"]).optional(),
  })
  .strict();

export type PageSeoSettings = z.infer<typeof pageSeoSettingsSchema>;

export const siteSeoSettingsSchema = z
  .object({
    siteName: z.string().max(120),
    /** "%s" is replaced by the resolved page title. */
    titleTemplate: z.string().max(120),
    defaultDescription: z.string().max(400),
    defaultSocialMediaId: z.string().min(1).optional(),
    /** Locale of the published website. Unrelated to the SaaS interface language. */
    locale: z.string().max(35),
    canonicalBaseUrl: z.string().url().optional(),
    organization: z
      .object({ name: z.string().max(160), logoMediaId: z.string().min(1).optional() })
      .strict()
      .optional(),
    defaultRobots: robotsSchema,
    searchConsoleVerification: z.string().max(200).optional(),
  })
  .strict();

export type SiteSeoSettings = z.infer<typeof siteSeoSettingsSchema>;

export function createDefaultPageSeo(): PageSeoSettings {
  return { title: "", description: "", robots: { index: true, follow: true } };
}

export function createDefaultSiteSeo(siteName: string): SiteSeoSettings {
  return {
    siteName,
    titleTemplate: "%s | %site%",
    defaultDescription: "",
    locale: "pt-BR",
    defaultRobots: { index: true, follow: true },
  };
}

/**
 * Resolves the metadata for one route: page override, then site default, then a safe generated
 * fallback. Editor, preview, the public renderer and any future exporter call this — a second
 * implementation is how a preview starts disagreeing with what crawlers actually receive.
 */
export function resolvePageMetadata(input: {
  page: PageSeoSettings;
  site: SiteSeoSettings;
  pageName: string;
}): { title: string; description: string; robots: { index: boolean; follow: boolean } } {
  const rawTitle = input.page.title.trim() || input.pageName.trim() || input.site.siteName.trim();
  const title = input.site.titleTemplate.includes("%s")
    ? input.site.titleTemplate.replace("%s", rawTitle).replace("%site%", input.site.siteName)
    : rawTitle;
  return {
    title: title.trim(),
    description: (input.page.description.trim() || input.site.defaultDescription.trim()).slice(0, 320),
    robots: {
      index: input.page.robots.index && input.site.defaultRobots.index,
      follow: input.page.robots.follow && input.site.defaultRobots.follow,
    },
  };
}
