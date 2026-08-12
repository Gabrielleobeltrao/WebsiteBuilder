import {
  consentCopyFor,
  PUBLISHED_BASE_CSS,
  renderablePage,
  resolveSafeLinkHref,
  runtimeCapabilitiesFor,
  walkElements,
  type BuilderProject,
  type RouteManifestEntry,
  type SiteSeoSettings,
} from "@websitebuilder/shared";
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
  /** Shown beside the consent prompt, when the site configured one. */
  privacyPolicyUrl?: string;
  endpoint: string;
  versionId: string;
  consentRequired: boolean;
  honorPrivacySignals: boolean;
  sampleRate: number;
  categories: readonly string[];
};

/**
 * The capabilities one page needs from the runtime.
 *
 * Exported because the policy header has to agree with the markup: a page that references the file
 * needs `script-src 'self'`, and a page that does not must keep `'none'`. Two independent answers
 * to that question is how a page ends up either blocked by its own policy or relaxed for nothing.
 */
export function pageRuntimeCapabilities(
  document: BuilderProject,
  page: BuilderProject["pages"][number] | null,
): string[] {
  if (page === null) return [];
  return runtimeCapabilitiesFor(
    renderablePage(document, page).sections.flatMap((section) => [...walkElements(section.elements)]),
  );
}

export function renderRouteHtml(input: {
  route: RouteManifestEntry;
  document: BuilderProject;
  canonicalUrl: string;
  mediaBaseUrl: string;
  analytics?: AnalyticsScript;
  /**
   * Where the interaction runtime is served.
   *
   * Given rather than decided here, but *whether* to reference it is decided here, from the blocks
   * the page actually contains — so every caller that renders a page gets the same answer. A page
   * with nothing to upgrade emits no script tag at all, which is most pages.
   */
  runtimeSrc?: string;
  /** The runtime file and what this page asked of it. Absent for a page that needs nothing. */
  runtime?: { src: string; capabilities: readonly string[] };
  /**
   * Rewrites internal page links, for a caller that serves this document from somewhere other than
   * the site's own root — the draft preview, which lives on an authenticated API path. Without it a
   * link inside a preview would leave the preview.
   */
  pageHref?: (path: string) => string;
}): string {
  const { route, document } = input;
  const found = document.pages.find((candidate) => candidate.id === route.resourceId) ?? null;
  // Shared references carry no content of their own. Rendering the page without resolving them is
  // how a site with a shared header published without its header while the builder showed one.
  const page = found === null ? null : renderablePage(document, found);

  const href = input.pageHref ?? ((path: string) => path);
  const pathByPageId = new Map(
    document.pages.map((candidate) => [candidate.id, href(candidate.isHome ? "/" : `/${candidate.slug}`)]),
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
                // Home, then this page. The site's own structure is one level deep today; when
                // sections of a site exist, this is the one place that changes.
                resolveTrail: () => {
                  const home = document.pages.find((candidate) => candidate.isHome);
                  const trail: Array<{ label: string; href: string | null }> = [];
                  if (home !== undefined && home.id !== page?.id) {
                    trail.push({ label: home.name, href: href("/") });
                  }
                  if (page !== null) trail.push({ label: page.name, href: null });
                  return trail;
                },
              },
            },
            createElement(ProjectPageRenderer, { page }),
          ),
        );

  // Rendered by the server rather than injected by the tracker: a banner built in JavaScript
  // arrives after the page and pushes it, and layout shift caused by a consent prompt would be the
  // product degrading a customer's page to ask a question on its own behalf. It ships hidden and the
  // tracker reveals it only when there is a decision to make, so a visitor who already answered — or
  // who has JavaScript disabled and is therefore not measured — never sees it.
  const consent =
    input.analytics?.consentRequired === true
      ? consentBanner(document.seo.locale, input.analytics.privacyPolicyUrl)
      : "";

  return document_(
    {
      lang: document.seo.locale,
      head: headTags({
        ...(input.runtimeSrc === undefined
          ? {}
          : { runtime: { src: input.runtimeSrc, capabilities: pageRuntimeCapabilities(document, page) } }),
        route,
        site: document.seo,
        canonicalUrl: input.canonicalUrl,
        ...(input.analytics === undefined ? {} : { analytics: input.analytics }),
      }),
    },
    `${body}${consent}`,
  );
}

/**
 * The consent prompt.
 *
 * Declining is exactly as easy as accepting — same element, same size, same place. A prompt where
 * one answer is a button and the other is a link is not offering a choice.
 */
function consentBanner(locale: string, privacyPolicyUrl: string | undefined): string {
  const copy = consentCopyFor(locale);
  const link =
    privacyPolicyUrl === undefined || privacyPolicyUrl === ""
      ? null
      : // Validated through the same utility every other link in a published page goes through, so a
        // policy URL cannot become the one place a `javascript:` href reaches a visitor.
        resolveSafeLinkHref({ kind: "external", url: privacyPolicyUrl, newTab: true }, { resolvePagePath: () => null });

  const button = (action: string, label: string) =>
    `<button type="button" data-wb-consent="${action}" style="${CONSENT_BUTTON_STYLE}">${escapeHtml(label)}</button>`;

  return (
    `<div id="wb-consent" hidden role="region" aria-label="${escapeHtml(copy.message)}" style="${CONSENT_STYLE}">` +
    `<p style="margin:0;flex:1 1 16rem">${escapeHtml(copy.message)}` +
    (link === null
      ? ""
      : ` <a href="${escapeHtml(link.href)}"${link.rel ? ` rel="${escapeHtml(link.rel)}"` : ""}` +
        `${link.target ? ` target="${escapeHtml(link.target)}"` : ""} style="color:inherit">${escapeHtml(copy.policy)}</a>`) +
    `</p>` +
    button("accept", copy.accept) +
    button("decline", copy.decline) +
    `</div>`
  );
}

/**
 * Fixed to the bottom of the viewport, so it overlays the page instead of moving it.
 *
 * Deliberately no `display`. An inline `display:flex` outranks the user-agent rule behind the
 * `hidden` attribute, so the prompt would be visible to everyone the moment it was rendered —
 * including a visitor who already declined and one with JavaScript disabled, who is not measured at
 * all. The tracker sets `display` when it reveals it, which is the only moment there is a question
 * to ask.
 */
const CONSENT_STYLE =
  "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;flex-wrap:wrap;gap:.75rem;" +
  "align-items:center;padding:1rem;background:#131720;color:#fff;font:400 14px/1.5 system-ui,sans-serif";

const CONSENT_BUTTON_STYLE =
  "font:inherit;font-weight:600;padding:.5rem 1rem;border:1px solid #fff;border-radius:.375rem;" +
  "background:transparent;color:inherit;cursor:pointer";

function headTags(input: {
  route: RouteManifestEntry;
  site: SiteSeoSettings;
  canonicalUrl: string;
  analytics?: AnalyticsScript;
  /** The runtime file and what this page asked of it. Absent for a page that needs nothing. */
  runtime?: { src: string; capabilities: readonly string[] };
}): string {
  const seo = input.route.seo as { title?: string; description?: string; robots?: { index: boolean; follow: boolean } };
  const title = seo.title ?? input.site.siteName;
  const description = seo.description ?? input.site.defaultDescription;

  // A 404 is never indexable regardless of what the manifest carries.
  const indexable = input.route.statusCode === 200 && seo.robots?.index !== false;
  const followable = seo.robots?.follow !== false;

  const tags = [
    // The defaults every page needs before its own rules: border-box sizing, no body margin, media
    // that cannot exceed its container, and long words that wrap instead of widening the page.
    // Nothing here hides overflow — a layout that is broken must look broken, or nobody fixes it.
    `<style>${PUBLISHED_BASE_CSS}</style>`,
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

  const runtime = input.runtime;
  if (runtime !== undefined && runtime.capabilities.length > 0) {
    // Deferred, like the tracker, and carrying what the page asked for as data rather than as a
    // generated snippet — the policy this page is served under forbids inline script, and that is
    // worth keeping for a file whose whole job is to touch the DOM.
    tags.push(
      `<script defer src="${escapeHtml(runtime.src)}" data-capabilities="${escapeHtml(runtime.capabilities.join(","))}"></script>`,
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
