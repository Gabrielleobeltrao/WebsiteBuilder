import { ObjectId, type Collection, type Db } from "mongodb";
import { z } from "zod";

import type { WorkspaceContext } from "../projects/repository";

/**
 * Campaign summaries.
 *
 * This is lightweight management data — a name, a client, dates and a status — not an advertising
 * integration. There is deliberately no performance field: inventing one would mean either
 * fabricating metrics or leaving a permanently empty column that looks like a broken integration.
 * Provider metrics arrive later behind an adapter, alongside the analytics contracts.
 */
export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed"] as const;

export const campaignInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    clientId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    status: z.enum(CAMPAIGN_STATUSES),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict()
  .refine(
    (value) => value.startsAt === undefined || value.endsAt === undefined || value.startsAt <= value.endsAt,
    { message: "must not end before it starts", path: ["endsAt"] },
  );

export type CampaignInput = z.infer<typeof campaignInputSchema>;

export type Campaign = CampaignInput & {
  id: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
};

type CampaignDocument = Omit<Campaign, "id"> & { _id: ObjectId };

export const CAMPAIGNS_COLLECTION = "campaigns";

export async function ensureCampaignIndexes(db: Db): Promise<void> {
  await db
    .collection(CAMPAIGNS_COLLECTION)
    .createIndexes([
      { key: { workspaceId: 1, status: 1, startsAt: -1 }, name: "workspace_status" },
      { key: { workspaceId: 1, clientId: 1 }, name: "workspace_client" },
    ]);
}

export class CampaignRepository {
  private readonly campaigns: Collection<CampaignDocument>;

  constructor(db: Db) {
    this.campaigns = db.collection<CampaignDocument>(CAMPAIGNS_COLLECTION);
  }

  async list(
    context: WorkspaceContext,
    filter: { clientId?: string; projectId?: string; status?: (typeof CAMPAIGN_STATUSES)[number] } = {},
  ): Promise<Campaign[]> {
    const query: Record<string, unknown> = { workspaceId: context.workspaceId };
    if (filter.clientId) query.clientId = filter.clientId;
    if (filter.projectId) query.projectId = filter.projectId;
    if (filter.status) query.status = filter.status;

    const documents = await this.campaigns.find(query, { sort: { startsAt: -1 }, limit: 500 }).toArray();
    return documents.map(toCampaign);
  }

  async findById(context: WorkspaceContext, campaignId: string): Promise<Campaign | null> {
    if (!ObjectId.isValid(campaignId) || campaignId.length !== 24) return null;
    const document = await this.campaigns.findOne({
      _id: new ObjectId(campaignId),
      workspaceId: context.workspaceId,
    });
    return document === null ? null : toCampaign(document);
  }

  async create(context: WorkspaceContext, input: CampaignInput): Promise<Campaign> {
    const now = new Date().toISOString();
    const document = { ...input, workspaceId: context.workspaceId, createdAt: now, updatedAt: now };
    const result = await this.campaigns.insertOne(document as CampaignDocument);
    return toCampaign({ ...document, _id: result.insertedId } as CampaignDocument);
  }

  async update(
    context: WorkspaceContext,
    campaignId: string,
    input: Partial<CampaignInput>,
  ): Promise<Campaign | null> {
    if (!ObjectId.isValid(campaignId) || campaignId.length !== 24) return null;
    const updated = await this.campaigns.findOneAndUpdate(
      { _id: new ObjectId(campaignId), workspaceId: context.workspaceId },
      { $set: { ...input, updatedAt: new Date().toISOString() } },
      { returnDocument: "after" },
    );
    return updated === null ? null : toCampaign(updated);
  }

  async delete(context: WorkspaceContext, campaignId: string): Promise<boolean> {
    if (!ObjectId.isValid(campaignId) || campaignId.length !== 24) return false;
    const result = await this.campaigns.deleteOne({
      _id: new ObjectId(campaignId),
      workspaceId: context.workspaceId,
    });
    return result.deletedCount === 1;
  }

  /** Campaigns running or starting soon, for the dashboard summaries. */
  async activeAndUpcoming(context: WorkspaceContext, now = new Date().toISOString()): Promise<Campaign[]> {
    const documents = await this.campaigns
      .find(
        {
          workspaceId: context.workspaceId,
          status: { $in: ["active", "draft"] },
          $or: [{ endsAt: { $exists: false } }, { endsAt: { $gte: now } }],
        },
        { sort: { startsAt: 1 }, limit: 20 },
      )
      .toArray();
    return documents.map(toCampaign);
  }
}

function toCampaign(document: CampaignDocument): Campaign {
  const { _id, ...rest } = document;
  return { ...rest, id: _id.toHexString() };
}
