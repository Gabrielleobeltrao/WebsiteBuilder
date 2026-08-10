import { Readable } from "node:stream";

import { GridFSBucket, ObjectId, type Db } from "mongodb";

/**
 * Media byte storage behind a narrow interface.
 *
 * GridFS is the initial implementation because it needs no extra infrastructure. Everything above
 * this file talks only to `MediaStorage`, so moving to S3 or R2 later is a new implementation of
 * four methods rather than a change that reaches into the media module, the renderer and publishing.
 */
export type StoredObject = { storageKey: string; bytes: number };

export type MediaStorage = {
  put: (input: { data: Buffer; contentType: string }) => Promise<StoredObject>;
  openRead: (storageKey: string) => Promise<Readable | null>;
  delete: (storageKey: string) => Promise<void>;
  exists: (storageKey: string) => Promise<boolean>;
};

export function createGridFsStorage(db: Db, bucketName = "media"): MediaStorage {
  const bucket = new GridFSBucket(db, { bucketName });

  return {
    async put({ data, contentType }) {
      // The driver dropped the contentType option; it lives in metadata now.
      const stream = bucket.openUploadStream(new ObjectId().toHexString(), {
        metadata: { contentType },
      });
      await new Promise<void>((resolve, reject) => {
        stream.on("error", reject);
        stream.on("finish", () => resolve());
        Readable.from(data).pipe(stream);
      });
      return { storageKey: stream.id.toHexString(), bytes: data.length };
    },

    async openRead(storageKey) {
      if (!ObjectId.isValid(storageKey)) return null;
      const id = new ObjectId(storageKey);
      const files = await bucket.find({ _id: id }, { limit: 1 }).toArray();
      if (files.length === 0) return null;
      return bucket.openDownloadStream(id);
    },

    async delete(storageKey) {
      if (!ObjectId.isValid(storageKey)) return;
      try {
        await bucket.delete(new ObjectId(storageKey));
      } catch {
        // Deleting bytes that are already gone is the desired end state, not an error.
      }
    },

    async exists(storageKey) {
      if (!ObjectId.isValid(storageKey)) return false;
      const files = await bucket.find({ _id: new ObjectId(storageKey) }, { limit: 1 }).toArray();
      return files.length > 0;
    },
  };
}
