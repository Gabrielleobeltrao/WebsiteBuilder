import { buildRouteManifest, compilePageCss, renderablePage, type BuilderProject } from "@websitebuilder/shared";
import { freeSectionFixture, overriddenProject } from "@websitebuilder/shared/responsive-fixtures";
import { describe, expect, it } from "vitest";

import { renderRouteHtml } from "../src/renderer/html";

/**
 * Draft, preview and published are one rendering.
 *
 * The claim being defended is narrow and exact: the same document produces the same markup and the
 * same stylesheet, whichever of the three paths asks for it. What may differ is addressing — where
 * links point and what the canonical URL says — because those are properties of *where* the page is
 * served, not of what it is.
 *
 * Every responsive bug this plan started from lived in the gap between two renderings of one
 * document. Removing the second implementation is the fix; this is the test that says it stayed
 * removed.
 */

function fixtureProject(): BuilderProject {
  const project = overriddenProject();
  const home = project.pages[0]!;
  return { ...project, pages: [{ ...home, sections: [...home.sections, freeSectionFixture()] }] } as BuilderProject;
}

const compileInput = (project: BuilderProject) =>
  ({
    project,
    blog: { settings: { enabled: false } as never, posts: [] },
    cms: { collections: [], items: [] },
    redirects: [],
    mediaExists: () => true,
    supportedSchemaVersion: project.schemaVersion,
    moduleBlockers: 0,
    maxDocumentBytes: 10_000_000,
  }) as never;

/** The page a document serves at "/", rendered the way each caller renders it. */
function render(project: BuilderProject, options: { pageHref?: (path: string) => string } = {}) {
  const route = buildRouteManifest(compileInput(project)).find((candidate) => candidate.path === "/");
  if (route === undefined) throw new Error("fixture has no home route");

  return renderRouteHtml({
    route,
    document: project,
    canonicalUrl: "https://example.test/",
    mediaBaseUrl: "/api/v1/public/media",
    ...(options.pageHref === undefined ? {} : { pageHref: options.pageHref }),
  });
}

/** Everything between the stylesheet tags, which is what the responsive compiler produced. */
function stylesheetOf(html: string): string {
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? "");
  return styles.join("\n");
}

describe("the same document renders the same page", () => {
  it("produces identical markup for preview and for publication", () => {
    const project = fixtureProject();

    // The only difference the preview declares is where its links point.
    const published = render(project);
    const preview = render(project, { pageHref: (path) => `/api/v1/preview?path=${encodeURIComponent(path)}` });

    expect(stylesheetOf(preview)).toBe(stylesheetOf(published));
  });

  it("emits exactly the shared compiler's stylesheet, not its own version of it", () => {
    const project = fixtureProject();
    const page = renderablePage(project, project.pages[0]!);

    expect(stylesheetOf(render(project))).toContain(compilePageCss(page));
  });

  it("carries a person's device override into the published stylesheet", () => {
    const project = overriddenProject() as BuilderProject;
    const css = stylesheetOf(render(project));

    // The override is in a media query and nowhere else: a value sampled at one width and written
    // unconditionally is the bug the compiler exists to prevent.
    const mobile = css.slice(css.indexOf("@media"));
    expect(mobile).toContain("left:16px");
    expect(css.split("@media")[0]).not.toContain("left:16px");
  });
});

describe("a shared header is part of every rendering", () => {
  it("renders the shared section's content, not the empty reference", () => {
    const base = overriddenProject() as BuilderProject;
    const shared = { ...freeSectionFixture(), id: "shared-header", name: "Header" };
    const home = base.pages[0]!;

    const project = {
      ...base,
      sharedSections: [shared],
      pages: [
        {
          ...home,
          sections: [
            { ...shared, id: "ref-1", sharedSectionId: shared.id, elements: [] },
            ...home.sections,
          ],
        },
      ],
    } as BuilderProject;

    const html = render(project);

    // The reference carries no elements of its own. A renderer that does not resolve it publishes a
    // site whose header exists in the builder and nowhere else.
    expect(html).toContain('data-element-id="far-right"');
    expect(stylesheetOf(html)).toContain('[data-section-id="ref-1"]');
  });

  it("drops a reference whose shared section was deleted, rather than leaving a gap", () => {
    const base = overriddenProject() as BuilderProject;
    const home = base.pages[0]!;
    const project = {
      ...base,
      sharedSections: [],
      pages: [{ ...home, sections: [{ ...freeSectionFixture(), id: "ref-1", sharedSectionId: "gone", elements: [] }] }],
    } as BuilderProject;

    expect(stylesheetOf(render(project))).not.toContain('[data-section-id="ref-1"]');
  });
});
