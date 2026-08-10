import {
  resolveFormStatus,
  validateSubmission,
  type FormDefinitionInput,
  type FormStatus,
  type SubmissionValues,
} from "@websitebuilder/shared";
import { ObjectId, type Collection, type Db } from "mongodb";

import type { WorkspaceContext } from "../projects/repository";

/**
 * Form definitions and submissions.
 *
 * Definitions belong to a site; submissions are write-only through a hardened public endpoint and
 * readable only through authorised workspace routes. Submissions store the values a definition
 * declares and the minimum attribution needed to make sense of them — never the raw request body,
 * because collecting more than was configured is a liability nobody asked for.
 */
export const FORM_COLLECTIONS = { definitions: "formDefinitions", submissions: "formSubmissions" } as const;

export type FormDefinition = FormDefinitionInput & {
  id: string;
  workspaceId: string;
  projectId: string;
  status: FormStatus;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SubmissionSource = { pageId?: string; path?: string; utm?: Record<string, string> };
export const SUBMISSION_STATUSES = ["new", "read", "archived", "spam"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export type FormSubmission = {
  id: string;
  workspaceId: string;
  projectId: string;
  formId: string;
  values: SubmissionValues;
  source?: SubmissionSource;
  status: SubmissionStatus;
  createdAt: string;
};

type DefinitionDocument = Omit<FormDefinition, "id"> & { _id: ObjectId };
type SubmissionDocument = Omit<FormSubmission, "id"> & { _id: ObjectId; fingerprint: string };

export async function ensureFormIndexes(db: Db): Promise<void> {
  await db
    .collection(FORM_COLLECTIONS.definitions)
    .createIndexes([{ key: { workspaceId: 1, projectId: 1, updatedAt: -1 }, name: "workspace_project_recent" }]);

  await db.collection(FORM_COLLECTIONS.submissions).createIndexes([
    { key: { workspaceId: 1, projectId: 1, formId: 1, createdAt: -1 }, name: "dashboard" },
    // Duplicate suppression: the same content from the same form within the window is one entry.
    { key: { formId: 1, fingerprint: 1, createdAt: -1 }, name: "duplicate_window" },
  ]);
}

export class FormRepository {
  private readonly definitions: Collection<DefinitionDocument>;
  private readonly submissions: Collection<SubmissionDocument>;

  constructor(db: Db) {
    this.definitions = db.collection<DefinitionDocument>(FORM_COLLECTIONS.definitions);
    this.submissions = db.collection<SubmissionDocument>(FORM_COLLECTIONS.submissions);
  }

  async list(context: WorkspaceContext, projectId: string): Promise<FormDefinition[]> {
    const documents = await this.definitions
      .find({ workspaceId: context.workspaceId, projectId }, { sort: { updatedAt: -1 } })
      .toArray();
    return documents.map(toDefinition);
  }

  async findById(context: WorkspaceContext, projectId: string, formId: string): Promise<FormDefinition | null> {
    if (!ObjectId.isValid(formId) || formId.length !== 24) return null;
    const document = await this.definitions.findOne({
      _id: new ObjectId(formId),
      workspaceId: context.workspaceId,
      projectId,
    });
    return document === null ? null : toDefinition(document);
  }

  /** Public lookup: identity comes from the project in the path, and archived forms are closed. */
  async findPublic(projectId: string, formId: string): Promise<FormDefinition | null> {
    if (!ObjectId.isValid(formId) || formId.length !== 24) return null;
    const document = await this.definitions.findOne({ _id: new ObjectId(formId), projectId, archived: false });
    return document === null ? null : toDefinition(document);
  }

  async create(
    context: WorkspaceContext,
    projectId: string,
    input: FormDefinitionInput,
    options: { pageExists?: (pageId: string) => boolean } = {},
  ): Promise<FormDefinition> {
    const now = new Date().toISOString();
    const document = {
      ...input,
      workspaceId: context.workspaceId,
      projectId,
      status: resolveFormStatus(input, options),
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.definitions.insertOne(document as DefinitionDocument);
    return toDefinition({ ...document, _id: result.insertedId } as DefinitionDocument);
  }

  async update(
    context: WorkspaceContext,
    projectId: string,
    formId: string,
    input: FormDefinitionInput,
    options: { pageExists?: (pageId: string) => boolean } = {},
  ): Promise<FormDefinition | null> {
    if (!ObjectId.isValid(formId) || formId.length !== 24) return null;
    const updated = await this.definitions.findOneAndUpdate(
      { _id: new ObjectId(formId), workspaceId: context.workspaceId, projectId },
      { $set: { ...input, status: resolveFormStatus(input, options), updatedAt: new Date().toISOString() } },
      { returnDocument: "after" },
    );
    return updated === null ? null : toDefinition(updated);
  }

  /**
   * Removes a form definition only when nothing depends on it.
   *
   * A definition with submissions is archived instead. Deleting it would destroy business records
   * the customer collected, to tidy up a canvas — the two are not comparable in cost.
   */
  async removeOrArchive(
    context: WorkspaceContext,
    projectId: string,
    formId: string,
  ): Promise<"deleted" | "archived" | "not-found"> {
    const definition = await this.findById(context, projectId, formId);
    if (definition === null) return "not-found";

    const submissions = await this.submissions.countDocuments({ workspaceId: context.workspaceId, formId });
    if (submissions > 0) {
      await this.definitions.updateOne(
        { _id: new ObjectId(formId), workspaceId: context.workspaceId },
        { $set: { archived: true, status: "archived", updatedAt: new Date().toISOString() } },
      );
      return "archived";
    }

    await this.definitions.deleteOne({ _id: new ObjectId(formId), workspaceId: context.workspaceId });
    return "deleted";
  }

  async restore(context: WorkspaceContext, projectId: string, formId: string): Promise<FormDefinition | null> {
    if (!ObjectId.isValid(formId) || formId.length !== 24) return null;
    const definition = await this.findById(context, projectId, formId);
    if (definition === null) return null;

    const updated = await this.definitions.findOneAndUpdate(
      { _id: new ObjectId(formId), workspaceId: context.workspaceId, projectId },
      { $set: { archived: false, status: resolveFormStatus(definition), updatedAt: new Date().toISOString() } },
      { returnDocument: "after" },
    );
    return updated === null ? null : toDefinition(updated);
  }

  /**
   * Accepts a public submission.
   *
   * Returns the same shape whatever happens, so a caller cannot learn from the response whether a
   * form exists, whether a duplicate was suppressed, or how anything is stored.
   */
  async submit(input: {
    projectId: string;
    formId: string;
    values: Record<string, unknown>;
    source?: SubmissionSource;
    /** Same content within this window counts as one submission. */
    duplicateWindowMs?: number;
    now?: Date;
  }): Promise<{ accepted: boolean; errors: Array<{ fieldId: string; code: string }> }> {
    const definition = await this.findPublic(input.projectId, input.formId);
    if (definition === null) return { accepted: false, errors: [] };

    const { errors, accepted } = validateSubmission(definition, input.values);
    if (errors.length > 0) return { accepted: false, errors };

    const now = input.now ?? new Date();
    const fingerprint = fingerprintOf(accepted);
    const windowMs = input.duplicateWindowMs ?? 60_000;

    const duplicate = await this.submissions.findOne({
      formId: input.formId,
      fingerprint,
      createdAt: { $gte: new Date(now.getTime() - windowMs).toISOString() },
    });
    // A duplicate reports success: the visitor did submit, and telling them otherwise would make
    // them submit again.
    if (duplicate !== null) return { accepted: true, errors: [] };

    await this.submissions.insertOne({
      _id: new ObjectId(),
      workspaceId: definition.workspaceId,
      projectId: input.projectId,
      formId: input.formId,
      values: accepted,
      ...(input.source ? { source: input.source } : {}),
      status: "new",
      createdAt: now.toISOString(),
      fingerprint,
    });

    return { accepted: true, errors: [] };
  }

  async listSubmissions(
    context: WorkspaceContext,
    projectId: string,
    formId: string,
    filter: { status?: SubmissionStatus; page?: number; perPage?: number } = {},
  ): Promise<{ items: FormSubmission[]; total: number; page: number; perPage: number }> {
    const page = Math.max(1, filter.page ?? 1);
    const perPage = Math.min(100, Math.max(1, filter.perPage ?? 25));

    const query: Record<string, unknown> = { workspaceId: context.workspaceId, projectId, formId };
    if (filter.status) query.status = filter.status;

    const [items, total] = await Promise.all([
      this.submissions
        .find(query, { sort: { createdAt: -1 }, skip: (page - 1) * perPage, limit: perPage })
        .toArray(),
      this.submissions.countDocuments(query),
    ]);

    return { items: items.map(toSubmission), total, page, perPage };
  }

  async setSubmissionStatus(
    context: WorkspaceContext,
    projectId: string,
    submissionId: string,
    status: SubmissionStatus,
  ): Promise<FormSubmission | null> {
    if (!ObjectId.isValid(submissionId) || submissionId.length !== 24) return null;
    const updated = await this.submissions.findOneAndUpdate(
      { _id: new ObjectId(submissionId), workspaceId: context.workspaceId, projectId },
      { $set: { status } },
      { returnDocument: "after" },
    );
    return updated === null ? null : toSubmission(updated);
  }

  async deleteSubmission(context: WorkspaceContext, projectId: string, submissionId: string): Promise<boolean> {
    if (!ObjectId.isValid(submissionId) || submissionId.length !== 24) return false;
    const result = await this.submissions.deleteOne({
      _id: new ObjectId(submissionId),
      workspaceId: context.workspaceId,
      projectId,
    });
    return result.deletedCount === 1;
  }

  /** Applies a form's retention policy. Scoped to one workspace so it can never reach another. */
  async applyRetention(
    context: WorkspaceContext,
    projectId: string,
    formId: string,
    retentionDays: number,
    now = new Date(),
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.submissions.deleteMany({
      workspaceId: context.workspaceId,
      projectId,
      formId,
      createdAt: { $lt: cutoff },
    });
    return result.deletedCount;
  }
}

/** Stable content fingerprint used only for duplicate suppression. */
function fingerprintOf(values: SubmissionValues): string {
  return JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
}

function toDefinition(document: DefinitionDocument): FormDefinition {
  const { _id, ...rest } = document;
  return { ...rest, id: _id.toHexString() };
}

function toSubmission(document: SubmissionDocument): FormSubmission {
  const { _id, fingerprint: _f, ...rest } = document;
  return { ...rest, id: _id.toHexString() };
}
