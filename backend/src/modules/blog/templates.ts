import {
  analyseFieldCompatibility,
  blocksTemplatePublication,
  createPage,
  type BlogFieldDefinition,
  type BuilderPage,
  type FieldCompatibilityIssue,
} from "@websitebuilder/shared";
import { ObjectId, type Collection, type Db } from "mongodb";

import type { WorkspaceContext } from "../projects/repository";
import { isDuplicateKey } from "./repository";

/**
 * Blog template storage and the draft/published lifecycle.
 *
 * Draft and published documents are separate columns of the same record, never the same field with
 * a flag. Editing a template must not change a single live article until the designer publishes it,
 * and there is no way to accidentally serve a draft when the two cannot be confused.
 */
export const TEMPLATE_KINDS = ["index", "article"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export type BlogTemplate = {
  id: string;
  workspaceId: string;
  projectId: string;
  kind: TemplateKind;
  draftDocument: BuilderPage;
  publishedDocument?: BuilderPage;
  draftVersion: number;
  publishedVersion?: number;
  fieldDefinitions: BlogFieldDefinition[];
  /** Definitions as of the last publication, used to compute the impact of the next one. */
  publishedFieldDefinitions: BlogFieldDefinition[];
  updatedAt: string;
  publishedAt?: string;
};

type TemplateDocument = Omit<BlogTemplate, "id"> & { _id: ObjectId };

export type PublicationImpact = {
  issues: FieldCompatibilityIssue[];
  blocked: boolean;
  affectedPostCount: number;
};

export async function ensureTemplateIndexes(db: Db): Promise<void> {
  await db
    .collection("blogTemplates")
    .createIndexes([{ key: { projectId: 1, kind: 1 }, name: "project_kind_unique", unique: true }]);
}

export class TemplateRepository {
  private readonly templates: Collection<TemplateDocument>;

  constructor(db: Db) {
    this.templates = db.collection<TemplateDocument>("blogTemplates");
  }

  /** Loads a template, creating a safe starter draft the first time it is requested. */
  async loadOrCreate(context: WorkspaceContext, projectId: string, kind: TemplateKind): Promise<BlogTemplate> {
    const existing = await this.templates.findOne({ workspaceId: context.workspaceId, projectId, kind });
    if (existing !== null) return toTemplate(existing);

    const now = new Date().toISOString();
    const document: Omit<TemplateDocument, "_id"> = {
      workspaceId: context.workspaceId,
      projectId,
      kind,
      draftDocument: createPage({ name: kind === "index" ? "Blog index" : "Article" }),
      draftVersion: 1,
      fieldDefinitions: [],
      publishedFieldDefinitions: [],
      updatedAt: now,
    };

    try {
      const result = await this.templates.insertOne(document as TemplateDocument);
      return toTemplate({ ...document, _id: result.insertedId } as TemplateDocument);
    } catch (error) {
      /*
       * Somebody else created it between the read and the write.
       *
       * `{projectId, kind}` is unique, which is what stops a project from ending up with two of the
       * same template — so two tabs opening the same layout, or one request that resolves templates
       * down two paths at once, raced and one of them got a duplicate-key failure instead of the
       * template. Reading it back is the whole recovery: the row that won is the row both callers
       * wanted.
       */
      if (!isDuplicateKey(error)) throw error;
      const existing = await this.templates.findOne({ workspaceId: context.workspaceId, projectId, kind });
      if (existing === null) throw error;
      return toTemplate(existing);
    }
  }

  /**
   * Saves the draft against the version it was edited from.
   *
   * Every other save in this product refuses a stale write; this one accepted any, so two tabs on
   * the same template meant the later save silently discarded the earlier one's work. `draftVersion`
   * already existed and already incremented — nothing was checking it.
   *
   * `expectedVersion` is optional so a caller with no version in hand can still save, which is what
   * the seeding path and the tests that predate this do.
   */
  /**
   * The template for a kind, and whether this call is what brought it into existence.
   *
   * `loadOrCreate` cannot answer the second half, and the repair needs it: it publishes a starter so
   * a blog it just fixed can serve something, and publishing anything it did *not* create would
   * promote a draft its author never approved onto every article of a live site. "It exists now" and
   * "I made it" are different facts, and only one of them makes an automatic publish safe.
   *
   * One upsert rather than a read followed by a write, so two callers arriving together cannot both
   * believe they created it.
   */
  async createStarterIfMissing(
    context: WorkspaceContext,
    projectId: string,
    kind: TemplateKind,
  ): Promise<{ template: BlogTemplate; created: boolean }> {
    const now = new Date().toISOString();
    const starter: Omit<TemplateDocument, "_id"> = {
      workspaceId: context.workspaceId,
      projectId,
      kind,
      draftDocument: createPage({ name: kind === "index" ? "Blog index" : "Article" }),
      draftVersion: 1,
      fieldDefinitions: [],
      publishedFieldDefinitions: [],
      updatedAt: now,
    };

    try {
      const result = await this.templates.findOneAndUpdate(
        { workspaceId: context.workspaceId, projectId, kind },
        { $setOnInsert: starter as TemplateDocument },
        { upsert: true, returnDocument: "after", includeResultMetadata: true },
      );

      const stored = result.value;
      if (stored === null) throw new Error("The template could not be created");

      return { template: toTemplate(stored), created: result.lastErrorObject?.upserted !== undefined };
    } catch (error) {
      /*
       * The uniqueness that refused the insert is `{projectId, kind}`, which carries no workspace.
       *
       * Two callers in this workspace racing is the ordinary case, and re-reading returns the row
       * that won. A row belonging to a *different* workspace is not something to recover from:
       * returning it would hand one tenant another tenant's layout, so this fails instead. A project
       * id belongs to one workspace, and the routes resolve it before reaching here.
       */
      if (!isDuplicateKey(error)) throw error;

      const existing = await this.templates.findOne({ workspaceId: context.workspaceId, projectId, kind });
      if (existing === null) throw error;
      return { template: toTemplate(existing), created: false };
    }
  }

  async saveDraft(
    context: WorkspaceContext,
    projectId: string,
    kind: TemplateKind,
    input: { draftDocument: BuilderPage; fieldDefinitions: BlogFieldDefinition[] },
    expectedVersion?: number,
  ): Promise<BlogTemplate | null> {
    const updated = await this.templates.findOneAndUpdate(
      {
        workspaceId: context.workspaceId,
        projectId,
        kind,
        ...(expectedVersion === undefined ? {} : { draftVersion: expectedVersion }),
      },
      {
        $set: {
          draftDocument: input.draftDocument,
          fieldDefinitions: input.fieldDefinitions,
          updatedAt: new Date().toISOString(),
        },
        $inc: { draftVersion: 1 },
      },
      { returnDocument: "after" },
    );
    return updated === null ? null : toTemplate(updated);
  }

  /**
   * Reports what publishing this draft would do to existing posts.
   *
   * Publishing a template updates every post that uses it, so a newly required field with no value
   * is a real content gap. The report names the exact posts, and only that class of issue blocks —
   * removals and type changes are shown so the decision is informed, not prevented.
   */
  async analysePublication(
    context: WorkspaceContext,
    projectId: string,
    kind: TemplateKind,
    publishedPosts: ReadonlyArray<{ id: string; customFieldValues: Record<string, unknown> }>,
  ): Promise<PublicationImpact | null> {
    const template = await this.templates.findOne({ workspaceId: context.workspaceId, projectId, kind });
    if (template === null) return null;

    const issues = analyseFieldCompatibility({
      previous: template.publishedFieldDefinitions,
      next: template.fieldDefinitions,
      publishedPosts,
    });

    return {
      issues,
      blocked: issues.some(blocksTemplatePublication),
      affectedPostCount: new Set(issues.flatMap((issue) => issue.postIds)).size,
    };
  }

  /**
   * Promotes the draft to published. Refuses when the impact report blocks, so an incompatible
   * template cannot reach live articles through this path at all.
   */
  async publish(
    context: WorkspaceContext,
    projectId: string,
    kind: TemplateKind,
    publishedPosts: ReadonlyArray<{ id: string; customFieldValues: Record<string, unknown> }>,
  ): Promise<{ template: BlogTemplate } | { impact: PublicationImpact } | null> {
    const impact = await this.analysePublication(context, projectId, kind, publishedPosts);
    if (impact === null) return null;
    if (impact.blocked) return { impact };

    const template = await this.templates.findOne({ workspaceId: context.workspaceId, projectId, kind });
    if (template === null) return null;

    const now = new Date().toISOString();
    const updated = await this.templates.findOneAndUpdate(
      { workspaceId: context.workspaceId, projectId, kind },
      {
        $set: {
          publishedDocument: template.draftDocument,
          publishedFieldDefinitions: template.fieldDefinitions,
          publishedVersion: template.draftVersion,
          publishedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );

    return updated === null ? null : { template: toTemplate(updated) };
  }

  /** Public rendering reads this and nothing else, so a draft can never reach a visitor. */
  async findPublished(projectId: string, kind: TemplateKind): Promise<BuilderPage | null> {
    const template = await this.templates.findOne({ projectId, kind });
    return template?.publishedDocument ?? null;
  }
}

function toTemplate(document: TemplateDocument): BlogTemplate {
  const { _id, ...rest } = document;
  return { ...rest, id: _id.toHexString() };
}
