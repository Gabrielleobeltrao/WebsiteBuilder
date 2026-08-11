import type { BuilderProject, RouteManifestEntry, SiteSeoSettings } from "@websitebuilder/shared";
import { ProjectPageRenderer, RendererContext } from "@websitebuilder/frontend/renderer";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Server HTML for one published route.
 *
 * The body is produced by the same renderer the editor and preview use, so a designer's canvas and
 * a crawler's view cannot drift apart. Everything a crawler needs is present in this response
 * before any client JavaScript runs.
 */
/**
 * The analytics tracker, when the site has collection enabled.
 *
 * Configuration travels on the script tag's attributes rather than in an inline script, because the
 * policy this page is served under forbids inline scripts — and that is worth keeping.
 */
export type AnalyticsScript = {
  src: string;
  endpoint: string;
  versionId: string;
  consentRequired: boolean;
  honorPrivacySignals: boolean;
  sampleRate: number;
  categories: readonly string[];
};

export function renderRouteHtml(input: {
  route: RouteManifestEntry;
  document: BuilderProject;
  canonicalUrl: string;
  mediaBaseUrl: string;
  analytics?: AnalyticsScript;
}): string {
  const { route, document } = input;
  const page = document.pages.find((candidate) => candidate.id === route.resourceId) ?? null;

  const pathByPageId = new Map(
    document.pages.map((candidate) => [candidate.id, candidate.isHome ? "/" : `/${candidate.slug}`]),
  );

  const body =
    page === null
      ? ""
      : renderToStaticMarkup(
          createElement(
            RendererContext.Provider,
            {
              value: {
                resolvePagePath: (pageId: string) => pathByPageId.get(pageId) ?? null,
                resolveMediaUrl: (mediaId: string) => `${input.mediaBaseUrl}/${encodeURIComponent(mediaId)}`,
              },
            },
            createElement(ProjectPageRenderer, { page }),
          ),
        );

  return document_(
    {
      lang: document.seo.locale,
      head: headTags({
        route,
        site: document.seo,
        canonicalUrl: input.canonicalUrl,
        ...(input.analytics === undefined ? {} : { analytics: input.analytics }),
      }),
    },
    body,
  );
}

function headTags(input: {
  route: RouteManifestEntry;
  site: SiteSeoSettings;
  canonicalUrl: string;
  analytics?: AnalyticsScript;
}): string {
  const seo = input.route.seo as { title?: string; description?: string; robots?: { index: boolean; follow: boolean } };
  const title = seo.title ?? input.site.siteName;
  const description = seo.description ?? input.site.defaultDescription;

  // A 404 is never indexable regardless of what the manifest carries.
  const indexable = input.route.statusCode === 200 && seo.robots?.index !== false;
  const followable = seo.robots?.follow !== false;

  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta name="robots" content="${indexable ? "index" : "noindex"},${followable ? "follow" : "nofollow"}">`,
    `<link rel="canonical" href="${escapeHtml(input.canonicalUrl)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(input.canonicalUrl)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escapeHtml(input.site.siteName)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ];

  if (input.site.searchConsoleVerification !== undefined) {
    tags.push(`<meta name="google-site-verification" content="${escapeHtml(input.site.searchConsoleVerification)}">`);
  }

  const analytics = input.analytics;
  if (analytics !== undefined) {
    // `defer` so it cannot block anything a visitor came for. Last in head so it is also last in
    // the parser's queue. Every value is escaped: they are configuration, but they travel through
    // the same attribute syntax site content does, and the rule here is that nothing reaches the
    // page unescaped regardless of where it came from.
    tags.push(
      `<script defer src="${escapeHtml(analytics.src)}" data-endpoint="${escapeHtml(analytics.endpoint)}" ` +
        `data-version="${escapeHtml(analytics.versionId)}" data-consent="${analytics.consentRequired ? "1" : "0"}" ` +
        `data-signals="${analytics.honorPrivacySignals ? "1" : "0"}" data-sample="${escapeHtml(String(analytics.sampleRate))}" ` +
        `data-categories="${escapeHtml(analytics.categories.join(","))}"></script>`,
    );
  }

  return tags.join("\n    ");
}

function document_(input: { lang: string; head: string }, body: string): string {
  return `<!doctype html>
<html lang="${escapeHtml(input.lang)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${input.head}
  </head>
  <body>${body}</body>
</html>
`;
}

/**
 * Escapes text for an HTML attribute or text node.
 *
 * Site content reaches this function, so anything that could close a tag or an attribute is encoded
 * rather than filtered. The body markup does not pass through here — React escapes it.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
