import { ObjectId, type Collection, type Db } from "mongodb";
import { z } from "zod";

import { COLLECTIONS } from "../../db/indexes";
import type { WorkspaceContext } from "../projects/repository";

/**
 * Client accounts.
 *
 * A client is an agency's container for one customer's sites — a CRM record, not a login. Giving
 * clients accounts would mean a second authentication surface and a second permission model; when
 * client access is wanted, it arrives as a workspace invitation instead.
 */
export const CLIENT_TYPES = ["person", "company"] as const;
export const CLIENT_STATUSES = ["lead", "active", "paused", "archived"] as const;

export const clientInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    type: z.enum(CLIENT_TYPES),
    status: z.enum(CLIENT_STATUSES),
    primaryContact: z
      .object({
        name: z.string().max(120).optional(),
        email: z.string().email().max(254).optional(),
        phone: z.string().max(40).optional(),
      })
      .strict()
      .optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict();

export type ClientInput = z.infer<typeof clientInputSchema>;

export type ClientAccount = ClientInput & {
  id: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
};

type ClientDocument = Omit<ClientAccount, "id"> & { _id: ObjectId };

export type ClientFilter = { status?: (typeof CLIENT_STATUSES)[number]; search?: string };

export class ClientRepository {
  private readonly clients: Collection<ClientDocument>;

  constructor(db: Db) {
    this.clients = db.collection<ClientDocument>(COLLECTIONS.clients);
  }

  async list(context: WorkspaceContext, filter: ClientFilter = {}): Promise<ClientAccount[]> {
    const query: Record<string, unknown> = { workspaceId: context.workspaceId };
    if (filter.status) query.status = filter.status;
    if (filter.search) {
      // Escaped: a search string must never be interpreted as a pattern.
      query.name = { $regex: filter.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }

    const documents = await this.clients.find(query, { sort: { updatedAt: -1 }, limit: 500 }).toArray();
    return documents.map(toClient);
  }

  async findById(context: WorkspaceContext, clientId: string): Promise<ClientAccount | null> {
    if (!ObjectId.isValid(clientId) || clientId.length !== 24) return null;
    const document = await this.clients.findOne({
      _id: new ObjectId(clientId),
      workspaceId: context.workspaceId,
    });
    return document === null ? null : toClient(document);
  }

  async create(context: WorkspaceContext, input: ClientInput): Promise<ClientAccount> {
    const now = new Date().toISOString();
    const document = { ...input, workspaceId: context.workspaceId, createdAt: now, updatedAt: now };
    const result = await this.clients.insertOne(document as ClientDocument);
    return toClient({ ...document, _id: result.insertedId } as ClientDocument);
  }

  async update(context: WorkspaceContext, clientId: string, input: Partial<ClientInput>): Promise<ClientAccount | null> {
    if (!ObjectId.isValid(clientId) || clientId.length !== 24) return null;
    const updated = await this.clients.findOneAndUpdate(
      { _id: new ObjectId(clientId), workspaceId: context.workspaceId },
      { $set: { ...input, updatedAt: new Date().toISOString() } },
      { returnDocument: "after" },
    );
    return updated === null ? null : toClient(updated);
  }

  /**
   * Archiving is the only removal offered.
   *
   * A client owns sites, and a hard delete would either orphan them or cascade into deleting a
   * customer's live websites. Archiving keeps every record recoverable and leaves the sites intact.
   */
  async archive(context: WorkspaceContext, clientId: string): Promise<ClientAccount | null> {
    return this.update(context, clientId, { status: "archived" });
  }
}

function toClient(document: ClientDocument): ClientAccount {
  const { _id, ...rest } = document;
  return { ...rest, id: _id.toHexString() };
}
