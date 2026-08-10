import { MongoClient, type Db } from "mongodb";
import type { Logger } from "pino";

import type { Env } from "../config/env";
import { ensureIndexes } from "./indexes";

export type Database = {
  db: Db;
  client: MongoClient;
  close: () => Promise<void>;
};

/**
 * One shared client per process. It is passed to repositories explicitly rather than kept in a
 * module-level singleton, so tests run against an isolated database without global state and two
 * tenants can never end up sharing a connection assumption.
 */
export async function connectDatabase(
  env: Pick<Env, "MONGODB_URI" | "MONGODB_DB_NAME">,
  logger: Logger,
): Promise<Database> {
  if (!env.MONGODB_URI || !env.MONGODB_DB_NAME) {
    throw new Error("MONGODB_URI and MONGODB_DB_NAME are required to connect to the database");
  }

  const client = new MongoClient(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    retryWrites: true,
  });
  await client.connect();
  const db = client.db(env.MONGODB_DB_NAME);
  await ensureIndexes(db);
  logger.info({ database: env.MONGODB_DB_NAME }, "database connected");

  return {
    db,
    client,
    close: async () => {
      await client.close();
    },
  };
}

/** Health probe that reports reachability without exposing the connection string. */
export function createDatabaseHealthProbe(database: Database | null) {
  return async (): Promise<{ database: "up" | "down" | "not_configured" }> => {
    if (database === null) return { database: "not_configured" };
    try {
      await database.db.command({ ping: 1 });
      return { database: "up" };
    } catch {
      return { database: "down" };
    }
  };
}
