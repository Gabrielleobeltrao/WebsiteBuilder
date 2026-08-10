import { createProjectDocument, type BuilderProject, type SiteFeatureState } from "@websitebuilder/shared";
import { describe, expect, it } from "vitest";

import { reconcileSiteStatus, type ModuleFacts } from "../src/modules/projects/status";

const project = (overrides: Partial<BuilderProject> = {}): BuilderProject => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceId: "w1",
  createdByUserId: "u1",
  revision: 4,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...createProjectDocument({ name: "Acme", slug: "acme" }),
  ...overrides,
});

const facts = (overrides: Partial<ModuleFacts> = {}): ModuleFacts => ({
  hasRecords: false,
  explicitlyActivated: false,
  blockingIssueCount: 0,
  warningCount: 0,
  ...overrides,
});

const withForm = () => {
  const base = project();
  const section = base.pages[0]?.sections[0];
  if (!section) throw new Error("fixture is missing its section");
  section.elements.push({ type: "form", id: "f1" } as never);
  return base;
};

const state = (status: SiteStatusFeature, feature: string) =>
  status.features.find((candidate) => candidate.feature === feature);

type SiteStatusFeature = { features: SiteFeatureState[] };

describe("reconcileSiteStatus", () => {
  it("reports every optional module, so navigation never has to guess", () => {
    const status = reconcileSiteStatus({ project: project(), facts: {} });
    expect(status.features.map((feature) => feature.feature).sort()).toEqual(["blog", "cms", "forms", "search"]);
  });

  it("leaves untouched modules unused, and therefore hidden and non-blocking", () => {
    const status = reconcileSiteStatus({ project: project(), facts: {} });

    expect(status.features.every((feature) => feature.lifecycle === "unused")).toBe(true);
    expect(status.blocked).toBe(false);
  });

  it("marks a module in use as soon as a page references it", () => {
    const status = reconcileSiteStatus({ project: withForm(), facts: {} });
    expect(state(status, "forms")?.lifecycle).toBe("draft");
    expect(state(status, "blog")?.lifecycle).toBe("unused");
  });

  it("blocks publication only for a module that is both in use and incomplete", () => {
    const blocked = reconcileSiteStatus({
      project: withForm(),
      facts: { forms: facts({ blockingIssueCount: 1 }) },
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.blockingIssueCount).toBe(1);

    const unusedButBroken = reconcileSiteStatus({
      project: project(),
      facts: { forms: facts({ blockingIssueCount: 5 }) },
    });
    expect(unusedButBroken.blocked).toBe(false);
    expect(unusedButBroken.blockingIssueCount).toBe(0);
  });

  it("shows a module that was explicitly activated with nothing placed yet", () => {
    const status = reconcileSiteStatus({ project: project(), facts: { blog: facts({ explicitlyActivated: true }) } });
    expect(state(status, "blog")?.lifecycle).toBe("needs_setup");
  });

  it("archives a module whose records outlived its last reference", () => {
    const status = reconcileSiteStatus({ project: project(), facts: { blog: facts({ hasRecords: true }) } });
    expect(state(status, "blog")?.lifecycle).toBe("archived");
  });

  it("stamps the project revision so a stale projection is detectable", () => {
    const status = reconcileSiteStatus({ project: project({ revision: 9 }), facts: {} });
    expect(status.revision).toBe(9);
    expect(status.features.every((feature) => feature.sourceRevision === 9)).toBe(true);
  });

  it("ignores a stale lifecycle stored on the project", () => {
    const stale = project({
      featureStates: [
        {
          feature: "forms",
          lifecycle: "published",
          draftReferenceCount: 3,
          publishedReferenceCount: 3,
          blockingIssueCount: 0,
          warningCount: 0,
          sourceRevision: 1,
        },
      ],
    });

    const status = reconcileSiteStatus({ project: stale, facts: {} });
    expect(state(status, "forms")?.lifecycle).toBe("unused");
    expect(state(status, "forms")?.draftReferenceCount).toBe(0);
  });

  it("does not claim published references before a site has been published", () => {
    const status = reconcileSiteStatus({ project: withForm(), facts: {} });
    expect(state(status, "forms")?.publishedReferenceCount).toBe(0);
  });

  it("counts warnings only for modules that are in use", () => {
    const status = reconcileSiteStatus({
      project: withForm(),
      facts: { forms: facts({ warningCount: 2 }), cms: facts({ warningCount: 7 }) },
    });
    expect(status.warningCount).toBe(2);
  });
});
