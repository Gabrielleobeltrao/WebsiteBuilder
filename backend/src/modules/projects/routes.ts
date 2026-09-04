import {
  builderDocumentInputSchema,
  createProjectInputSchema,
  renameProjectInputSchema,
  resourceIdSchema,
  projectSlugSchema,
  type ProjectSummary,
  type PublicationState,
} from "@websitebuilder/shared";
import { Router, type RequestHandler } from "express";
import { z } from "zod";

import { ApiProblem, zodProblem } from "../../middleware/errors";
import type { Permission } from "../workspaces/permissions";
import type { WorkspaceContext } from "./repository";
import { ProjectRepository, RevisionConflictError, SlugTakenError, UnsupportedDocumentError } from "./repository";
import { auditProjectReadiness } from "@websitebuilder/shared";
import { reconcileSiteStatus, type ModuleFacts } from "./status";
import type { BuilderProject, SiteFeatureKey } from "@websitebuilder/shared";

/**
 * Resolves the verified tenant context for a request. Phase 7 replaces the seeded implementation
 * with Better Auth session plus organization membership; the route contract does not change,
 * because routes never read a workspace ID from the body or a header themselves.
 */
export type WorkspaceResolver = (
  req: Parameters<RequestHandler>[0],
  required?: Permission,
) => Promise<WorkspaceContext>;

const saveDocumentBodySchema = z
  .object({ revision: z.number().int().nonnegative(), document: builderDocumentInputSchema })
  .strict();

function parseProjectId(value: unknown): string {
  const parsed = resourceIdSchema.safeParse(value);
  // A malformed ID is answered as "not found", not "invalid": probing IDs must not reveal which
  // shapes exist.
  if (!parsed.success) throw new ApiProblem("NOT_FOUND", "Project not found");
  return parsed.data;
}

export function createProjectsRouter(options: {
  repository: ProjectRepository;
  resolveWorkspace: WorkspaceResolver;
  /**
   * Reads each optional module's own records. Injected so the projection is assembled from real
   * sources rather than from anything the caller sends.
   */
  /** Fills in what each site card shows, for the whole page in one batch. */
  attachCardSummaries?: (context: WorkspaceContext, projects: ProjectSummary[]) => Promise<ProjectSummary[]>;
  /** The workspace's own media ids, so a missing image is told apart from an unchecked one. */
  loadOwnedMediaIds?: (input: { workspaceId: string }) => Promise<Set<string>>;
  /**
   * The publication a visitor is currently receiving, or null when nothing is live.
   *
   * When it happened matters as much as what it was compiled from: a post written after the site
   * was last published is saved, published as a post, and still not on the site — three states the
   * blog dashboard has to be able to tell apart.
   */
  loadActivePublication?: (input: {
    workspaceId: string;
    projectId: string;
  }) => Promise<{ sourceRevision: number; publishedAt: string; sourceFingerprint?: string } | null>;
  /**
   * What this site's publishable sources amount to right now.
   *
   * Compared with the fingerprint the live version was published with. Without it, "unpublished
   * changes" could only mean the builder document: posts, blog settings and the two layouts live in
   * their own collections and never touch the project's revision, so a customer could publish a post
   * and be told their site was up to date.
   */
  loadCurrentFingerprint?: (input: { workspaceId: string; projectId: string }) => Promise<string | null>;
  collectModuleFacts?: (input: {
    workspaceId: string;
    projectId: string;
  }) => Promise<Partial<Record<SiteFeatureKey, ModuleFacts>>>;
  /** The document currently serving visitors, so the projection can say what is actually live. */
  loadPublishedDocument?: (input: { workspaceId: string; projectId: string }) => Promise<BuilderProject | null>;
}): Router {
  const {
    repository,
    resolveWorkspace,
    collectModuleFacts,
    loadPublishedDocument,
    loadOwnedMediaIds,
    loadActivePublication,
    loadCurrentFingerprint,
  } = options;
  // mergeParams: the router is mounted under /workspaces/:workspaceId.
  const router = Router({ mergeParams: true });

  router.get("/", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
      const summaries = await repository.listSummaries(context, clientId ? { clientId } : {});
      // One batched pass for the whole page. A card that asked its own question would be one
      // request per site, which gets slower with every site a customer adds.
      res.json({ data: options.attachCardSummaries === undefined ? summaries : await options.attachCardSummaries(context, summaries) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:create");
      const parsed = createProjectInputSchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      const project = await repository.create(context, parsed.data);
      res.status(201).json({ data: project });
    } catch (error) {
      next(mapDomainError(error));
    }
  });

  router.get("/:projectId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      /*
       * Missing and unreadable are different answers.
       *
       * `findById` returns null for both, so a document this build cannot parse looked exactly like
       * a project in somebody else's workspace — and the person was told their site did not exist.
       */
      const diagnosis = await repository.diagnose(context, parseProjectId(req.params.projectId));
      if (diagnosis === null) throw new ApiProblem("NOT_FOUND", "Project not found");
      if (diagnosis.document === null) throw new UnsupportedDocumentError(diagnosis);

      res.json({ data: diagnosis.document });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:projectId/status", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseProjectId(req.params.projectId);
      const project = await repository.findById(context, projectId);
      if (project === null) throw new ApiProblem("NOT_FOUND", "Project not found");

      const [facts, published, ownedMedia, activePublication, currentFingerprint] = await Promise.all([
        collectModuleFacts?.({ workspaceId: context.workspaceId, projectId }) ?? Promise.resolve({}),
        loadPublishedDocument?.({ workspaceId: context.workspaceId, projectId }) ?? Promise.resolve(null),
        loadOwnedMediaIds?.({ workspaceId: context.workspaceId }) ?? Promise.resolve(null),
        loadActivePublication?.({ workspaceId: context.workspaceId, projectId }) ?? Promise.resolve(null),
        loadCurrentFingerprint?.({ workspaceId: context.workspaceId, projectId }) ?? Promise.resolve(null),
      ]);

      /*
       * Readiness is computed here, bound to the revision it was computed from.
       *
       * The dashboard was handed an empty object, so every category reported "not checked" and the
       * panel could say nothing else. Four audits exist and none of them was being run.
       *
       * The media check is a dependency of the truth, not a detail: without the workspace's own
       * media ids, a missing image cannot be told from one this build simply could not look up, and
       * the links category would report clean for a reason that has nothing to do with the links.
       */
      const readiness =
        ownedMedia === null
          ? {}
          : auditProjectReadiness({ project, mediaExists: (mediaId) => ownedMedia.has(mediaId) });

      res.json({
        data: {
          ...reconcileSiteStatus({ project, facts, published }),
          readiness,
          // What a visitor is receiving, against what the person has saved since.
          activeSourceRevision: activePublication?.sourceRevision ?? null,
          // When they received it. A post saved after this moment is not on the site, whatever the
          // post's own status says.
          activePublishedAt: activePublication?.publishedAt ?? null,
          /*
           * Whether a visitor is behind, across every publishable source.
           *
           * The fingerprint covers the document, the blog's settings, the posts a publication would
           * include and each layout's published version — so a post written after the last
           * publication counts, and it did not when this compared revisions alone. A version
           * published before fingerprints existed carries none, and that falls back to the revision
           * comparison rather than guessing: an old snapshot cannot answer a question it never
           * recorded.
           */
          publicationState: publicationStateFor({
            projectRevision: project.revision,
            active: activePublication,
            currentFingerprint,
          }),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:projectId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const parsed = renameProjectInputSchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      const project = await repository.rename(context, parseProjectId(req.params.projectId), parsed.data.name);
      if (project === null) throw new ApiProblem("NOT_FOUND", "Project not found");
      res.json({ data: project });
    } catch (error) {
      next(mapDomainError(error));
    }
  });

  router.put("/:projectId/document", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const parsed = saveDocumentBodySchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      const projectId = parseProjectId(req.params.projectId);
      /*
       * Missing and unreadable are different answers here too.
       *
       * This read `findById`, which returns null for both, and reported 404 — telling a customer
       * their site did not exist while it sat in the database refusing to parse. The refusal below
       * in the repository never ran, because the route had already answered.
       */
      const diagnosis = await repository.diagnose(context, projectId);
      if (diagnosis === null) throw new ApiProblem("NOT_FOUND", "Project not found");
      if (diagnosis.document === null) throw new UnsupportedDocumentError(diagnosis);

      const existing = diagnosis.document;

      // The slug is part of the public hostname; changing it is its own authorised operation.
      if (parsed.data.document.slug !== existing.slug) {
        throw new ApiProblem("VALIDATION_ERROR", "Project slug cannot be changed through the document endpoint", [
          { path: "document.slug", message: "must match the stored project slug" },
        ]);
      }
      if (!projectSlugSchema.safeParse(parsed.data.document.slug).success) {
        throw new ApiProblem("VALIDATION_ERROR", "Project slug is not a valid platform hostname label");
      }

      const project = await repository.saveDocument(context, projectId, parsed.data.revision, parsed.data.document);
      res.json({ data: project });
    } catch (error) {
      next(mapDomainError(error));
    }
  });

  router.delete("/:projectId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:delete");
      const deleted = await repository.delete(context, parseProjectId(req.params.projectId));
      if (!deleted) throw new ApiProblem("NOT_FOUND", "Project not found");
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * One rule for "has this site got work a visitor has not received", used by the status endpoint and
 * by the batched card summaries so the two can never disagree.
 */
export function publicationStateFor(input: {
  projectRevision: number;
  active: { sourceRevision: number; sourceFingerprint?: string } | null;
  currentFingerprint: string | null;
}): PublicationState {
  // Nothing is live, so everything saved is waiting.
  if (input.active === null) return input.projectRevision > 0 ? "pending" : "up-to-date";

  if (input.active.sourceFingerprint !== undefined && input.currentFingerprint !== null) {
    return input.active.sourceFingerprint === input.currentFingerprint ? "up-to-date" : "pending";
  }

  /*
   * A version published before source fingerprints existed, or sources that could not be read.
   *
   * Its revision describes the builder document and nothing else, so a document that has moved is
   * still proof of unpublished work — but a document that has not moved proves nothing at all: a
   * post, a layout or a blog setting could have changed since with no record to compare against.
   * Answering "up to date" there would be the product asserting what it cannot know, so it says so
   * instead, and one publication replaces the guess with a fact.
   */
  return input.projectRevision > input.active.sourceRevision ? "pending" : "unknown";
}

function mapDomainError(error: unknown): unknown {
  if (error instanceof RevisionConflictError) {
    return new ApiProblem("REVISION_CONFLICT", "Document was modified after it was loaded", [
      { path: "revision", message: `current revision is ${error.currentRevision}` },
    ]);
  }
  if (error instanceof SlugTakenError) {
    return new ApiProblem("SLUG_TAKEN", "That address is already in use");
  }
  return error;
}
