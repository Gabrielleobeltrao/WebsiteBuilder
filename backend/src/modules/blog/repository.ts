import {
  DEFAULT_BLOG_SETTINGS,
  normalizePostSlug,
  type BlogPost,
  type BlogPostInput,
  type BlogSettings,
} from "@websitebuilder/shared";
import { ObjectId, type Collection, type Db } from "mongodb";

import type { WorkspaceContext } from "../projects/repository";

/**
 * Blog persistence.
 *
 * Posts live in their own collection rather than inside the builder document, because they have an
 * independent publishing lifecycle and a growing list must be queryable and paginable without
 * loading a whole site. Every query is scoped by workspace **and** project: a post id alone is
 * never enough to reach a record.
 */

export const BLOG_COLLECTIONS = {
  posts: "blogPosts",
  categories: "blogCategories",
  settings: "blogSettings",
} as const;

type PostDocument = Omit<BlogPost, "id"> & { _id: ObjectId };
type SettingsDocument = BlogSettings & { workspaceId: string; projectId: string };

export class SlugTakenError extends Error {
  constructor(public readonly slug: string) {
    super(`Post slug ${slug} is already used in this blog`);
    this.name = "SlugTakenError";
  }
}

/**
 * Somebody else saved this post since it was read.
 *
 * Answered rather than merged: the two versions are prose, and a machine choosing between them
 * would quietly destroy one person's paragraph. The author is told, and decides.
 */
export class PostConflictError extends Error {
  constructor() {
    super("The post changed since it was loaded");
    this.name = "PostConflictError";
  }
}

export type PostListFilter = {
  status?: "draft" | "published";
  search?: string;
  categoryId?: string;
  page?: number;
  perPage?: number;
};

export type PostPage = { items: BlogPost[]; total: number; page: number; perPage: number };

export async function ensureBlogIndexes(db: Db): Promise<void> {
  await db.collection(BLOG_COLLECTIONS.posts).createIndexes([
    { key: { projectId: 1, slug: 1 }, name: "project_slug_unique", unique: true },
    { key: { projectId: 1, status: 1, updatedAt: -1 }, name: "dashboard" },
    { key: { projectId: 1, status: 1, publishedAt: -1 }, name: "public_feed" },
    { key: { workspaceId: 1, projectId: 1, updatedAt: -1 }, name: "workspace_project_recent" },
  ]);
  await db
    .collection(BLOG_COLLECTIONS.settings)
    .createIndexes([{ key: { workspaceId: 1, projectId: 1 }, name: "project_unique", unique: true }]);
}

export class BlogRepository {
  private readonly posts: Collection<PostDocument>;
  private readonly settings: Collection<SettingsDocument>;

  constructor(db: Db) {
    this.posts = db.collection<PostDocument>(BLOG_COLLECTIONS.posts);
    this.settings = db.collection<SettingsDocument>(BLOG_COLLECTIONS.settings);
  }

  /**
   * Enabled blogs and their template references, for the repair audit.
   *
   * Deliberately not workspace-scoped by default: this answers "how many sites are in this state",
   * which is an operator question. Every other read in this repository takes a context first, and
   * this one is the exception that has to be argued for rather than assumed — so it is separate,
   * named for its purpose, and reachable only from the audit.
   */
  async listSettingsForAudit(
    options: { workspaceId?: string } = {},
  ): Promise<Array<{ workspaceId: string; projectId: string; indexTemplateId?: string; articleTemplateId?: string }>> {
    const rows = await this.settings
      .find({
        enabled: true,
        ...(options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId }),
      })
      .toArray();

    return rows.map((row) => ({
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      ...(row.indexTemplateId === undefined ? {} : { indexTemplateId: row.indexTemplateId }),
      ...(row.articleTemplateId === undefined ? {} : { articleTemplateId: row.articleTemplateId }),
    }));
  }

  async loadSettings(context: WorkspaceContext, projectId: string): Promise<BlogSettings> {
    const document = await this.settings.findOne({ workspaceId: context.workspaceId, projectId });
    if (document === null) return { ...DEFAULT_BLOG_SETTINGS };
    const { workspaceId: _w, projectId: _p, ...settings } = document;
    return settings;
  }

  /**
   * Saves blog settings. Disabling the blog only flips the flag: posts, categories and templates
   * are left untouched, because "hide the public routes" and "destroy the editorial archive" are
   * very different requests and only one of them was made.
   */
  async saveSettings(context: WorkspaceContext, projectId: string, settings: BlogSettings): Promise<BlogSettings> {
    await this.settings.updateOne(
      { workspaceId: context.workspaceId, projectId },
      { $set: { ...settings, workspaceId: context.workspaceId, projectId } },
      { upsert: true },
    );
    return settings;
  }

  async list(context: WorkspaceContext, projectId: string, filter: PostListFilter = {}): Promise<PostPage> {
    const page = Math.max(1, filter.page ?? 1);
    const perPage = Math.min(100, Math.max(1, filter.perPage ?? 20));

    const query: Record<string, unknown> = { workspaceId: context.workspaceId, projectId };
    if (filter.status) query.status = filter.status;
    if (filter.categoryId) query.categoryIds = filter.categoryId;
    if (filter.search) {
      // Escaped so a search string can never be interpreted as a pattern.
      const escaped = filter.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.title = { $regex: escaped, $options: "i" };
    }

    const [items, total] = await Promise.all([
      this.posts
        .find(query, { sort: { updatedAt: -1 }, skip: (page - 1) * perPage, limit: perPage })
        .toArray(),
      this.posts.countDocuments(query),
    ]);

    return { items: items.map(toPost), total, page, perPage };
  }

  async findById(context: WorkspaceContext, projectId: string, postId: string): Promise<BlogPost | null> {
    if (!ObjectId.isValid(postId) || postId.length !== 24) return null;
    const document = await this.posts.findOne({
      _id: new ObjectId(postId),
      workspaceId: context.workspaceId,
      projectId,
    });
    return document === null ? null : toPost(document);
  }

  /** Public lookup: only a published post ever resolves, whatever the slug. */
  async findPublishedBySlug(projectId: string, slug: string): Promise<BlogPost | null> {
    const document = await this.posts.findOne({ projectId, slug, status: "published" });
    return document === null ? null : toPost(document);
  }

  async listPublished(projectId: string, options: { page?: number; perPage?: number } = {}): Promise<PostPage> {
    const page = Math.max(1, options.page ?? 1);
    const perPage = Math.min(48, Math.max(1, options.perPage ?? 12));

    const query = { projectId, status: "published" as const };
    const [items, total] = await Promise.all([
      this.posts
        .find(query, { sort: { publishedAt: -1 }, skip: (page - 1) * perPage, limit: perPage })
        .toArray(),
      this.posts.countDocuments(query),
    ]);
    return { items: items.map(toPost), total, page, perPage };
  }

  async create(context: WorkspaceContext, projectId: string, input: BlogPostInput): Promise<BlogPost> {
    const now = new Date().toISOString();
    const slug = await this.allocateSlug(projectId, input.slug || input.title);

    const document = {
      ...input,
      slug,
      workspaceId: context.workspaceId,
      projectId,
      createdByUserId: context.userId,
      ...(input.status === "published" ? { publishedAt: input.publishedAt ?? now } : {}),
      createdAt: now,
      updatedAt: now,
    } as Omit<PostDocument, "_id">;

    try {
      const result = await this.posts.insertOne(document as PostDocument);
      return toPost({ ...document, _id: result.insertedId } as PostDocument);
    } catch (error) {
      if (isDuplicateKey(error)) throw new SlugTakenError(slug);
      throw error;
    }
  }

  async update(
    context: WorkspaceContext,
    projectId: string,
    postId: string,
    input: BlogPostInput,
    /**
     * The version the author was looking at, as its `updatedAt`.
     *
     * A post has no revision counter, so this is what a stale write can be detected by. Without it
     * two tabs, or one person on two devices, silently overwrite each other and the loser is never
     * told — the same failure the builder's revision check exists to prevent. Omitted, the write
     * proceeds: the check belongs to callers that read the post first.
     */
    expectedUpdatedAt?: string,
  ): Promise<BlogPost | null> {
    const existing = await this.findById(context, projectId, postId);
    if (existing === null) return null;
    if (expectedUpdatedAt !== undefined && existing.updatedAt !== expectedUpdatedAt) {
      throw new PostConflictError();
    }

    const slug =
      input.slug && input.slug !== existing.slug
        ? await this.allocateSlug(projectId, input.slug, postId)
        : existing.slug;

    const now = new Date().toISOString();
    try {
      const updated = await this.posts.findOneAndUpdate(
        { _id: new ObjectId(postId), workspaceId: context.workspaceId, projectId },
        {
          $set: {
            ...input,
            slug,
            updatedAt: now,
            // Publishing stamps a date once; re-saving a published post must not move it.
            ...(input.status === "published"
              ? { publishedAt: existing.publishedAt ?? input.publishedAt ?? now }
              : {}),
          },
        },
        { returnDocument: "after" },
      );
      return updated === null ? null : toPost(updated);
    } catch (error) {
      if (isDuplicateKey(error)) throw new SlugTakenError(slug);
      throw error;
    }
  }

  async setStatus(
    context: WorkspaceContext,
    projectId: string,
    postId: string,
    status: "draft" | "published",
  ): Promise<BlogPost | null> {
    const existing = await this.findById(context, projectId, postId);
    if (existing === null) return null;

    const now = new Date().toISOString();
    const updated = await this.posts.findOneAndUpdate(
      { _id: new ObjectId(postId), workspaceId: context.workspaceId, projectId },
      {
        $set: {
          status,
          updatedAt: now,
          ...(status === "published" ? { publishedAt: existing.publishedAt ?? now } : {}),
        },
      },
      { returnDocument: "after" },
    );
    return updated === null ? null : toPost(updated);
  }

  async delete(context: WorkspaceContext, projectId: string, postId: string): Promise<boolean> {
    if (!ObjectId.isValid(postId) || postId.length !== 24) return false;
    const result = await this.posts.deleteOne({
      _id: new ObjectId(postId),
      workspaceId: context.workspaceId,
      projectId,
    });
    return result.deletedCount === 1;
  }

  /** Slugs are unique per blog, so a collision gets a suffix rather than failing the save. */
  private async allocateSlug(projectId: string, desired: string, ignorePostId?: string): Promise<string> {
    const base = normalizePostSlug(desired) || "post";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const existing = await this.posts.findOne({ projectId, slug: candidate }, { projection: { _id: 1 } });
      if (existing === null || (ignorePostId && existing._id.toHexString() === ignorePostId)) return candidate;
    }
    throw new SlugTakenError(base);
  }
}

function toPost(document: PostDocument): BlogPost {
  const { _id, ...rest } = document;
  return { ...rest, id: _id.toHexString() };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
