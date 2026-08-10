import type { PageSeoSettings, SiteSeoSettings } from "./seo";

/**
 * One SEO resolver, shared by the editor preview, the public renderer, the sitemap and any future
 * exporter.
 *
 * Resolution is strictly: page or post override, then site default, then a safe generated fallback.
 * A second implementation is how a preview starts promising metadata that crawlers never receive,
 * so nothing else in the product decides what a route's metadata is.
 */

export type ResolvedMetadata = {
  title: string;
  description: string;
  canonicalUrl: string | null;
  robots: { index: boolean; follow: boolean };
  openGraph: { title: string; description: string; type: "website" | "article"; imageMediaId: string | null };
  twitter: { card: "summary" | "summary_large_image"; title: string; description: string; imageMediaId: string | null };
  locale: string;
  structuredDataType: "WebPage" | "AboutPage" | "ContactPage" | "Article";
};

export type MetadataInput = {
  site: SiteSeoSettings;
  page: PageSeoSettings;
  /** Used as the last-resort title when neither the page nor the site names the route. */
  fallbackTitle: string;
  /** Path the route is served at, e.g. "/about". */
  path: string;
};

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value !== undefined && value.trim().length > 0) return value.trim();
  }
  return "";
}

/** Applies the site's title template, tolerating a template that names neither placeholder. */
export function applyTitleTemplate(template: string, title: string, siteName: string): string {
  if (title.length === 0) return siteName;
  if (!template.includes("%s")) return title;
  return template.replace("%s", title).replace("%site%", siteName).trim();
}

export function resolveMetadata(input: MetadataInput): ResolvedMetadata {
  const rawTitle = firstNonEmpty(input.page.title, input.fallbackTitle, input.site.siteName);
  const title = applyTitleTemplate(input.site.titleTemplate, rawTitle, input.site.siteName);

  const description = firstNonEmpty(input.page.description, input.site.defaultDescription).slice(0, 320);

  // A canonical URL is only produced when a real base is configured. Guessing one is worse than
  // emitting none: a wrong canonical removes pages from search entirely.
  const canonicalUrl = input.site.canonicalBaseUrl
    ? new URL(input.page.canonicalPath ?? input.path, input.site.canonicalBaseUrl).toString()
    : null;

  // Both must allow it. A page cannot opt into indexing that the site turned off.
  const robots = {
    index: input.site.defaultRobots.index && input.page.robots.index,
    follow: input.site.defaultRobots.follow && input.page.robots.follow,
  };

  const ogImage = input.page.openGraph?.mediaId ?? input.site.defaultSocialMediaId ?? null;

  return {
    title,
    description,
    canonicalUrl,
    robots,
    openGraph: {
      title: firstNonEmpty(input.page.openGraph?.title, rawTitle),
      description: firstNonEmpty(input.page.openGraph?.description, description),
      type: input.page.openGraph?.type ?? "website",
      imageMediaId: ogImage,
    },
    twitter: {
      card: input.page.twitter?.card ?? (ogImage ? "summary_large_image" : "summary"),
      title: firstNonEmpty(input.page.twitter?.title, input.page.openGraph?.title, rawTitle),
      description: firstNonEmpty(input.page.twitter?.description, description),
      imageMediaId: input.page.twitter?.mediaId ?? ogImage,
    },
    locale: input.site.locale,
    structuredDataType: input.page.structuredDataType ?? "WebPage",
  };
}

export type SeoIssue = {
  code:
    | "missing-title"
    | "duplicate-title"
    | "missing-description"
    | "short-description"
    | "long-title"
    | "noindex"
    | "missing-canonical-base"
    | "invalid-canonical";
  severity: "error" | "warning" | "info";
  path: string;
};

const TITLE_MAX = 60;
const DESCRIPTION_MIN = 50;

/**
 * Deterministic checklist. Everything here is a fact about the document — nothing predicts ranking,
 * because a checklist that implies ranking is a promise the product cannot keep.
 */
export function auditMetadata(routes: ReadonlyArray<{ path: string; metadata: ResolvedMetadata }>): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const titles = new Map<string, string[]>();

  for (const route of routes) {
    const { metadata, path } = route;

    if (metadata.title.trim().length === 0) issues.push({ code: "missing-title", severity: "error", path });
    else {
      titles.set(metadata.title, [...(titles.get(metadata.title) ?? []), path]);
      if (metadata.title.length > TITLE_MAX) issues.push({ code: "long-title", severity: "warning", path });
    }

    if (metadata.description.trim().length === 0) {
      issues.push({ code: "missing-description", severity: "error", path });
    } else if (metadata.description.trim().length < DESCRIPTION_MIN) {
      issues.push({ code: "short-description", severity: "warning", path });
    }

    // Not an error: a staging page may be deliberately hidden. It is surfaced because doing it by
    // accident is the expensive mistake.
    if (!metadata.robots.index) issues.push({ code: "noindex", severity: "info", path });

    if (metadata.canonicalUrl === null) issues.push({ code: "missing-canonical-base", severity: "warning", path });
  }

  for (const [, paths] of titles) {
    if (paths.length > 1) {
      for (const path of paths) issues.push({ code: "duplicate-title", severity: "warning", path });
    }
  }

  return issues;
}

/** Only indexable routes belong in a sitemap; listing a noindex route contradicts its own directive. */
export function sitemapEntries(
  routes: ReadonlyArray<{ path: string; metadata: ResolvedMetadata; lastModified?: string }>,
): Array<{ url: string; lastModified?: string }> {
  return routes
    .filter((route) => route.metadata.robots.index && route.metadata.canonicalUrl !== null)
    .map((route) => ({
      url: route.metadata.canonicalUrl as string,
      ...(route.lastModified ? { lastModified: route.lastModified } : {}),
    }));
}

/**
 * Serialises a sitemap. Values are XML-escaped even though they come from validated URLs, because
 * escaping at the point of serialisation is what makes the guarantee local and checkable.
 */
export function renderSitemap(entries: ReadonlyArray<{ url: string; lastModified?: string }>): string {
  const urls = entries
    .map(
      (entry) =>
        `  <url><loc>${escapeXml(entry.url)}</loc>${
          entry.lastModified ? `<lastmod>${escapeXml(entry.lastModified)}</lastmod>` : ""
        }</url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function renderRobotsTxt(input: { allowIndexing: boolean; sitemapUrl: string | null }): string {
  const lines = ["User-agent: *", input.allowIndexing ? "Allow: /" : "Disallow: /"];
  if (input.sitemapUrl !== null) lines.push(`Sitemap: ${input.sitemapUrl}`);
  return `${lines.join("\n")}\n`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
