/**
 * Version of the persisted builder document contract.
 *
 * Increment it only together with a migration that can read every older version. The renderer,
 * the editor and the publication compiler all refuse a document whose version they do not know.
 */
export const SCHEMA_VERSION = 1;

export type SchemaVersion = typeof SCHEMA_VERSION;
