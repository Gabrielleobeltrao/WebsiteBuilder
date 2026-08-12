import {
  resolveFormStatus,
  snapshotFields,
  SUBMISSION_STATUSES,
  validateSubmission,
  type FormDefinitionInput,
  type FormField,
  type FormRecord,
  type FormSubmissionRecord,
  type SubmissionValues,
  type SubmissionSource,
  type SubmissionStatus,
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

/** The stored definition. Declared once in the shared contract; this is the name this module uses. */
export type FormDefinition = FormRecord;

/**
 * Two tabs, one form.
 *
 * Without this the second save wins silently and takes the fields the first one added with it. The
 * caller is told the current revision so it can reload and show what it would have overwritten.
 */
export class FormRevisionConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super("revision-changed");
    this.name = "FormRevisionConflictError";
  }
}

/** Re-exported so a caller inside this module does not have to know where the contract lives. */
export { SUBMISSION_STATUSES };
export type { SubmissionSource, SubmissionStatus };

export type FormSubmission = FormSubmissionRecord;

type DefinitionDocument = Omit<FormDefinition, "id"> & { _id: ObjectId };
type SubmissionDocument = Omit<FormSubmission, "id"> & { _id: ObjectId; fingerprint: string };

/** What the inbox filters by. Everything is optional; nothing widens the tenant scope. */
export type SubmissionFilter = {
  formId?: string;
  status?: SubmissionStatus;
  /** Inclusive lower and exclusive upper bound, as ISO instants. */
  from?: string;
  to?: string;
  pageId?: string;
  page?: number;
  perPage?: number;
};

export async function ensureFormIndexes(db: Db): Promise<void> {
  await db
    .collection(FORM_COLLECTIONS.definitions)
    .createIndexes([{ key: { workspaceId: 1, projectId: 1, updatedAt: -1 }, name: "workspace_project_recent" }]);

  await db.collection(FORM_COLLECTIONS.submissions).createIndexes([
    { key: { workspaceId: 1, projectId: 1, formId: 1, createdAt: -1 }, name: "dashboard" },
    // The inbox's own order: every form of a project, newest first, which is the screen's default.
    { key: { workspaceId: 1, projectId: 1, createdAt: -1 }, name: "inbox" },
    // Status is the filter people reach for most, and the unread badge is a count over it.
    { key: { workspaceId: 1, projectId: 1, status: 1, createdAt: -1 }, name: "inbox_by_status" },
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
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.definitions.insertOne(document as DefinitionDocument);
    return toDefinition({ ...document, _id: result.insertedId } as DefinitionDocument);
  }

  /**
   * Replaces a definition, but only the revision the caller was looking at.
   *
   * Returns null when the form does not exist for this tenant, and throws when it exists at a
   * different revision. Those are two different answers and a caller has to tell them apart: one is
   * "gone", the other is "somebody else edited this while you were typing".
   */
  async update(
    context: WorkspaceContext,
    projectId: string,
    formId: string,
    input: FormDefinitionInput,
    options: { pageExists?: (pageId: string) => boolean; expectedRevision?: number } = {},
  ): Promise<FormDefinition | null> {
    if (!ObjectId.isValid(formId) || formId.length !== 24) return null;

    const scope = { _id: new ObjectId(formId), workspaceId: context.workspaceId, projectId };
    const updated = await this.definitions.findOneAndUpdate(
      options.expectedRevision === undefined ? scope : { ...scope, revision: options.expectedRevision },
      {
        $set: { ...input, status: resolveFormStatus(input, options), updatedAt: new Date().toISOString() },
        $inc: { revision: 1 },
      },
      { returnDocument: "after" },
    );

    if (updated !== null) return toDefinition(updated);

    const current = await this.definitions.findOne(scope);
    if (current === null) return null;
    throw new FormRevisionConflictError(current.revision ?? 1);
  }

  /**
   * A copy, ready to diverge.
   *
   * Duplicating is how somebody makes a variant without risking the form that is already collecting
   * answers: the copy starts at revision 1 with no submissions of its own, and no page points at it
   * until one is bound.
   */
  async duplicate(context: WorkspaceContext, projectId: string, formId: string, name: string): Promise<FormDefinition | null> {
    const source = await this.findById(context, projectId, formId);
    if (source === null) return null;

    const { id: _id, workspaceId: _w, projectId: _p, revision: _r, createdAt: _c, updatedAt: _u, archived: _a, status: _s, ...input } = source;
    return this.create(context, projectId, { ...input, name });
  }

  /**
   * How many answers each form holds, in one pass.
   *
   * The overview lists every form with its counts; asking per form would be one query per row, and
   * the row count is chosen by the customer.
   */
  async countsByForm(
    context: WorkspaceContext,
    projectId: string,
  ): Promise<Map<string, { total: number; unread: number; lastAt: string | null }>> {
    const rows = await this.submissions
      .aggregate<{ _id: string; total: number; unread: number; lastAt: string | null }>([
        { $match: { workspaceId: context.workspaceId, projectId } },
        {
          $group: {
            _id: "$formId",
            total: { $sum: 1 },
            unread: { $sum: { $cond: [{ $eq: ["$status", "new"] }, 1, 0] } },
            lastAt: { $max: "$createdAt" },
          },
        },
      ])
      .toArray();

    return new Map(rows.map((row) => [row._id, { total: row.total, unread: row.unread, lastAt: row.lastAt ?? null }]));
  }

  /** Whether this project holds any form record at all, for the navigation projection. */
  async hasRecords(context: WorkspaceContext, projectId: string): Promise<boolean> {
    const scope = { workspaceId: context.workspaceId, projectId };
    if ((await this.definitions.countDocuments(scope, { limit: 1 })) > 0) return true;
    return (await this.submissions.countDocuments(scope, { limit: 1 })) > 0;
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
    /**
     * The exact questions to validate against.
     *
     * Public traffic passes the revision embedded in the published snapshot, because that is what
     * the visitor was actually shown. Without one the live definition is used, which is what a
     * caller editing a draft means. Either way the *tenant* comes from the stored record below, so
     * a caller cannot direct a submission into another workspace by describing a form.
     */
    against?: { revision: number; fields: readonly FormField[] };
    source?: SubmissionSource;
    /** Same content within this window counts as one submission. */
    duplicateWindowMs?: number;
    now?: Date;
  }): Promise<{ accepted: boolean; errors: Array<{ fieldId: string; code: string }> }> {
    const definition = await this.findPublic(input.projectId, input.formId);
    if (definition === null) return { accepted: false, errors: [] };

    const asked = input.against ?? { revision: definition.revision, fields: definition.fields };
    const { errors, accepted } = validateSubmission({ fields: [...asked.fields] }, input.values);
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
      formRevision: asked.revision,
      // Stored with the answer rather than looked up later: labels and options change, and an
      // answer beside a question nobody asked is not a record of anything.
      fields: snapshotFields(asked.fields),
      values: accepted,
      ...(input.source ? { source: input.source } : {}),
      status: "new",
      createdAt: now.toISOString(),
      fingerprint,
    });

    return { accepted: true, errors: [] };
  }

  /** The tenant-scoped query every submission read starts from. Nothing widens it. */
  private submissionQuery(
    context: WorkspaceContext,
    projectId: string,
    filter: SubmissionFilter,
  ): Record<string, unknown> {
    const query: Record<string, unknown> = { workspaceId: context.workspaceId, projectId };
    if (filter.formId) query.formId = filter.formId;
    if (filter.status) query.status = filter.status;
    if (filter.pageId) query["source.pageId"] = filter.pageId;

    if (filter.from !== undefined || filter.to !== undefined) {
      query.createdAt = {
        ...(filter.from === undefined ? {} : { $gte: filter.from }),
        ...(filter.to === undefined ? {} : { $lt: filter.to }),
      };
    }

    return query;
  }

  async listSubmissions(
    context: WorkspaceContext,
    projectId: string,
    filter: SubmissionFilter = {},
  ): Promise<{ items: FormSubmission[]; total: number; page: number; perPage: number }> {
    const page = Math.max(1, filter.page ?? 1);
    const perPage = Math.min(100, Math.max(1, filter.perPage ?? 25));
    const query = this.submissionQuery(context, projectId, filter);

    const [items, total] = await Promise.all([
      this.submissions
        .find(query, { sort: { createdAt: -1 }, skip: (page - 1) * perPage, limit: perPage })
        .toArray(),
      this.submissions.countDocuments(query),
    ]);

    return { items: items.map(toSubmission), total, page, perPage };
  }

  async findSubmission(
    context: WorkspaceContext,
    projectId: string,
    submissionId: string,
  ): Promise<FormSubmission | null> {
    if (!ObjectId.isValid(submissionId) || submissionId.length !== 24) return null;
    const document = await this.submissions.findOne({
      _id: new ObjectId(submissionId),
      workspaceId: context.workspaceId,
      projectId,
    });
    return document === null ? null : toSubmission(document);
  }

  /** How many submissions sit in each status, for the inbox's own summary. */
  async submissionCounts(
    context: WorkspaceContext,
    projectId: string,
    filter: SubmissionFilter = {},
  ): Promise<Record<SubmissionStatus, number> & { total: number }> {
    const { status: _ignored, ...rest } = filter;
    const rows = await this.submissions
      .aggregate<{ _id: SubmissionStatus; count: number }>([
        { $match: this.submissionQuery(context, projectId, rest) },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
      .toArray();

    const counts = { new: 0, read: 0, archived: 0, spam: 0, total: 0 };
    for (const row of rows) {
      if (row._id in counts) counts[row._id] = row.count;
      counts.total += row.count;
    }
    return counts;
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

  /**
   * The same status change over a selection.
   *
   * The ids are filtered to well-formed ones and the workspace stays in the query, so a list
   * containing another tenant's id changes nothing rather than partially succeeding.
   */
  async setSubmissionStatuses(
    context: WorkspaceContext,
    projectId: string,
    submissionIds: readonly string[],
    status: SubmissionStatus,
  ): Promise<number> {
    const ids = toObjectIds(submissionIds);
    if (ids.length === 0) return 0;

    const result = await this.submissions.updateMany(
      { _id: { $in: ids }, workspaceId: context.workspaceId, projectId },
      { $set: { status } },
    );
    return result.modifiedCount;
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

  async deleteSubmissions(
    context: WorkspaceContext,
    projectId: string,
    submissionIds: readonly string[],
  ): Promise<number> {
    const ids = toObjectIds(submissionIds);
    if (ids.length === 0) return 0;

    const result = await this.submissions.deleteMany({
      _id: { $in: ids },
      workspaceId: context.workspaceId,
      projectId,
    });
    return result.deletedCount;
  }

  /**
   * Every matching submission, one at a time.
   *
   * An export is the one read whose size the customer chooses, so it is a cursor rather than an
   * array: loading a year of a busy form into memory to write it straight back out is how one
   * export takes the process down for every tenant on it.
   */
  async *streamSubmissions(
    context: WorkspaceContext,
    projectId: string,
    filter: SubmissionFilter = {},
  ): AsyncGenerator<FormSubmission> {
    const cursor = this.submissions.find(this.submissionQuery(context, projectId, filter), {
      sort: { createdAt: -1 },
    });

    for await (const document of cursor) yield toSubmission(document);
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

/** Well-formed ids only. A malformed one is dropped rather than thrown, so one bad id in a bulk
    selection cannot fail the whole action. */
function toObjectIds(ids: readonly string[]): ObjectId[] {
  return ids.filter((id) => ObjectId.isValid(id) && id.length === 24).map((id) => new ObjectId(id));
}

/** Stable content fingerprint used only for duplicate suppression. */
function fingerprintOf(values: SubmissionValues): string {
  return JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
}

function toDefinition(document: DefinitionDocument): FormDefinition {
  const { _id, ...rest } = document;
  // A definition written before revisions existed is revision 1: it has been edited zero times
  // since, which is exactly what that number means.
  return { ...rest, revision: rest.revision ?? 1, id: _id.toHexString() };
}

function toSubmission(document: SubmissionDocument): FormSubmission {
  const { _id, fingerprint: _f, ...rest } = document;
  // A submission stored before revisions and field snapshots existed answered revision 1 and kept
  // no copy of the questions. Saying so is better than inventing either.
  return { ...rest, formRevision: rest.formRevision ?? 1, fields: rest.fields ?? [], id: _id.toHexString() };
}
