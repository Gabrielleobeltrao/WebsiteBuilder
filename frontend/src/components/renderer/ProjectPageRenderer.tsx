import {
  serializeContainer,
  serializeContainerRules,
  type BuilderPage,
  type BuilderSection,
} from "@websitebuilder/shared";

import { ElementRenderer } from "./ElementRenderer";
import { isRenderable, sectionStyle } from "./styles";

export function SectionRenderer({
  section,
  breakpointId,
  width,
}: {
  section: BuilderSection;
  breakpointId?: string;
  /** Rendered width. When given, section layout resolves through the breakpoint chain. */
  width?: number;
}) {
  if (section.hidden) return null;

  // Container rules are generated CSS rather than inline styles, because `@container` cannot be
  // expressed in a style attribute. They are built from structured values through the same
  // allowlisted writers as the inline styles, and scoped to this section's own id.
  const containerCss = serializeContainerRules(section.id, section.layoutMode, section.containerRules ?? []);

  return (
    <section
      style={{
        ...sectionStyle(section, breakpointId, width === undefined ? {} : { width }),
        ...serializeContainer(section.container),
      }}
      data-section-id={section.id}
    >
      {containerCss !== "" && <style>{containerCss}</style>}
      {section.elements.filter(isRenderable).map((element) => (
        <ElementRenderer key={element.id} element={element} positioned={section.layoutMode === "free"} />
      ))}
    </section>
  );
}

/**
 * Renders one page. Shared by the editor canvas, the preview route and the published site, so what
 * a designer sees while editing is produced by the same code that serves visitors.
 */
export function ProjectPageRenderer({
  page,
  breakpointId,
  width,
}: {
  page: BuilderPage;
  breakpointId?: string;
  width?: number;
}) {
  return (
    // `data-page-id` is an overlay anchor and the coordinate origin a heatmap measures against, not
    // an identity claim: analytics ingestion resolves the page server-side from the published route
    // manifest and never reads this value back from a browser.
    <div
      style={{ backgroundColor: page.canvas.backgroundColor, minHeight: page.canvas.minHeight }}
      data-page-id={page.id}
    >
      {page.sections.map((section) => (
        <SectionRenderer key={section.id} section={section} breakpointId={breakpointId} width={width} />
      ))}
    </div>
  );
}
