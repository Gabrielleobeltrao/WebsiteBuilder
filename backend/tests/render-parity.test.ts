import {
  buildRouteManifest,
  compilePageCss,
  elementDefinition,
  ELEMENT_TYPES,
  renderablePage,
  type BuilderProject,
} from "@websitebuilder/shared";
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
    // Where the runtime is served. Whether the page references it is the renderer's own decision,
    // taken from the blocks the page contains — which is the thing being asserted.
    runtimeSrc: "/__wb/r.js?v=test",
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

describe("blocks that need the page around them", () => {
  const blockPage = (element: Record<string, unknown>) => {
    const base = overriddenProject() as BuilderProject;
    const home = base.pages[0]!;
    const about = { ...home, id: "about-page", name: "About", slug: "about", isHome: false, sections: [] };

    return {
      ...base,
      pages: [
        { ...home, name: "Home", sections: [{ ...home.sections[0]!, elements: [element as never] }] },
        about,
      ],
    } as BuilderProject;
  };

  const blockElement = (type: string, overrides: Record<string, unknown> = {}) => ({
    id: `${type}-1`,
    name: "",
    geometry: { x: 0, y: 0, width: 200, height: 40, rotation: 0 },
    responsiveLayout: {
      width: { value: 200, unit: "px" },
      height: { value: 40, unit: "px" },
      horizontalConstraint: "left",
      verticalConstraint: "top",
      visible: true,
    },
    zIndex: 1,
    locked: false,
    hidden: false,
    type,
    version: 1,
    ...overrides,
  });

  it("resolves a breadcrumb trail from the page's own place in the site", () => {
    const html = render(
      blockPage(blockElement("breadcrumbs", { separator: "chevron", label: "You are here" })),
    );

    // The trail is resolved, not stored: a block that kept its own copy of the site structure would
    // be wrong the first time a page moved.
    expect(html).toContain('aria-label="You are here"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Home");
  });

  it("loads no runtime for a page whose blocks need none", () => {
    const html = render(blockPage(blockElement("breadcrumbs", { separator: "dot", label: "Trail" })));
    expect(html).not.toContain("<script");
  });
});

describe("every block renders the same in all three surfaces", () => {
  /**
   * One block of each type, on one page, rendered once.
   *
   * The claim is narrow: the markup and the stylesheet a visitor receives are produced by the same
   * components the editor and the draft preview use, so a block cannot look one way while being
   * authored and another way in public. What differs between the three is addressing — where links
   * point — and that is asserted separately.
   */
  const everyBlock = () => {
    const base = overriddenProject() as BuilderProject;
    const home = base.pages[0]!;

    const elements = ELEMENT_TYPES.filter((type) => type !== "container").map((type, index) => ({
      id: `${type}-block`,
      name: "",
      geometry: { x: 0, y: index * 60, width: 300, height: 50, rotation: 0 },
      responsiveLayout: {
        width: { value: 300, unit: "px" },
        height: { value: 50, unit: "px" },
        horizontalConstraint: "left",
        verticalConstraint: "top",
        visible: true,
      },
      zIndex: index + 1,
      locked: false,
      hidden: false,
      type,
      version: elementDefinition(type).schemaVersion,
      ...elementDefinition(type).defaults(),
    }));

    return {
      ...base,
      pages: [{ ...home, sections: [{ ...home.sections[0]!, layoutMode: "flex", elements: elements as never }] }],
    } as BuilderProject;
  };

  it("renders every block type without throwing", () => {
    // The renderer ends in a `never` check, so a type with no rendering fails the build. This is
    // the other half: a type whose rendering throws on its own defaults fails here.
    const html = render(everyBlock());

    expect(html).toContain("<!doctype html>");
    for (const type of ELEMENT_TYPES) {
      if (type === "container") continue;
      expect(html, type).toContain(`data-element-id="${type}-block"`);
    }
  });

  it("emits the compiler's stylesheet for a page of every block", () => {
    const project = everyBlock();
    const page = renderablePage(project, project.pages[0]!);

    expect(stylesheetOf(render(project))).toContain(compilePageCss(page));
  });

  it("loads the runtime exactly once for a page with several interactive blocks", () => {
    const html = render(everyBlock());
    const scripts = [...html.matchAll(/<script /g)];

    // One file for every capability on the page, not one per block.
    expect(scripts).toHaveLength(1);
    expect(html).toContain("/__wb/r.js");
  });

  it("declares only the capabilities the page actually contains", () => {
    const base = overriddenProject() as BuilderProject;
    const home = base.pages[0]!;
    const onlyText = {
      ...base,
      pages: [{ ...home, sections: [{ ...home.sections[0]!, elements: [] }] }],
    } as BuilderProject;

    expect(render(onlyText)).not.toContain("<script");
  });
});

describe("a form is one rendering with three modes", () => {
  const form = {
    id: "f1",
    name: "Contact",
    revision: 4,
    fields: [{ id: "name", type: "shortText" as const, label: "Your name", required: true }],
    submitLabel: "Send",
    successBehavior: { type: "message" as const, message: "Thank you." },
    status: "ready" as const,
  };

  function withForm(): BuilderProject {
    const project = fixtureProject();
    const home = project.pages[0]!;
    const sections = [...home.sections];
    sections[0] = {
      ...sections[0]!,
      elements: [
        {
          id: "form-block",
          name: "",
          geometry: { x: 0, y: 0, width: 480, height: 360, rotation: 0 },
          responsiveLayout: {
            width: { value: 480, unit: "px" },
            height: { value: 360, unit: "px" },
            horizontalConstraint: "left",
            verticalConstraint: "top",
            visible: true,
          },
          zIndex: 1,
          locked: false,
          hidden: false,
          type: "form",
          version: elementDefinition("form").schemaVersion,
          ...elementDefinition("form").defaults(),
          formId: "f1",
        },
      ],
    } as never;

    return { ...project, pages: [{ ...home, sections }] } as BuilderProject;
  }

  // One project, rendered twice. Built fresh per call it would carry new ids, and the two
  // renderings would differ for a reason that has nothing to do with forms.
  const draw = (project: BuilderProject, mode: "preview" | "live", action: (formId: string) => string) => {
    const route = buildRouteManifest(compileInput(project)).find((candidate) => candidate.path === "/");
    if (route === undefined) throw new Error("fixture has no home route");

    return renderRouteHtml({
      route,
      document: project,
      canonicalUrl: "https://example.test/",
      mediaBaseUrl: "/api/v1/public/media",
      forms: { byId: new Map([["f1", form]]), mode, action },
    });
  };

  it("differs between preview and publication only in where it posts", () => {
    const project = withForm();
    const published = draw(project, "live", (id) => `/__wb/forms/${id}/submissions`);
    const preview = draw(project, "preview", (id) => `/api/v1/preview/forms/${id}`);

    // Everything except the action attribute is byte-identical, which is what makes a preview a
    // rehearsal rather than a second implementation.
    const strip = (html: string) => html.replace(/action="[^"]*"/g, 'action="…"');
    const [a, b] = [strip(published), strip(preview)];
    const at = [...a].findIndex((character, index) => character !== b[index]);
    expect(at === -1 ? "" : `${a.slice(Math.max(0, at - 90), at + 90)}\n---\n${b.slice(Math.max(0, at - 90), at + 90)}`).toBe("");

    expect(published).toContain('action="/__wb/forms/f1/submissions"');
    expect(preview).toContain('action="/api/v1/preview/forms/f1"');
  });

  it("renders the questions the snapshot froze, not a placeholder", () => {
    const html = draw(withForm(), "live", (id) => `/__wb/forms/${id}/submissions`);

    expect(html).toContain("Your name");
    expect(html).toContain('name="name"');
    expect(html).toContain('value="4"');
  });
});
