import type { BuilderPage, BuilderSection } from "@websitebuilder/shared";

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

  return (
    <section
      style={sectionStyle(section, breakpointId, width === undefined ? {} : { width })}
      data-section-id={section.id}
    >
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
    <div style={{ backgroundColor: page.canvas.backgroundColor, minHeight: page.canvas.minHeight }}>
      {page.sections.map((section) => (
        <SectionRenderer key={section.id} section={section} breakpointId={breakpointId} width={width} />
      ))}
    </div>
  );
}
