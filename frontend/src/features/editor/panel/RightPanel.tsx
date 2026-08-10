import type { BuilderElement, BuilderPage, BuilderSection } from "@websitebuilder/shared";
import { useTranslation } from "react-i18next";

import type { PanelMode } from "@/features/editor/store/editorStore";
import { NON_INSPECTOR_MODES, type PanelView } from "./panelMachine";

/**
 * The single right-hand region. Its width is fixed so changing modes never resizes or horizontally
 * jumps the canvas — only the content inside it is replaced.
 */

const INSPECTOR_GROUPS = ["content", "style", "layout", "responsive", "advanced"] as const;

function findElement(sections: readonly BuilderSection[], elementId: string): BuilderElement | null {
  for (const section of sections) {
    const found = search(section.elements, elementId);
    if (found) return found;
  }
  return null;
}

function search(elements: readonly BuilderElement[], elementId: string): BuilderElement | null {
  for (const element of elements) {
    if (element.id === elementId) return element;
    if (element.type === "container") {
      const nested = search(element.children, elementId);
      if (nested) return nested;
    }
  }
  return null;
}

function ModeTabs({ active, onChange }: { active: PanelMode; onChange: (mode: PanelMode) => void }) {
  const { t } = useTranslation("builder");
  return (
    <div role="tablist" aria-label={t("panel.label")} className="flex gap-1 border-b border-ink-100 p-2">
      {NON_INSPECTOR_MODES.map((mode) => (
        <button
          key={mode}
          role="tab"
          type="button"
          aria-selected={active === mode}
          onClick={() => onChange(mode)}
          className={[
            "flex-1 rounded-md px-2 py-1.5 text-xs font-medium",
            active === mode ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-50",
          ].join(" ")}
        >
          {t(`panel.${mode}`)}
        </button>
      ))}
    </div>
  );
}

function InspectorShell({
  title,
  typeLabel,
  breadcrumb,
  onBack,
}: {
  title: string;
  typeLabel: string;
  breadcrumb: string[];
  onBack: () => void;
}) {
  const { t } = useTranslation("builder");
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-100 p-3">
        <button
          type="button"
          onClick={onBack}
          className="text-xs font-medium text-ink-600 underline underline-offset-2"
        >
          {t("panel.back")}
        </button>
        <nav aria-label={t("panel.breadcrumb")} className="mt-2">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-ink-500">
            {breadcrumb.map((crumb, index) => (
              <li key={`${crumb}-${index}`} className="flex items-center gap-1">
                {index > 0 && <span aria-hidden>/</span>}
                <span>{crumb}</span>
              </li>
            ))}
          </ol>
        </nav>
        <h2 className="mt-2 font-display text-sm font-semibold text-ink-900">{title}</h2>
        <p className="text-xs text-ink-500">{typeLabel}</p>
      </div>

      {/* Phase 5 fills these groups with the shared inspector controls. */}
      <div className="flex-1 overflow-y-auto p-3">
        {INSPECTOR_GROUPS.map((group) => (
          <section key={group} className="border-b border-ink-100 py-3 last:border-b-0">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {t(`inspector.${group}`)}
            </h3>
          </section>
        ))}
      </div>
    </div>
  );
}

export function RightPanel(props: {
  view: PanelView;
  page: BuilderPage | null;
  panelMode: PanelMode;
  onPanelMode: (mode: PanelMode) => void;
  onBack: () => void;
  renderMode: (mode: PanelMode) => React.ReactNode;
}) {
  const { t } = useTranslation("builder");
  const { view, page } = props;

  if (view.kind === "elementInspector") {
    const element = page ? findElement(page.sections, view.elementId) : null;
    return (
      <InspectorShell
        title={element?.name ?? t("panel.elementInspector")}
        typeLabel={element ? t(`elements.${element.type}`) : t("panel.elementInspector")}
        breadcrumb={[page?.name ?? "", t("panel.sectionInspector"), t("panel.elementInspector")]}
        onBack={props.onBack}
      />
    );
  }

  if (view.kind === "sectionInspector") {
    const section = page?.sections.find((candidate) => candidate.id === view.sectionId) ?? null;
    return (
      <InspectorShell
        title={section?.name ?? t("panel.sectionInspector")}
        typeLabel={t("elements.section")}
        breadcrumb={[page?.name ?? "", t("panel.sectionInspector")]}
        onBack={props.onBack}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ModeTabs active={props.panelMode} onChange={props.onPanelMode} />
      <div className="flex-1 overflow-y-auto p-3">{props.renderMode(view.kind)}</div>
    </div>
  );
}
