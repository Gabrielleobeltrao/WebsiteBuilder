import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";

import { ensureIndexes } from "../src/db/indexes";

/**
 * An ephemeral MongoDB per test file. Tests must never depend on a developer's personal database,
 * and each file gets its own server so a leaked document cannot influence another suite.
 */
export type TestDatabase = { db: Db; stop: () => Promise<void>; clear: () => Promise<void> };

export async function startTestDatabase(): Promise<TestDatabase> {
  const server = await MongoMemoryServer.create().catch((cause: unknown) => {
    // The download is the usual cause, and its own error says only that a request failed. Without
    // this, the first thing a developer sees is `undefined.stop()` from a teardown for a setup that
    // never ran — a message about the wrong thing entirely.
    throw new Error(
      "Could not start mongodb-memory-server. These tests need a MongoDB binary: it is downloaded " +
        "on first run and cached in node_modules/.cache/mongodb-binaries, so the machine needs " +
        "network access once, or MONGOMS_SYSTEM_BINARY pointing at an installed mongod. " +
        `Original error: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  });
  const client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db("test");
  await ensureIndexes(db);

  return {
    db,
    clear: async () => {
      const collections = await db.collections();
      await Promise.all(collections.map((collection) => collection.deleteMany({})));
    },
    stop: async () => {
      await client.close();
      await server.stop();
    },
  };
}
