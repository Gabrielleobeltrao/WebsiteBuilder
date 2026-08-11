import express, { type Express, type Request } from "express";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";

import type { Env } from "../config/env";
import { isLikelyBot } from "../modules/analytics/repository";
import { renderRouteHtml } from "./html";
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
const publishedSiteCsp = (scriptDirectives: string[]) =>
  [
    "default-src 'none'",
    ...scriptDirectives,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "font-src 'self' https:",
    "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");

export const PUBLISHED_SITE_CSP = publishedSiteCsp(["script-src 'none'"]);

/**
 * The policy for a page that carries the analytics tracker.
 *
 * Two constants rather than one changed constant, because analytics is disabled by default: a site
 * that has not enabled it receives the policy above, byte for byte, and shipping this feature
 * changes nothing for a customer who does not use it.
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
export const PUBLISHED_SITE_CSP_WITH_ANALYTICS = publishedSiteCsp(["script-src 'self'", "connect-src 'self'"]);

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
}): Express {
  const { env, logger, resolver, recordView } = options;

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
    res.status(200).json({ data: { status: "ok", uptimeSeconds: Math.floor(process.uptime()) } });
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

      const html = renderRouteHtml({
        route,
        document: site.document,
        canonicalUrl: `https://${site.domain.hostname}${normalizePath(req.path)}`,
        // Same origin as the application: the API has no public hostname of its own, and a
        // published page must not reference one that does not exist.
        mediaBaseUrl: `${env.PLATFORM_PUBLIC_ORIGIN}/api/v1/public/media`,
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
        .set("content-security-policy", PUBLISHED_SITE_CSP)
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
