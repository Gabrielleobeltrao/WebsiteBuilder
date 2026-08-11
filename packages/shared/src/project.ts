import { z } from "zod";

import {
  builderElementSchema,
  SECTION_LAYOUT_MODES,
  type BuilderElement,
  type SectionLayoutMode,
} from "./elements";
import { createId } from "./ids";
import {
  breakpointDefinitionSchema,
  DEFAULT_BREAKPOINTS,
  DESIGN_WIDTH,
  responsiveLengthSchema,
  type BreakpointDefinition,
} from "./responsive";
import { SCHEMA_VERSION } from "./schema-version";
import {
  createDefaultPageSeo,
  createDefaultSiteSeo,
  pageSeoSettingsSchema,
  siteSeoSettingsSchema,
  type PageSeoSettings,
  type SiteSeoSettings,
} from "./seo";
import {
  containerRuleSchema,
  sectionContainerSchema,
  type ContainerRule,
  type SectionContainer,
} from "./containers";
import { HOME_PAGE_SLUG, pageSlugSchema } from "./slug";

export const SECTION_ROLES = ["content", "header", "footer"] as const;
export type SectionRole = (typeof SECTION_ROLES)[number];

export const builderSectionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().max(120),
    role: z.enum(SECTION_ROLES),
    /** Set when this section is a reference to a project-level shared header or footer. */
    sharedSectionId: z.string().min(1).optional(),
    layoutMode: z.enum(SECTION_LAYOUT_MODES),
    heightByBreakpoint: z.record(z.string(), responsiveLengthSchema),
    layoutByBreakpoint: z.record(z.string(), z.record(z.string(), z.unknown())),
    /** Opt-in: a section becomes a query container only when this says so. */
    container: sectionContainerSchema.optional(),
    containerRules: z.array(containerRuleSchema).max(12).optional(),
    elements: z.array(builderElementSchema),
    backgroundColor: z.string().max(40),
    hidden: z.boolean(),
  })
  .strict();

export type BuilderSection = {
  id: string;
  name: string;
  role: SectionRole;
  sharedSectionId?: string;
  layoutMode: SectionLayoutMode;
  heightByBreakpoint: Record<string, z.infer<typeof responsiveLengthSchema>>;
  layoutByBreakpoint: Record<string, Record<string, unknown>>;
  container?: SectionContainer;
  containerRules?: ContainerRule[];
  elements: BuilderElement[];
  backgroundColor: string;
  hidden: boolean;
};

export const builderPageSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(120),
    slug: pageSlugSchema,
    isHome: z.boolean(),
    order: z.number().int().nonnegative(),
    canvas: z
      .object({
        designWidth: z.literal(DESIGN_WIDTH),
        minHeight: z.number().int().positive().max(100_000),
        backgroundColor: z.string().max(40),
      })
      .strict(),
    seo: pageSeoSettingsSchema,
    sections: z.array(builderSectionSchema),
  })
  .strict();

export type BuilderPage = {
  id: string;
  name: string;
  slug: string;
  isHome: boolean;
  order: number;
  canvas: { designWidth: typeof DESIGN_WIDTH; minHeight: number; backgroundColor: string };
  seo: PageSeoSettings;
  sections: BuilderSection[];
};

export const SITE_FEATURE_KEYS = ["forms", "blog", "cms", "search"] as const;
export type SiteFeatureKey = (typeof SITE_FEATURE_KEYS)[number];

export const SITE_FEATURE_LIFECYCLES = [
  "unused",
  "draft",
  "needs_setup",
  "ready",
  "published",
  "error",
  "archived",
] as const;
export type SiteFeatureLifecycle = (typeof SITE_FEATURE_LIFECYCLES)[number];

export const siteFeatureStateSchema = z
  .object({
    feature: z.enum(SITE_FEATURE_KEYS),
    lifecycle: z.enum(SITE_FEATURE_LIFECYCLES),
    draftReferenceCount: z.number().int().nonnegative(),
    publishedReferenceCount: z.number().int().nonnegative(),
    blockingIssueCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    /** Revision the projection was computed from. A mismatch means it must be reconciled again. */
    sourceRevision: z.number().int().nonnegative(),
    firstUsedAt: z.string().optional(),
    lastUsedAt: z.string().optional(),
    configuredAt: z.string().optional(),
  })
  .strict();

export type SiteFeatureState = z.infer<typeof siteFeatureStateSchema>;

/**
 * The complete editable builder document. `revision` is the optimistic concurrency token: a save
 * carries the revision it was loaded from, and the server rejects a stale one rather than letting
 * the later writer silently discard the earlier one.
 */
export const builderProjectSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal(SCHEMA_VERSION),
    workspaceId: z.string().min(1),
    clientId: z.string().min(1).optional(),
    createdByUserId: z.string().min(1),
    name: z.string().min(1).max(160),
    slug: z.string().min(3).max(63),
    breakpoints: z.array(breakpointDefinitionSchema).min(1),
    pages: z.array(builderPageSchema).min(1),
    sharedSections: z.array(builderSectionSchema),
    seo: siteSeoSettingsSchema,
    featureStates: z.array(siteFeatureStateSchema),
    revision: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type BuilderProject = {
  id: string;
  schemaVersion: typeof SCHEMA_VERSION;
  workspaceId: string;
  clientId?: string;
  createdByUserId: string;
  name: string;
  slug: string;
  breakpoints: BreakpointDefinition[];
  pages: BuilderPage[];
  sharedSections: BuilderSection[];
  seo: SiteSeoSettings;
  featureStates: SiteFeatureState[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};

/** The document body a client may send back. Server-owned fields are never accepted from input. */
export const builderDocumentInputSchema = builderProjectSchema
  .omit({
    id: true,
    workspaceId: true,
    createdByUserId: true,
    revision: true,
    createdAt: true,
    updatedAt: true,
  })
  .strict();

export type BuilderDocumentInput = z.infer<typeof builderDocumentInputSchema>;

export function createEmptySection(role: SectionRole = "content", name = "Section"): BuilderSection {
  return {
    id: createId(),
    name,
    role,
    layoutMode: "free",
    heightByBreakpoint: { desktop: { value: 480, unit: "px" } },
    layoutByBreakpoint: {},
    elements: [],
    backgroundColor: "#ffffff",
    hidden: false,
  };
}

export function createPage(input: { name: string; slug?: string; isHome?: boolean; order?: number }): BuilderPage {
  const isHome = input.isHome ?? false;
  return {
    id: createId(),
    name: input.name,
    slug: isHome ? HOME_PAGE_SLUG : (input.slug ?? ""),
    isHome,
    order: input.order ?? 0,
    canvas: { designWidth: DESIGN_WIDTH, minHeight: 900, backgroundColor: "#ffffff" },
    seo: createDefaultPageSeo(),
    sections: [createEmptySection()],
  };
}

/** A brand new project: one Home page holding one empty free section. */
export function createProjectDocument(input: { name: string; slug: string }): BuilderDocumentInput {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: input.name,
    slug: input.slug,
    breakpoints: DEFAULT_BREAKPOINTS.map((breakpoint) => ({ ...breakpoint })),
    pages: [createPage({ name: "Home", isHome: true, order: 0 })],
    sharedSections: [],
    seo: createDefaultSiteSeo(input.name),
    featureStates: [],
  };
}

export function findHomePage(project: Pick<BuilderProject, "pages">): BuilderPage | null {
  return project.pages.find((page) => page.isHome) ?? project.pages[0] ?? null;
}

export function findPageBySlug(project: Pick<BuilderProject, "pages">, slug: string): BuilderPage | null {
  const normalized = slug.replace(/^\/+|\/+$/g, "");
  if (normalized === "") return findHomePage(project);
  return project.pages.find((page) => page.slug === normalized) ?? null;
}

/** Path a page is served at, used by internal links, the sitemap and the route manifest. */
export function pagePath(page: Pick<BuilderPage, "slug" | "isHome">): string {
  return page.isHome || page.slug === HOME_PAGE_SLUG ? "/" : `/${page.slug}`;
}
