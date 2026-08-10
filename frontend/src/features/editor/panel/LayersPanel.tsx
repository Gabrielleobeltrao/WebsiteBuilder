import type { BuilderElement } from "@websitebuilder/shared";
import { useTranslation } from "react-i18next";

import { selectCurrentPage, useEditorStore } from "@/features/editor/store/editorStore";

/**
 * Layers is the recovery path: locked and hidden elements cannot be reached on the canvas, so this
 * is where a user selects them to inspect or restore them.
 */
function ElementRow({ element, depth }: { element: BuilderElement; depth: number }) {
  const { t } = useTranslation("builder");
  const select = useEditorStore((state) => state.select);
  const selection = useEditorStore((state) => state.ui.selection);
  const selected = selection?.kind === "element" && selection.elementId === element.id;

  return (
    <>
      <li>
        <button
          type="button"
          onClick={() => select({ kind: "element", elementId: element.id })}
          aria-current={selected ? "true" : undefined}
          style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
          className={[
            "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs",
            selected ? "bg-accent-50 text-ink-900" : "text-ink-700 hover:bg-ink-50",
          ].join(" ")}
        >
          <span className="truncate">{element.name || t(`elements.${element.type}`)}</span>
          <span className="flex shrink-0 gap-1 text-[10px] text-ink-500">
            {element.locked && <span>{t("layers.locked")}</span>}
            {element.hidden && <span>{t("layers.hidden")}</span>}
          </span>
        </button>
      </li>
      {element.type === "container" &&
        element.children.map((child) => <ElementRow key={child.id} element={child} depth={depth + 1} />)}
    </>
  );
}

export function LayersPanel() {
  const { t } = useTranslation("builder");
  const page = useEditorStore(selectCurrentPage);
  const select = useEditorStore((state) => state.select);
  const selection = useEditorStore((state) => state.ui.selection);

  const isEmpty = (page?.sections ?? []).every((section) => section.elements.length === 0);

  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500">{t("layers.title")}</h2>
      {page === null || isEmpty ? (
        <p className="text-xs text-ink-500">{t("layers.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {page.sections.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => select({ kind: "section", sectionId: section.id })}
                aria-current={
                  selection?.kind === "section" && selection.sectionId === section.id ? "true" : undefined
                }
                className="w-full truncate rounded px-2 py-1.5 text-left text-xs font-semibold text-ink-800
                  hover:bg-ink-50"
              >
                {section.name || t("elements.section")}
              </button>
              <ul>
                {section.elements.map((element) => (
                  <ElementRow key={element.id} element={element} depth={1} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
