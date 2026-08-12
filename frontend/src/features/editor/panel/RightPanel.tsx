import type { BuilderElement, BuilderPage, BuilderSection } from "@websitebuilder/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import type { PanelMode } from "@/features/editor/store/editorStore";
import { ElementInspector } from "@/features/editor/inspector/ElementInspector";
import { InspectorTabContext, type InspectorTab } from "@/features/editor/inspector/controls";
import { SectionInspector } from "@/features/editor/inspector/SectionInspector";
import { PanelRail } from "./PanelRail";
import { type PanelView } from "./panelMachine";

/**
 * The single right-hand region: one narrow destination rail on the outer edge, one content area
 * beside it. Its total width is fixed, so changing destination — or selecting an element, which
 * swaps the content for an inspector — never resizes or horizontally jumps the canvas.
 */

/** Stable for every element type, so the tab a person is on survives changing selection. */
const INSPECTOR_TABS: InspectorTab[] = ["content", "style", "advanced"];

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

function InspectorShell({
  title,
  typeLabel,
  breadcrumb,
  onBack,
  children,
}: {
  title: string;
  typeLabel: string;
  breadcrumb: string[];
  onBack: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation("builder");
  const [searchParams] = useSearchParams();

  // Component state, deliberately: which tab is open is a view preference and must never reach the
  // document. Keeping it across selections is what makes "select another element and keep editing
  // its colour" work without a second click.
  const [tab, setTab] = useState<InspectorTab>("content");

  /**
   * A readiness finding opens the block *and* the tab holding the field it is about.
   *
   * Applied once per address: after that the tab belongs to the person editing, and re-imposing the
   * URL's choice on every render would fight them.
   */
  const requested = searchParams.get("tab");
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (requested === null || applied.current === requested) return;
    applied.current = requested;
    if (requested === "content" || requested === "style" || requested === "advanced") setTab(requested);
  }, [requested]);

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

        <div role="tablist" aria-label={t("inspector.tabs")} className="mt-3 flex gap-1">
          {INSPECTOR_TABS.map((candidate) => (
            <button
              key={candidate}
              role="tab"
              type="button"
              aria-selected={tab === candidate}
              onClick={() => setTab(candidate)}
              className={[
                "flex-1 rounded-md px-2 py-1 text-xs font-medium",
                tab === candidate ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-50",
              ].join(" ")}
            >
              {t(`inspector.${candidate}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <InspectorTabContext.Provider value={tab}>{children}</InspectorTabContext.Provider>
      </div>
    </div>
  );
}

export function RightPanel(props: {
  view: PanelView;
  page: BuilderPage | null;
  pages: readonly BuilderPage[];
  panelMode: PanelMode;
  onPanelMode: (mode: PanelMode) => void;
  onBack: () => void;
  renderMode: (mode: PanelMode) => React.ReactNode;
}) {
  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <PanelContent {...props} />
      </div>
      <PanelRail active={props.panelMode} onChange={props.onPanelMode} />
    </div>
  );
}

function PanelContent(props: {
  view: PanelView;
  page: BuilderPage | null;
  pages: readonly BuilderPage[];
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
      >
        {element && <ElementInspector element={element} pages={props.pages} />}
      </InspectorShell>
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
      >
        {section && <SectionInspector section={section} />}
      </InspectorShell>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-100 px-3 py-2">
        <h2 className="font-display text-sm font-semibold text-ink-900">{t(`panel.${view.kind}`)}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3">{props.renderMode(view.kind)}</div>
    </div>
  );
}
