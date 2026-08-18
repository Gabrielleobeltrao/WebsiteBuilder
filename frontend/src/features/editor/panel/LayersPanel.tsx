import type { BuilderElement, BuilderSection } from "@websitebuilder/shared";
import { ChevronDown, ChevronRight, Eye, EyeOff, MoveDown, MoveUp, PencilLine, Trash2 } from "lucide-react";
import { useState, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { MOVE_MIME, SECTION_MIME } from "@/features/editor/canvas/dnd";
import { selectCurrentPage, useEditorStore } from "@/features/editor/store/editorStore";

/**
 * Structure: the page as a tree, and the recovery path for everything the canvas cannot reach.
 *
 * A locked element ignores clicks and a hidden one is not painted at all, so this is where both are
 * selected, inspected and restored. Everything here is therefore reachable without a pointer:
 * reordering is a pair of buttons as well as a drag, because a drag that is the only way to reorder
 * is a feature some people simply do not have.
 */

function IconButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  /** Destructive actions read as destructive on hover. Undo covers the mistake; nothing warns. */
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={[
        "rounded p-1 text-ink-500",
        danger ? "hover:bg-red-50 hover:text-red-700" : "hover:bg-ink-100 hover:text-ink-800",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/** The row's own name, editable in place. */
function NameCell({
  name,
  fallback,
  selected,
  onSelect,
  onRename,
  bold = false,
}: {
  name: string;
  fallback: string;
  selected: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  bold?: boolean;
}) {
  const { t } = useTranslation("builder");
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null) {
    return (
      <input
        autoFocus
        aria-label={t("layers.rename")}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft.trim() !== "") onRename(draft.trim());
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(null);
        }}
        className="min-w-0 flex-1 rounded border border-ink-200 px-1 py-0.5 text-xs text-ink-900"
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={[
          "min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-xs",
          bold ? "font-semibold text-ink-800" : "text-ink-700",
          selected ? "bg-accent-50 text-ink-900" : "hover:bg-ink-50",
        ].join(" ")}
      >
        {name || fallback}
      </button>
      <IconButton label={t("layers.rename")} onClick={() => setDraft(name || fallback)}>
        <PencilLine aria-hidden className="size-3.5" />
      </IconButton>
    </>
  );
}

function ElementRow({
  element,
  depth,
  index,
  siblings,
  parent,
}: {
  element: BuilderElement;
  depth: number;
  index: number;
  siblings: number;
  /** The list this element belongs to, which is where a reorder puts it back. */
  parent: { sectionId: string; containerId?: string };
}) {
  const { t } = useTranslation("builder");
  const store = useEditorStore();
  const selection = useEditorStore((state) => state.ui.selection);
  const [collapsed, setCollapsed] = useState(false);
  const selected = selection?.kind === "element" && selection.elementId === element.id;
  const container = element.type === "container";

  const moveTo = (target: number) => store.moveElementTo(element.id, { ...parent, index: target });

  return (
    <>
      <li
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.setData(MOVE_MIME, element.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event: DragEvent) => {
          if ([...event.dataTransfer.types].includes(MOVE_MIME)) event.preventDefault();
        }}
        onDrop={(event) => {
          const moved = event.dataTransfer.getData(MOVE_MIME);
          if (!moved || moved === element.id) return;
          event.stopPropagation();
          // Dropping on a row means "before this row", which is the only reading that lets a person
          // reach the first position at all.
          store.moveElementTo(moved, { ...parent, index });
        }}
        style={{ paddingInlineStart: `${depth * 12}px` }}
        className="flex items-center gap-0.5"
      >
        {container ? (
          <IconButton
            label={collapsed ? t("layers.expand") : t("layers.collapse")}
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? <ChevronRight aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
          </IconButton>
        ) : (
          <span className="w-6" />
        )}

        <NameCell
          name={element.name}
          fallback={t(`elements.${element.type}`)}
          selected={selected}
          onSelect={() => store.select({ kind: "element", elementId: element.id })}
          onRename={(name) => store.renameElement(element.id, name)}
        />

        {element.locked && <span className="shrink-0 text-[10px] text-ink-500">{t("layers.locked")}</span>}

        <IconButton
          label={element.hidden ? t("layers.show") : t("layers.hide")}
          onClick={() => store.setElementFlag(element.id, "hidden", !element.hidden)}
        >
          {element.hidden ? <EyeOff aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}
        </IconButton>

        {index > 0 && (
          <IconButton label={t("layers.moveUp")} onClick={() => moveTo(index - 1)}>
            <MoveUp aria-hidden className="size-3.5" />
          </IconButton>
        )}
        {index < siblings - 1 && (
          <IconButton label={t("layers.moveDown")} onClick={() => moveTo(index + 1)}>
            <MoveDown aria-hidden className="size-3.5" />
          </IconButton>
        )}

        <IconButton danger label={t("layers.deleteElement")} onClick={() => store.deleteElement(element.id)}>
          <Trash2 aria-hidden className="size-3.5" />
        </IconButton>
      </li>

      {element.type === "container" &&
        !collapsed &&
        element.children.map((child, childIndex) => (
          <ElementRow
            key={child.id}
            element={child}
            depth={depth + 1}
            index={childIndex}
            siblings={element.children.length}
            parent={{ sectionId: parent.sectionId, containerId: element.id }}
          />
        ))}
    </>
  );
}

function SectionRow({ section, index, total }: { section: BuilderSection; index: number; total: number }) {
  const { t } = useTranslation("builder");
  const store = useEditorStore();
  const selection = useEditorStore((state) => state.ui.selection);
  const [collapsed, setCollapsed] = useState(false);
  const selected = selection?.kind === "section" && selection.sectionId === section.id;

  return (
    <li>
      <div
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(SECTION_MIME, section.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        /*
         * A section row takes a section *or* an element.
         *
         * It used to take only a section, so the tree could reorder sections and reorder elements
         * within one, and offered no way to move an element into a different section — least of all
         * into an empty one, which has no element row to aim at. Dragging on the canvas was the only
         * path, and there it meant hitting a four-pixel band.
         */
        onDragOver={(event: DragEvent) => {
          const types = [...event.dataTransfer.types];
          if (types.includes(SECTION_MIME) || types.includes(MOVE_MIME)) event.preventDefault();
        }}
        onDrop={(event) => {
          const element = event.dataTransfer.getData(MOVE_MIME);
          if (element) {
            event.stopPropagation();
            // The end of this section: a row that stands for the whole section cannot mean a
            // position inside it, and the element rows below already say what "before this" means.
            store.moveElementTo(element, { sectionId: section.id, index: section.elements.length });
            return;
          }

          const moved = event.dataTransfer.getData(SECTION_MIME);
          if (!moved || moved === section.id) return;
          const from = store.history.present.pages
            .find((page) => page.sections.some((candidate) => candidate.id === moved))
            ?.sections.findIndex((candidate) => candidate.id === moved);
          if (from === undefined || from === -1) return;
          store.reorderSections(from, index);
        }}
        className="flex items-center gap-0.5"
      >
        <IconButton
          label={collapsed ? t("layers.expand") : t("layers.collapse")}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? <ChevronRight aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
        </IconButton>

        <NameCell
          bold
          name={section.name}
          fallback={t("elements.section")}
          selected={selected}
          onSelect={() => store.select({ kind: "section", sectionId: section.id })}
          onRename={(name) => store.renameSection(section.id, name)}
        />

        <IconButton
          label={section.hidden ? t("layers.show") : t("layers.hide")}
          onClick={() => store.setSectionHidden(section.id, !section.hidden)}
        >
          {section.hidden ? <EyeOff aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}
        </IconButton>

        {index > 0 && (
          <IconButton label={t("layers.moveUp")} onClick={() => store.reorderSections(index, index - 1)}>
            <MoveUp aria-hidden className="size-3.5" />
          </IconButton>
        )}
        {index < total - 1 && (
          <IconButton label={t("layers.moveDown")} onClick={() => store.reorderSections(index, index + 1)}>
            <MoveDown aria-hidden className="size-3.5" />
          </IconButton>
        )}

        <IconButton danger label={t("layers.deleteSection")} onClick={() => store.deleteSection(section.id)}>
          <Trash2 aria-hidden className="size-3.5" />
        </IconButton>
      </div>

      {!collapsed && (
        <ul>
          {section.elements.map((element, elementIndex) => (
            <ElementRow
              key={element.id}
              element={element}
              depth={1}
              index={elementIndex}
              siblings={section.elements.length}
              parent={{ sectionId: section.id }}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function LayersPanel() {
  const { t } = useTranslation("builder");
  const page = useEditorStore(selectCurrentPage);

  if (page === null) return <p className="text-xs text-ink-500">{t("layers.empty")}</p>;

  return (
    <nav aria-label={t("layers.tree")}>
      <p className="mb-2 truncate px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{page.name}</p>
      <ul className="space-y-2">
        {page.sections.map((section, index) => (
          <SectionRow key={section.id} section={section} index={index} total={page.sections.length} />
        ))}
      </ul>
    </nav>
  );
}
