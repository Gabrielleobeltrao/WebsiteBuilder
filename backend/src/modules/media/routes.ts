import { Router, raw } from "express";

import { ApiProblem } from "../../middleware/errors";
import { MAX_UPLOAD_BYTES, UnsupportedImageError } from "./imageProcessor";
import type { MediaRepository } from "./repository";
import type { WorkspaceResolver } from "../projects/routes";

/**
 * Media endpoints.
 *
 * Uploads arrive as a raw body rather than multipart. The frontend controls both ends, one file is
 * sent at a time, and skipping multipart removes an entire class of parser bugs and temporary-file
 * handling from a path that accepts untrusted bytes. The declared content type still decides
 * nothing — the pipeline sniffs the actual bytes.
 */
export function createMediaRouter(options: {
  repository: MediaRepository;
  resolveWorkspace: WorkspaceResolver;
}): Router {
  const { repository, resolveWorkspace } = options;
  const router = Router({ mergeParams: true });

  /**
   * The site whose library this is.
   *
   * The router is mounted under a project, so this is always present in practice; it is read rather
   * than required so the same router keeps working if it is ever mounted without one. It only ever
   * narrows a query the workspace has already confined.
   */
  const projectOf = (req: Parameters<WorkspaceResolver>[0]): string | undefined => {
    const value = (req.params as Record<string, string | undefined>).projectId;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  router.get("/", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      res.json({ data: await repository.list(context, projectOf(req)) });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/",
    raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (req, res, next) => {
      try {
        const context = await resolveWorkspace(req, "media:upload");
        const data = req.body as Buffer;

        if (!Buffer.isBuffer(data) || data.length === 0) {
          throw new ApiProblem("VALIDATION_ERROR", "Request body must contain the image bytes");
        }

        const header = req.get("x-filename");
        const filename = typeof header === "string" && header.length > 0 ? header : "image";
        const alt = req.get("x-default-alt");

        const asset = await repository.upload(context, {
          data,
          filename,
          ...(alt ? { defaultAlt: alt.slice(0, 500) } : {}),
          ...(projectOf(req) === undefined ? {} : { projectId: projectOf(req)! }),
        });
        res.status(201).json({ data: asset });
      } catch (error) {
        next(mapMediaError(error));
      }
    },
  );

  router.get("/:mediaId/content", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const width = Number.parseInt(String(req.query.w ?? ""), 10);

      const resolved = await repository.openVariant(
        context,
        String(req.params.mediaId),
        Number.isFinite(width) ? width : undefined,
      );
      if (resolved === null) throw new ApiProblem("NOT_FOUND", "Media not found");

      res.setHeader("content-type", resolved.variant.mimeType);
      res.setHeader("content-length", String(resolved.variant.bytes));
      // Immutable: a variant's bytes never change, and a new upload gets a new id.
      res.setHeader("cache-control", "private, max-age=31536000, immutable");
      // The bytes are an image and must never be interpreted as anything else.
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("content-disposition", "inline");

      resolved.stream.on("error", next).pipe(res);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:mediaId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "media:delete");
      const deleted = await repository.delete(context, String(req.params.mediaId));
      if (!deleted) throw new ApiProblem("NOT_FOUND", "Media not found");
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function mapMediaError(error: unknown): unknown {
  if (error instanceof UnsupportedImageError) {
    return error.reason === "too-large" || error.reason === "dimensions"
      ? new ApiProblem("PAYLOAD_TOO_LARGE", "This image is too large to process")
      : new ApiProblem("UNSUPPORTED_MEDIA_TYPE", "This file is not a supported image");
  }
  return error;
}
