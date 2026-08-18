import { Router } from "express";

import type { MediaRepository } from "../modules/media/repository";
import type { SiteResolver } from "./resolver";
import { hostnameOf } from "./app";

/**
 * Images for a published page, on the site's own hostname.
 *
 * Published pages were emitting `<PLATFORM_PUBLIC_ORIGIN>/api/v1/public/media/<id>`, and no router
 * was ever mounted at that path — so every image on every published site answered 404 while the
 * builder, which resolves media through the authenticated workspace route, showed them all. The
 * render tests passed a base URL as a fixture string and never asked whether it led anywhere.
 *
 * The path mirrors the workspace media API's, `/:mediaId/content`, so one URL shape serves the
 * builder, the draft preview and the published page.
 *
 * Two properties make this safe to expose without a session:
 *
 * The tenant comes from the hostname, exactly as the page around it does. There is no workspace or
 * project in the path, so no caller can name one.
 *
 * The id must appear in the active version's `referencedMediaIds`. A published page can serve only
 * the bytes it actually shows: an asset sitting in a customer's library, or one that a later version
 * stopped using, is not reachable by guessing an id — and ObjectIds carry a timestamp and a counter,
 * so guessing is not as far-fetched as it looks.
 */
export const MEDIA_PATH = "/__wb/media";

export function createPublicMediaRouter(options: {
  resolver: SiteResolver;
  media: MediaRepository;
}): Router {
  const { resolver, media } = options;
  const router = Router();

  router.get("/:mediaId/content", async (req, res, next) => {
    try {
      const site = await resolver.resolve(hostnameOf(req));
      if (site === null) {
        res.status(404).type("text/plain").send("Not found");
        return;
      }

      const mediaId = String(req.params.mediaId);
      if (!site.version.referencedMediaIds.includes(mediaId)) {
        // Deliberately the same answer as an unknown host: what is not on this site's pages does
        // not exist as far as this endpoint is concerned, and saying which of the two it was would
        // turn the endpoint into a way to ask whether an id belongs to somebody.
        res.status(404).type("text/plain").send("Not found");
        return;
      }

      const width = Number.parseInt(String(req.query.w ?? ""), 10);
      const resolved = await media.openVariant(
        { workspaceId: site.version.workspaceId, userId: "" },
        mediaId,
        Number.isFinite(width) ? width : undefined,
      );
      if (resolved === null) {
        res.status(404).type("text/plain").send("Not found");
        return;
      }

      res
        .status(200)
        .set("content-type", resolved.variant.mimeType)
        .set("content-length", String(resolved.variant.bytes))
        // Public rather than private, and immutable: these bytes are on a page anyone can open, and
        // a variant never changes — a new upload is a new id.
        .set("cache-control", "public, max-age=31536000, immutable")
        // The bytes are an image and must never be interpreted as anything else.
        .set("x-content-type-options", "nosniff")
        .set("content-disposition", "inline");

      resolved.stream.on("error", next).pipe(res);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
