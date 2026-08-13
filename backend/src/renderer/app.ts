import express, { type Express, type Request, type Router } from "express";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";

import type { Env } from "../config/env";
import { isLikelyBot } from "../modules/analytics/repository";
import { ANALYTICS_EVENTS_PATH, type AnalyticsRuntime } from "./analytics";
import { readFormResult } from "@websitebuilder/frontend/renderer";

import { formSubmissionPath } from "./forms";
import { pageRuntimeCapabilities, renderRouteHtml, type AnalyticsScript } from "./html";
import { RUNTIME_SOURCE, RUNTIME_VERSION } from "./runtime.generated";
import { normalizePath, resolveRoute, SiteResolver } from "./resolver";

/**
 * The policy a published page is served under.
 *
 * The directives every published page shares, whatever else it carries. A page's script policy is
 * appended by whichever constant below applies, because the two cases differ in exactly that.
 *
 * Until analytics existed this list carried `script-src 'none'` unconditionally, and the comment
 * here said that a script added to public output would be refused "until someone argues for the
 * change". The argument is `docs/adr/analytics-first-party.md`, and the outcome is narrower than
 * the request: the relaxation applies only to a page that actually carries the tracker. A site with
 * analytics disabled — which is every existing site — still ships no JavaScript and still says so.
 *
 * `style-src` allows inline because every element carries a serialised `style` attribute and
 * container rules are emitted as a `<style>` block. Those are structured values written by the
 * renderer from validated data — there is no path by which a designer supplies CSS text — so the
 * injection `unsafe-inline` normally invites does not exist. The alternative, a per-request nonce,
 * would defeat caching for no gain against a threat that is already closed.
 *
 * Frames are limited to the two video providers whose embed URLs this code builds from an id.
 */
const publishedSiteCsp = (scriptDirectives: string[], frameAncestors = "'none'") =>
  [
    "default-src 'none'",
    ...scriptDirectives,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "font-src 'self' https:",
    "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
    "form-action 'self'",
    "base-uri 'none'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");

export const PUBLISHED_SITE_CSP = publishedSiteCsp(["script-src 'none'"]);

/** Where the interaction runtime is served. One URL for the whole platform. */
export const RUNTIME_SCRIPT_PATH = "/__wb/r.js";

/**
 * The policy for a page that carries a script of the platform's own.
 *
 * Two constants rather than one changed constant, because most pages carry neither: a static page
 * receives the policy above, byte for byte, and shipping either feature changes nothing for a
 * customer whose pages do not use them.
 *
 * Two files can be admitted by it — the analytics tracker and the interaction runtime, the second
 * of which now posts a form the visitor filled in. Both are served by this renderer on the site's
 * own hostname, which is why `'self'` is enough and why no origin is ever added to this list.
 *
 * `script-src 'self'` admits exactly one file — the tracker, served by this renderer on the site's
 * own hostname, including custom domains. No external origin and no `'unsafe-inline'`: an inline
 * allowance would readmit the injection class that `default-src 'none'` exists to close, and it is
 * not needed, because the tracker is a file rather than a snippet.
 *
 * `connect-src 'self'` is required and is easy to forget: `default-src 'none'` blocks fetch and
 * sendBeacon regardless of what `script-src` permits, so without this line the tracker would load
 * and then silently fail to deliver anything.
 *
 * `frame-ancestors 'none'` is unchanged. Heatmaps render their snapshot inside the dashboard using
 * the same component that produced the page, so nothing here needs to be framable.
 */
export const PUBLISHED_SITE_CSP_WITH_SCRIPT = publishedSiteCsp(["script-src 'self'", "connect-src 'self'"]);

/**
 * The policy for an authenticated draft preview.
 *
 * The same page under the same restrictions, with two differences: the builder frames it on its own
 * origin, so `'self'` replaces `'none'` for frame ancestors; and the interaction runtime is served
 * from that same origin, so `script-src 'self'` admits exactly that one file. No inline allowance,
 * no analytics, and nothing that would let a document supply a script of its own.
 */
export const DRAFT_PREVIEW_CSP = publishedSiteCsp(["script-src 'self'"], "'self'");

/**
 * The public multi-tenant renderer. One stateless process serves every published site: it resolves
 * the request hostname to an active domain record, never a client-supplied project ID, and answers
 * an unrecognised host with a neutral response that reveals no tenant.
 */
/**
 * Counts one page view. Supplied by the process rather than built here, so the renderer keeps no
 * database dependency of its own and a test can observe what would have been counted.
 */
export type ViewRecorder = (view: { workspaceId: string; projectId: string; path: string }) => void;

export function createRendererApp(options: {
  env: Env;
  logger: Logger;
  resolver?: SiteResolver;
  recordView?: ViewRecorder;
  /** Analytics endpoints and the settings reader that decides whether a page carries the tracker. */
  analytics?: AnalyticsRuntime;
  /**
   * The public form submission endpoint.
   *
   * Injected rather than built here so this module keeps no database dependency of its own, and so
   * a test can serve pages without accepting writes.
   */
  forms?: Router;
}): Express {
  const { env, logger, resolver, recordView, analytics, forms } = options;

  const app = express();
  app.disable("x-powered-by");

  // Forwarded headers are trusted only from the configured proxy range. With no range configured
  // nothing is trusted, because an attacker who can set X-Forwarded-Host on an untrusted hop can
  // otherwise ask for any tenant's site.
  app.set("trust proxy", env.trustedProxyCidrs.length > 0 ? env.trustedProxyCidrs : false);

  app.use(
    pinoHttp({
      logger,
      autoLogging: !env.isTest,
      // Logs identify the site by hostname only. A published document may contain personal data and
      // has no business in an operational log.
      customProps: (req) => ({ host: hostnameOf(req as Request) }),
      serializers: { req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }) },
    }),
  );

  // Health must not require a site hostname and must not expose tenant data.
  app.get("/healthz", (_req, res) => {
    res.status(200).json({
      data: {
        status: "ok",
        uptimeSeconds: Math.floor(process.uptime()),
        // Counts only: how many batches ended each way since this process started. Enough to see
        // that ingestion is failing and why, and not enough to see what any visitor did.
        ...(analytics === undefined ? {} : { analytics: analytics.stats() }),
      },
    });
  });

  // Before the page catch-all, and before the unknown-host guard: these paths belong to the
  // platform, not to any tenant's route table, so a site cannot shadow them by publishing a page at
  // the same address.
  if (analytics !== undefined) app.use(analytics.router);
  if (forms !== undefined) app.use(forms);

  /**
   * The interaction runtime.
   *
   * One URL for every site, cached forever under its content hash. Serving it unconditionally costs
   * nothing: a page that needs no capability never references it, and one that does gets a file the
   * visitor's browser has probably already cached from another site on the platform.
   */
  app.get(RUNTIME_SCRIPT_PATH, (_request, response) => {
    response
      .status(200)
      .type("application/javascript; charset=utf-8")
      .set("cache-control", "public, max-age=31536000, immutable")
      .set("x-content-type-options", "nosniff")
      .send(RUNTIME_SOURCE);
  });

  if (resolver === undefined) {
    app.use((_req, res) => {
      res.status(503).type("text/plain").send("This site is not available.");
    });
    return app;
  }

  app.get("/{*splat}", async (req, res, next) => {
    try {
      const hostname = hostnameOf(req);
      const site = await resolver.resolve(hostname);

      // Unknown, pending and never-published hosts get one identical answer, so the response cannot
      // be used to discover which hostnames exist.
      if (site === null) {
        res.status(404).type("text/plain").send("This site is not available.");
        return;
      }

      const canonicalHost = await resolver.canonicalHostFor(site);
      if (canonicalHost !== null) {
        res.redirect(301, `https://${canonicalHost}${req.originalUrl}`);
        return;
      }

      const outcome = resolveRoute(site.version, req.path);

      if (outcome.kind === "redirect") {
        res.redirect(outcome.statusCode, outcome.location);
        return;
      }

      const route = outcome.route;
      if (route === null) {
        res.status(404).type("text/plain").send("Page not found.");
        return;
      }

      // A site that has not enabled collection carries no script and is served the policy that
      // forbids one. Both halves are read from the same place, so a page can never carry a tracker
      // whose events the endpoint would refuse.
      const settings = analytics === undefined ? null : await analytics.loadSettings(site.version.projectId);
      const tracker: AnalyticsScript | undefined =
        analytics === undefined || settings === null || !settings.enabled
          ? undefined
          : {
              src: `${analytics.scriptPath}?v=${analytics.scriptVersion}`,
              endpoint: ANALYTICS_EVENTS_PATH,
              versionId: site.version.id,
              consentRequired: settings.consentRequired,
              ...(settings.privacyPolicyUrl === "" ? {} : { privacyPolicyUrl: settings.privacyPolicyUrl }),
              honorPrivacySignals: settings.honorPrivacySignals,
              sampleRate: settings.sampleRate,
              categories: settings.categories,
            };

      // Only for a page that contains a block needing it. A static page loads no script at all,
      // which is what keeps the published output the thing this product promises.
      const capabilities = pageRuntimeCapabilities(
        site.document,
        site.document.pages.find((page) => page.id === route.resourceId) ?? null,
      );

      /*
       * The forms this version froze, and where they post.
       *
       * A page whose blocks reference none of them passes an empty map, which the renderer turns
       * into "the form this block pointed at no longer exists" — the honest answer for a page
       * published before its form was carried.
       */
      const publishedForms = {
        byId: new Map((site.version.forms ?? []).map((form) => [form.id, form])),
        mode: "live" as const,
        action: formSubmissionPath,
        result: readFormResult(String(req.originalUrl.split("?")[1] ?? "")),
      };

      const html = renderRouteHtml({
        route,
        document: site.document,
        forms: publishedForms,
        // The two blog routes render from what this version froze, not from the live blog.
        ...(site.version.blog === undefined ? {} : { blog: site.version.blog }),
        runtimeSrc: `${RUNTIME_SCRIPT_PATH}?v=${RUNTIME_VERSION}`,
        canonicalUrl: `https://${site.domain.hostname}${normalizePath(req.path)}`,
        // Same origin as the application: the API has no public hostname of its own, and a
        // published page must not reference one that does not exist.
        mediaBaseUrl: `${env.PLATFORM_PUBLIC_ORIGIN}/api/v1/public/media`,
        ...(tracker === undefined ? {} : { analytics: tracker }),
      });

      // Counted after the page is known to be a real one, and from the manifest's path rather than
      // the request's: `/about?utm=x`, `/about/` and `/About` are all one page, and a path nobody
      // published is not counted at all. A 404 is not a view.
      if (outcome.kind === "route" && recordView !== undefined && !isLikelyBot(req.get("user-agent"))) {
        recordView({ workspaceId: site.version.workspaceId, projectId: site.version.projectId, path: route.path });
      }

      res
        .status(outcome.kind === "route" ? 200 : 404)
        .type("text/html; charset=utf-8")
        .set("cache-control", `public, max-age=0, s-maxage=${env.PUBLIC_SITE_CACHE_TTL_SECONDS}`)
        // `script-src 'self'` covers both the tracker and the interaction runtime: one origin, two
        // files, no inline allowance. A page with neither keeps `script-src 'none'` byte for byte.
        .set(
          "content-security-policy",
          tracker === undefined && capabilities.length === 0 ? PUBLISHED_SITE_CSP : PUBLISHED_SITE_CSP_WITH_SCRIPT,
        )
        .set("x-content-type-options", "nosniff")
        .set("referrer-policy", "strict-origin-when-cross-origin")
        .set("permissions-policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()")
        .send(html);
    } catch (error) {
      next(error);
    }
  });

  app.use((_req, res) => {
    res.status(404).type("text/plain").send("Page not found.");
  });

  return app;
}

/**
 * The hostname the request is for.
 *
 * `req.hostname` already honours the trust-proxy setting above, so a forwarded host is used only
 * where the platform's own proxy set it. The Host header is the fallback, and no query parameter or
 * custom header is ever consulted.
 */
function hostnameOf(req: Request): string {
  return (req.hostname || req.headers.host || "").split(":")[0]?.toLowerCase() ?? "";
}
