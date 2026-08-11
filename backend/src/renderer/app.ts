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
 * `script-src 'none'` is the important one and it costs nothing here: published pages are server
 * HTML and ship no JavaScript at all, so a policy that forbids it entirely is simply the truth
 * written down. If a script is ever added to public output, this line is what will refuse it until
 * someone argues for the change.
 *
 * `style-src` allows inline because every element carries a serialised `style` attribute and
 * container rules are emitted as a `<style>` block. Those are structured values written by the
 * renderer from validated data — there is no path by which a designer supplies CSS text — so the
 * injection `unsafe-inline` normally invites does not exist. The alternative, a per-request nonce,
 * would defeat caching for no gain against a threat that is already closed.
 *
 * Frames are limited to the two video providers whose embed URLs this code builds from an id.
 */
export const PUBLISHED_SITE_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self' https:",
  "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

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
