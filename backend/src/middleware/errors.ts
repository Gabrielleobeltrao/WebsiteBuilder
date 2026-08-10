import { HTTP_STATUS_BY_ERROR_CODE, type ApiErrorCode, type ApiErrorDetail } from "@websitebuilder/shared";
import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "pino";
import { ZodError } from "zod";

/**
 * The only error shape the API returns. An unexpected exception becomes a generic INTERNAL_ERROR:
 * the details go to the log, never to the browser.
 */
export class ApiProblem extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = "ApiProblem";
  }

  get status(): number {
    return HTTP_STATUS_BY_ERROR_CODE[this.code];
  }
}

export const notFound: ApiProblem = new ApiProblem("NOT_FOUND", "Resource not found");

export function zodProblem(error: ZodError): ApiProblem {
  return new ApiProblem(
    "VALIDATION_ERROR",
    "Request failed validation",
    error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  );
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  // Express identifies an error handler by its four-parameter signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (error, _req, res, _next) => {
    if (res.headersSent) return;

    const problem =
      error instanceof ApiProblem
        ? error
        : error instanceof ZodError
          ? zodProblem(error)
          : isPayloadTooLarge(error)
            ? new ApiProblem("PAYLOAD_TOO_LARGE", "Request body is too large")
            : isMalformedJson(error)
              ? new ApiProblem("VALIDATION_ERROR", "Request body is not valid JSON")
              : null;

    if (problem === null) {
      logger.error({ err: error }, "unhandled request error");
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
      return;
    }

    if (problem.status >= 500) logger.error({ err: error }, problem.message);
    res.status(problem.status).json({
      error: { code: problem.code, message: problem.message, ...(problem.details ? { details: problem.details } : {}) },
    });
  };
}

function isPayloadTooLarge(error: unknown): boolean {
  return typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large";
}

function isMalformedJson(error: unknown): boolean {
  return typeof error === "object" && error !== null && "type" in error && error.type === "entity.parse.failed";
}
