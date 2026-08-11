import {
  ALIGN_VALUES,
  DEFAULT_FLEX_LAYOUT,
  DEFAULT_GRID_LAYOUT,
  FLEX_DIRECTIONS,
  FLEX_WRAPS,
  JUSTIFY_VALUES,
  readFlexLayout,
  readGridLayout,
  resolveSectionForDevice,
  SECTION_LAYOUT_MODES,
  type BuilderSection,
  type SectionLayoutMode,
} from "@websitebuilder/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { describeConversion } from "@/features/editor/store/sections";
import { selectEditingDevice, useEditorStore } from "@/features/editor/store/editorStore";
import { ColorField, InspectorGroup, NumberField, SelectField, TextField, ToggleField } from "./controls";

/**
 * Section inspector.
 *
 * Grid and flex settings are stored as typed fields per breakpoint and serialised by the shared
 * layout module, so what the editor shows and what a visitor receives cannot diverge. Converting a
 * populated section warns first and states exactly what is at stake.
 */
export function SectionInspector({ section }: { section: BuilderSection }) {
  const { t } = useTranslation("builder");
  const store = useEditorStore();
  // The device on the canvas, not a constant. This was hardcoded to desktop, so switching to Mobile
  // and changing a gap silently changed the desktop layout — the worst kind of bug, because the
  // damage is invisible until somebody opens the site on a laptop.
  const device = useEditorStore(selectEditingDevice);
  const [pendingMode, setPendingMode] = useState<SectionLayoutMode | null>(null);
  const key = `section:${section.id}`;

  const patchLayout = (values: Record<string, unknown>) =>
    store.update((document) => ({
      ...document,
      pages: document.pages.map((page) => ({
        ...page,
        sections: page.sections.map((candidate) =>
          candidate.id === section.id
            ? {
                ...candidate,
                layoutByBreakpoint: {
                  ...candidate.layoutByBreakpoint,
                  [device]: { ...(candidate.layoutByBreakpoint[device] ?? {}), ...values },
                },
              }
            : candidate,
        ),
      })),
    }));

  // Read through the inheritance chain rather than from this device's own entry: a device that has
  // never been touched must show what it actually renders, which is what it inherits.
  const resolved = resolveSectionForDevice({
    device,
    heightByBreakpoint: section.heightByBreakpoint,
    layoutByBreakpoint: section.layoutByBreakpoint,
  });
  const grid = readGridLayout(resolved.layout);
  const flex = readFlexLayout(resolved.layout);
  const impact = pendingMode === null ? null : describeConversion(section, pendingMode);

  return (
    <>
      <InspectorGroup titleKey="content">
        <TextField
          label={t("fields.displayName")}
          value={section.name}
          transactionKey={`${key}:name`}
          onChange={(name) => store.renameSection(section.id, name)}
        />
      </InspectorGroup>

      <InspectorGroup titleKey="style">
        <ColorField
          label={t("fields.backgroundColor")}
          value={section.backgroundColor}
          transactionKey={`${key}:background`}
          onChange={(color) => store.setSectionBackground(section.id, color)}
        />
      </InspectorGroup>

      <InspectorGroup titleKey="layout">
        <SelectField
          label={t("section.layoutMode")}
          value={section.layoutMode}
          options={SECTION_LAYOUT_MODES.map((mode) => ({ value: mode, label: t(`section.mode.${mode}`) }))}
          onChange={(mode) => {
            // Converting a populated section is warned first; an empty one converts immediately.
            if (mode === section.layoutMode) return;
            if (section.elements.length === 0) store.convertSectionLayout(section.id, mode);
            else setPendingMode(mode);
          }}
        />

        {section.layoutMode === "grid" && (
          <>
            <SelectField
              label={t("section.autoMode")}
              value={grid.autoMode}
              options={(["fixed", "auto-fit", "auto-fill"] as const).map((mode) => ({
                value: mode,
                label: t(`options.autoMode.${mode}`),
              }))}
              onChange={(value) =>
                patchLayout({
                  ...DEFAULT_GRID_LAYOUT,
                  ...grid,
                  autoMode: value as typeof grid.autoMode,
                })
              }
            />
            {grid.autoMode !== "fixed" ? (
              <NumberField
                label={t("section.minColumnWidth")}
                value={grid.minColumnWidth}
                min={40}
                max={2000}
                transactionKey={`${key}:minColumnWidth`}
                onChange={(minColumnWidth) => patchLayout({ ...DEFAULT_GRID_LAYOUT, ...grid, minColumnWidth })}
              />
            ) : (
              <NumberField
                label={t("section.columns")}
                value={grid.columns}
                min={1}
                max={12}
                transactionKey={`${key}:columns`}
                onChange={(columns) => patchLayout({ ...DEFAULT_GRID_LAYOUT, ...grid, columns })}
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label={t("section.rowGap")}
                value={grid.rowGap}
                min={0}
                transactionKey={`${key}:rowGap`}
                onChange={(rowGap) => patchLayout({ ...DEFAULT_GRID_LAYOUT, ...grid, rowGap })}
              />
              <NumberField
                label={t("section.columnGap")}
                value={grid.columnGap}
                min={0}
                transactionKey={`${key}:columnGap`}
                onChange={(columnGap) => patchLayout({ ...DEFAULT_GRID_LAYOUT, ...grid, columnGap })}
              />
            </div>
            <SelectField
              label={t("section.alignItems")}
              value={grid.alignItems}
              options={ALIGN_VALUES.map((value) => ({ value, label: t(`section.align.${value}`) }))}
              onChange={(alignItems) => patchLayout({ ...DEFAULT_GRID_LAYOUT, ...grid, alignItems })}
            />
          </>
        )}

        {section.layoutMode === "flex" && (
          <>
            <SelectField
              label={t("section.direction")}
              value={flex.direction}
              options={FLEX_DIRECTIONS.map((value) => ({ value, label: t(`section.directions.${value}`) }))}
              onChange={(direction) => patchLayout({ ...DEFAULT_FLEX_LAYOUT, ...flex, direction })}
            />
            <SelectField
              label={t("section.wrap")}
              value={flex.wrap}
              options={FLEX_WRAPS.map((value) => ({ value, label: t(`section.wraps.${value}`) }))}
              onChange={(wrap) => patchLayout({ ...DEFAULT_FLEX_LAYOUT, ...flex, wrap })}
            />
            <NumberField
              label={t("section.gap")}
              value={flex.gap}
              min={0}
              transactionKey={`${key}:gap`}
              onChange={(gap) => patchLayout({ ...DEFAULT_FLEX_LAYOUT, ...flex, gap })}
            />
            <SelectField
              label={t("section.justifyContent")}
              value={flex.justifyContent}
              options={JUSTIFY_VALUES.map((value) => ({ value, label: t(`section.justify.${value}`) }))}
              onChange={(justifyContent) => patchLayout({ ...DEFAULT_FLEX_LAYOUT, ...flex, justifyContent })}
            />
            <SelectField
              label={t("section.alignItems")}
              value={flex.alignItems}
              options={ALIGN_VALUES.map((value) => ({ value, label: t(`section.align.${value}`) }))}
              onChange={(alignItems) => patchLayout({ ...DEFAULT_FLEX_LAYOUT, ...flex, alignItems })}
            />
          </>
        )}

        {section.layoutMode !== "free" && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label={t("section.paddingX")}
              value={section.layoutMode === "grid" ? grid.paddingX : flex.paddingX}
              min={0}
              transactionKey={`${key}:paddingX`}
              onChange={(paddingX) =>
                patchLayout(
                  section.layoutMode === "grid"
                    ? { ...DEFAULT_GRID_LAYOUT, ...grid, paddingX }
                    : { ...DEFAULT_FLEX_LAYOUT, ...flex, paddingX },
                )
              }
            />
            <NumberField
              label={t("section.paddingY")}
              value={section.layoutMode === "grid" ? grid.paddingY : flex.paddingY}
              min={0}
              transactionKey={`${key}:paddingY`}
              onChange={(paddingY) =>
                patchLayout(
                  section.layoutMode === "grid"
                    ? { ...DEFAULT_GRID_LAYOUT, ...grid, paddingY }
                    : { ...DEFAULT_FLEX_LAYOUT, ...flex, paddingY },
                )
              }
            />
          </div>
        )}
      </InspectorGroup>

      <InspectorGroup titleKey="responsive" defaultOpen={false}>
        <p className="text-xs text-ink-500">{t("section.responsiveHint")}</p>
      </InspectorGroup>

      <InspectorGroup titleKey="advanced" defaultOpen={false}>
        <ToggleField
          label={t("fields.hidden")}
          checked={section.hidden}
          onChange={(hidden) => store.setSectionHidden(section.id, hidden)}
        />
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => store.duplicateSection(section.id)}
            className="rounded border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-600"
          >
            {t("inspector.duplicate")}
          </button>
          <button
            type="button"
            onClick={() => store.deleteSection(section.id)}
            className="rounded border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-600"
          >
            {t("inspector.delete")}
          </button>
        </div>
      </InspectorGroup>

      <ConfirmDialog
        open={pendingMode !== null}
        title={t("section.convertTitle")}
        description={
          impact === null
            ? undefined
            : t(impact.losesFreePositioning ? "section.convertLosesPositions" : "section.convertKeepsContent", {
                count: impact.elementCount,
              })
        }
        confirmLabel={t("section.convertConfirm")}
        onCancel={() => setPendingMode(null)}
        onConfirm={() => {
          if (pendingMode !== null) store.convertSectionLayout(section.id, pendingMode);
          setPendingMode(null);
        }}
      />
    </>
  );
}
