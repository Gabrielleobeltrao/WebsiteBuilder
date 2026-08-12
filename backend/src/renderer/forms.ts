import {
  FORM_CONTROL_FIELDS,
  FORM_RESULT_PARAMS,
  FORM_SUBMISSION_MAX_BYTES,
  type PublishedForm,
} from "@websitebuilder/shared";
import express, { Router, type Request } from "express";
import type { Logger } from "pino";

import { isLikelyBot } from "../modules/analytics/repository";
import type { FormRepository, SubmissionSource } from "../modules/forms/repository";
import { FixedWindowCounter } from "./rate-limit";
import { normalizePath, resolveRoute, type SiteResolver } from "./resolver";

/**
 * Form submissions, on the published site's own origin.
 *
 * The second endpoint in the product that accepts a write from an unauthenticated stranger, and it
 * is arranged the same way as the first: nothing a caller says can change where the data goes.
 *
 * - Workspace, project and page come from the hostname the request arrived on and the published
 *   route manifest. They do not appear in the payload at all.
 * - The form comes from the snapshot the site is currently serving, so a definition edited since
 *   publication cannot change what a visitor in the middle of filling one in is validated against.
 * - Responses are a redirect back to the page, with a marker in the query and nothing else. A
 *   distinguishable rejection is a probe result.
 * - Nothing about a visitor is logged: not the body, not a field name, not an address.
 *
 * Cross-origin senders are excluded by construction. `form-action 'self'` in the published policy
 * stops a page from posting elsewhere, and this endpoint accepts only the two content types a
 * same-origin form produces. There is no CORS middleware on the renderer. Do not add one.
 */
export const FORM_SUBMISSION_PATH = "/__wb/forms/:formId/submissions";

export function formSubmissionPath(formId: string): string {
  return `/__wb/forms/${encodeURIComponent(formId)}/submissions`;
}

export type FormIngestionLimits = {
  /** Submissions per window from one address. */
  perAddress: number;
  /** Submissions per window for one project, so one busy site cannot exhaust the process. */
  perProject: number;
  windowMs: number;
};

/**
 * Deliberately small numbers.
 *
 * A person fills in a form in tens of seconds and sends it once. Anything sending more than this is
 * not a customer of the site it is posting to, and the cost of being slightly wrong is a visitor
 * being asked to try again in a minute.
 */
export const DEFAULT_FORM_LIMITS: FormIngestionLimits = { perAddress: 5, perProject: 60, windowMs: 60_000 };

export type FormIngestionDeps = {
  resolver: SiteResolver;
  forms: FormRepository;
  logger: Logger;
  limits?: FormIngestionLimits;
  /** Whether forwarded addresses can be trusted; when they cannot, address limiting is skipped. */
  trustsProxy: boolean;
  now?: () => Date;
  /** Called after a submission is stored. Failures never fail the submission. */
  onAccepted?: (input: { workspaceId: string; projectId: string; formId: string }) => Promise<void>;
};

/** How one submission ended. The only thing recorded about it. */
type Outcome =
  | "accepted"
  | "rejectedMalformed"
  | "rejectedOversize"
  | "rejectedRateLimited"
  | "rejectedUnknownHost"
  | "rejectedUnknownForm"
  | "ignoredBot"
  | "ignoredHoneypot"
  | "invalid"
  | "failed";

export function createFormSubmissionRouter(
  deps: FormIngestionDeps,
  record: (outcome: Outcome) => void = () => undefined,
): Router {
  const limits = deps.limits ?? DEFAULT_FORM_LIMITS;
  const now = deps.now ?? (() => new Date());
  const counter = new FixedWindowCounter(limits.windowMs, now().getTime());

  const router = Router();

  router.post(
    FORM_SUBMISSION_PATH,
    /*
     * Both shapes a same-origin form can produce, and nothing else.
     *
     * A plain HTML form posts `application/x-www-form-urlencoded`; the runtime posts JSON. Both are
     * mounted on this route rather than on the app, because a body parser in front of every
     * published page would be work done for every visitor of every tenant to serve one endpoint.
     */
    express.urlencoded({ extended: false, limit: FORM_SUBMISSION_MAX_BYTES }),
    express.json({ limit: FORM_SUBMISSION_MAX_BYTES, type: "application/json" }),
    async (request, response) => {
      const wantsJson = request.is("application/json") !== false;

      /**
       * The one answer shape.
       *
       * A browser without JavaScript is sent back to the page it came from with a marker in the
       * query, which the renderer turns into the form's own success or error message. The runtime
       * asks for JSON and gets a status only.
       */
      const done = (outcome: Outcome, state: "ok" | "error", back: string) => {
        record(outcome);
        if (wantsJson) {
          response.status(state === "ok" ? 200 : 422).json({ state });
          return;
        }
        response.redirect(303, back);
      };

      let fallbackBack = "/";

      try {
        const site = await deps.resolver.resolve(hostnameOf(request));
        if (site === null) {
          // The same answer the page catch-all gives an unknown host, so this endpoint cannot be
          // used to discover which hostnames exist.
          record("rejectedUnknownHost");
          response.status(404).type("text/plain").send("Not Found");
          return;
        }

        const { workspaceId, projectId } = site.version;
        const body = (request.body ?? {}) as Record<string, unknown>;
        const formId = String((request.params as { formId?: string }).formId ?? "");

        // Where the visitor was. Believed only as far as the published route manifest confirms it,
        // and used for nothing but attribution and the address they are sent back to.
        const claimedPath = typeof body[FORM_CONTROL_FIELDS.path] === "string" ? (body[FORM_CONTROL_FIELDS.path] as string) : "/";
        const outcome = resolveRoute(site.version, normalizePath(claimedPath));
        const route = outcome.kind === "route" && outcome.route.statusCode === 200 ? outcome.route : null;
        fallbackBack = route?.path ?? "/";

        const back = (state: "ok" | "error") =>
          `${fallbackBack}?${state === "ok" ? FORM_RESULT_PARAMS.ok : FORM_RESULT_PARAMS.error}=${encodeURIComponent(formId)}`;

        if (deps.trustsProxy && !counter.take(`ip:${request.ip ?? ""}`, limits.perAddress, now().getTime())) {
          record("rejectedRateLimited");
          response.status(429).type("text/plain").send("Too Many Requests");
          return;
        }
        if (!counter.take(`project:${projectId}`, limits.perProject, now().getTime())) {
          record("rejectedRateLimited");
          response.status(429).type("text/plain").send("Too Many Requests");
          return;
        }

        /*
         * The form as this version published it.
         *
         * Never the live definition: a visitor is answering the questions they were shown, and a
         * definition edited since publication would validate their answer against questions that
         * were never on the page.
         */
        const form = (site.version.forms ?? []).find((candidate) => candidate.id === formId) ?? null;
        if (form === null || form.status !== "ready") {
          record("rejectedUnknownForm");
          response.status(404).type("text/plain").send("Not Found");
          return;
        }

        // A person is told it worked. Anything filling every input it finds, or announcing itself as
        // a crawler, is told the same thing and nothing is stored.
        if (typeof body[FORM_CONTROL_FIELDS.honeypot] === "string" && body[FORM_CONTROL_FIELDS.honeypot] !== "") {
          done("ignoredHoneypot", "ok", back("ok"));
          return;
        }
        if (isLikelyBot(request.get("user-agent"))) {
          done("ignoredBot", "ok", back("ok"));
          return;
        }

        const result = await deps.forms.submit({
          projectId,
          formId,
          values: valuesFrom(body, form),
          against: { revision: form.revision, fields: form.fields },
          source: sourceFrom(request, site.domain.hostname, route?.resourceId, route?.path),
          now: now(),
        });

        if (!result.accepted) {
          done("invalid", "error", back("error"));
          return;
        }

        // Notification delivery is somebody else's problem and never this request's: a submission
        // that is stored and not emailed is a submission; one that is emailed and not stored is lost.
        if (deps.onAccepted !== undefined) {
          await deps.onAccepted({ workspaceId, projectId, formId }).catch(() => undefined);
        }

        done("accepted", "ok", back("ok"));
      } catch (error) {
        record("failed");
        // The host is the most that may be logged. Not the body, not a field name, not an address.
        deps.logger.warn({ err: error, host: hostnameOf(request) }, "a form submission could not be stored");
        response.status(500).type("text/plain").send("Internal Server Error");
      }
    },
  );

  return router;
}

/**
 * The values the form asked for, and nothing else.
 *
 * Keyed by the snapshot's own field list rather than by whatever arrived, so a payload carrying a
 * hundred extra keys stores none of them. `validateSubmission` would ignore them anyway; dropping
 * them here means they never reach it.
 */
function valuesFrom(body: Record<string, unknown>, form: PublishedForm): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of form.fields) {
    if (field.id in body) values[field.id] = body[field.id];
  }
  return values;
}

/**
 * Where the submission came from, worked out here rather than read from the body.
 *
 * Campaign parameters come from the referring page's own query string, which the browser sends and
 * the visitor did not compose for this request. The address and the user agent are deliberately
 * absent: they are not needed to make sense of an answer, and storing them is a liability nobody
 * asked for.
 */
const CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

function sourceFrom(request: Request, host: string, pageId?: string, path?: string): SubmissionSource {
  const utm: Record<string, string> = {};
  const referer = request.get("referer");

  if (referer !== undefined) {
    try {
      const url = new URL(referer);
      if (url.hostname.toLowerCase() === host.toLowerCase()) {
        for (const key of CAMPAIGN_KEYS) {
          const value = url.searchParams.get(key);
          if (value !== null && value !== "") utm[key] = value.slice(0, 120);
        }
      }
    } catch {
      // A referrer that is not a URL tells us nothing, and is not worth an error.
    }
  }

  return {
    ...(pageId === undefined ? {} : { pageId }),
    ...(path === undefined ? {} : { path }),
    host,
    ...(Object.keys(utm).length === 0 ? {} : { utm }),
  };
}

/** The hostname the request is for, honouring the app's trust-proxy setting and nothing else. */
function hostnameOf(request: Request): string {
  return (request.hostname || request.headers.host || "").split(":")[0]?.toLowerCase() ?? "";
}
