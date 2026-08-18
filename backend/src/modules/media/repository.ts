import { ObjectId, type Collection, type Db } from "mongodb";

import { COLLECTIONS } from "../../db/indexes";
import type { WorkspaceContext } from "../projects/repository";
import { processImage, UnsupportedImageError } from "./imageProcessor";
import type { MediaStorage } from "./storage";

export type MediaVariant = {
  width: number;
  height: number;
  bytes: number;
  mimeType: "image/webp";
  storageKey: string;
};

export type MediaAsset = {
  id: string;
  workspaceId: string;
  /**
   * The site this image belongs to.
   *
   * Absent on everything uploaded before the library moved inside a site, and absent means shared:
   * those images are already on pages across the workspace, and scoping them to one site
   * retroactively would take them out of the library of every site actually using them.
   */
  projectId?: string;
  uploadedByUserId: string;
  originalFilename: string;
  contentHash: string;
  width: number;
  height: number;
  defaultAlt?: string;
  variants: MediaVariant[];
  createdAt: string;
};

type MediaDocument = Omit<MediaAsset, "id"> & { _id: ObjectId };

/** Filenames reach logs, headers and the UI; only a safe subset survives. */
export function sanitizeFilename(input: string): string {
  const base = input.split(/[/\\]/).pop() ?? "image";
  const cleaned = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : "image";
}

export class MediaRepository {
  private readonly collection: Collection<MediaDocument>;

  constructor(
    db: Db,
    private readonly storage: MediaStorage,
  ) {
    this.collection = db.collection<MediaDocument>(COLLECTIONS.media);
  }

  /**
   * One site's library: what it uploaded, plus everything from before sites owned their images.
   *
   * Workspace first and always, so a project id from a URL can only ever narrow a set already
   * confined to the caller's tenant — it can never widen it.
   */
  async list(context: WorkspaceContext, projectId: string | undefined, limit = 200): Promise<MediaAsset[]> {
    const documents = await this.collection
      .find(
        {
          workspaceId: context.workspaceId,
          ...(projectId === undefined ? {} : { $or: [{ projectId }, { projectId: { $exists: false } }] }),
        },
        { sort: { createdAt: -1 }, limit },
      )
      .toArray();
    return documents.map(toAsset);
  }

  async findById(context: WorkspaceContext, mediaId: string): Promise<MediaAsset | null> {
    if (!ObjectId.isValid(mediaId) || mediaId.length !== 24) return null;
    const document = await this.collection.findOne({
      _id: new ObjectId(mediaId),
      workspaceId: context.workspaceId,
    });
    return document === null ? null : toAsset(document);
  }

  /**
   * Processes and stores an upload.
   *
   * Variants are written first and the metadata document last, so no database record can ever
   * reference bytes that are not there. If any variant fails, the ones already written are removed
   * before the error propagates — a partial upload leaves nothing behind to leak or to confuse the
   * media library.
   */
  async upload(
    context: WorkspaceContext,
    input: { data: Buffer; filename: string; defaultAlt?: string; projectId?: string },
  ): Promise<MediaAsset> {
    const processed = await processImage(input.data);

    const written: string[] = [];
    try {
      const variants: MediaVariant[] = [];
      for (const variant of processed.variants) {
        const stored = await this.storage.put({ data: variant.data, contentType: "image/webp" });
        written.push(stored.storageKey);
        variants.push({
          width: variant.width,
          height: variant.height,
          bytes: variant.bytes,
          mimeType: "image/webp",
          storageKey: stored.storageKey,
        });
      }

      const document: Omit<MediaDocument, "_id"> = {
        workspaceId: context.workspaceId,
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        uploadedByUserId: context.userId,
        originalFilename: sanitizeFilename(input.filename),
        contentHash: processed.contentHash,
        width: processed.originalWidth,
        height: processed.originalHeight,
        ...(input.defaultAlt ? { defaultAlt: input.defaultAlt } : {}),
        variants,
        createdAt: new Date().toISOString(),
      };

      const result = await this.collection.insertOne(document as MediaDocument);
      return toAsset({ ...document, _id: result.insertedId } as MediaDocument);
    } catch (error) {
      await Promise.all(written.map((key) => this.storage.delete(key)));
      throw error;
    }
  }

  /** Opens one variant for streaming, scoped to the workspace that owns it. */
  async openVariant(
    context: WorkspaceContext,
    mediaId: string,
    preferredWidth?: number,
  ): Promise<{ stream: NodeJS.ReadableStream; variant: MediaVariant } | null> {
    const asset = await this.findById(context, mediaId);
    if (asset === null || asset.variants.length === 0) return null;

    const sorted = [...asset.variants].sort((a, b) => a.width - b.width);
    const variant =
      preferredWidth === undefined
        ? sorted[sorted.length - 1]
        : (sorted.find((candidate) => candidate.width >= preferredWidth) ?? sorted[sorted.length - 1]);
    if (variant === undefined) return null;

    const stream = await this.storage.openRead(variant.storageKey);
    return stream === null ? null : { stream, variant };
  }

  async delete(context: WorkspaceContext, mediaId: string): Promise<boolean> {
    const asset = await this.findById(context, mediaId);
    if (asset === null) return false;

    // Metadata goes first: an orphaned byte blob is recoverable, a record pointing at missing bytes
    // renders as a broken image on a live site.
    await this.collection.deleteOne({ _id: new ObjectId(mediaId), workspaceId: context.workspaceId });
    await Promise.all(asset.variants.map((variant) => this.storage.delete(variant.storageKey)));
    return true;
  }
}

function toAsset(document: MediaDocument): MediaAsset {
  const { _id, ...rest } = document;
  return { ...rest, id: _id.toHexString() };
}

export { UnsupportedImageError };
