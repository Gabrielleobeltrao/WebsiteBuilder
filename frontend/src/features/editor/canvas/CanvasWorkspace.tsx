import { DESIGN_WIDTH, serializeLength, type BuilderPage } from "@websitebuilder/shared";
import { useTranslation } from "react-i18next";

import { useEditorStore } from "@/features/editor/store/editorStore";

/**
 * Scrollable workspace holding the scaled logical canvas.
 *
 * Zoom is applied as a CSS transform on a fixed logical width, so the document's stored geometry is
 * independent of how the editor is displayed. Phase 4 adds the shared element renderer and the
 * Moveable interaction layer on top of this same coordinate system.
 */
export function CanvasWorkspace({ page }: { page: BuilderPage | null }) {
  const { t } = useTranslation("builder");
  const zoom = useEditorStore((state) => state.ui.zoom);
  const select = useEditorStore((state) => state.select);
  const selection = useEditorStore((state) => state.ui.selection);

  if (page === null) return null;

  return (
    <div className="h-full overflow-auto bg-ink-100 p-8">
      <div
        role="group"
        aria-label={t("canvas.label")}
        onClick={(event) => {
          // Clicking the empty workspace clears the selection and returns the panel to its mode.
          if (event.target === event.currentTarget) select(null);
        }}
        style={{ width: DESIGN_WIDTH * zoom }}
        className="mx-auto"
      >
        <div
          style={{
            width: DESIGN_WIDTH,
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
            backgroundColor: page.canvas.backgroundColor,
            minHeight: page.canvas.minHeight,
          }}
          className="shadow-sm"
        >
          {page.sections.map((section) => {
            const height = section.heightByBreakpoint.desktop;
            const isSelected = selection?.kind === "section" && selection.sectionId === section.id;
            return (
              <section
                key={section.id}
                aria-label={section.name}
                onClick={(event) => {
                  event.stopPropagation();
                  select({ kind: "section", sectionId: section.id });
                }}
                style={{
                  backgroundColor: section.backgroundColor,
                  minHeight: height ? serializeLength(height) : undefined,
                }}
                className={[
                  "relative",
                  // Editor-only affordance: it must never reach preview or published output.
                  isSelected ? "outline outline-2 -outline-offset-2 outline-accent-600" : "",
                ].join(" ")}
              >
                {section.elements.length === 0 && (
                  <p className="p-8 text-center text-sm text-ink-400">{t("canvas.emptySection")}</p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
