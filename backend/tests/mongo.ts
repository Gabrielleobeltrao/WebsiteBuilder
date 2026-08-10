import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";

import { ensureIndexes } from "../src/db/indexes";

/**
 * An ephemeral MongoDB per test file. Tests must never depend on a developer's personal database,
 * and each file gets its own server so a leaked document cannot influence another suite.
 */
export type TestDatabase = { db: Db; stop: () => Promise<void>; clear: () => Promise<void> };

export async function startTestDatabase(): Promise<TestDatabase> {
  const server = await MongoMemoryServer.create();
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
