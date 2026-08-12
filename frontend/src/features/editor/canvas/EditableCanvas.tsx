import {
  applyConstraints,
  resolveLayoutAt,
  type BreakpointDefinition,
  type BuilderElement,
  type BuilderPage,
  type BuilderSection,
  type ElementType,
  type SectionLayoutMode,
} from "@websitebuilder/shared";
import { Copy, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import Moveable from "react-moveable";

import { ElementRenderer } from "@/components/renderer/ElementRenderer";
import { containerStyle, sectionStyle } from "@/components/renderer/styles";
import { constrainGeometry, RESIZE_HANDLES } from "@/features/editor/canvas/coordinates";
import { dragKindOf, readDragPayload, MOVE_MIME, type DragKind } from "@/features/editor/canvas/dnd";
import { canAcceptChild, type InsertionTarget } from "@/features/editor/store/elements";
import { useEditorStore } from "@/features/editor/store/editorStore";
import { resolvePageSections } from "@/features/editor/store/sharedSections";

/**
 * Editor interaction layer over the shared renderer.
 *
 * Selection outlines, hover boundaries, labels, resize handles and every drop marker live here and
 * nowhere else, so none of them can reach preview or published output. The renderer underneath is
 * the same component a visitor gets.
 */

/** Everything a drop destination needs to know, threaded down instead of held in a context. */
type DropContext = {
  dragKind: DragKind | null;
  onDrop: (event: DragEvent, target: InsertionTarget) => void;
};

/**
 * A place an element can land, between two others.
 *
 * Rendered only while something is being dragged: a page permanently striped with drop zones tells
 * an author nothing, and covers the content they are trying to read.
 */
function InsertionMarker({
  target,
  context,
  disabled = false,
}: {
  target: InsertionTarget;
  context: DropContext;
  disabled?: boolean;
}) {
  const { t } = useTranslation("builder");
  const [over, setOver] = useState(false);

  if (context.dragKind === null || context.dragKind === "section") return null;

  return (
    <div
      role="separator"
      aria-label={disabled ? t("canvas.tooDeep") : t("canvas.insertHere")}
      aria-disabled={disabled || undefined}
      onDragOver={(event) => {
        if (disabled) return;
        // Without this the browser refuses the drop, and the marker becomes decoration.
        event.preventDefault();
        event.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        // A refused drop is swallowed here. Letting it bubble would hand it to the section behind the
        // marker, so the element the depth guard just rejected would land anyway, one level out.
        event.stopPropagation();
        event.preventDefault();
        if (disabled) return;
        context.onDrop(event, target);
      }}
      className={[
        "my-0.5 h-1 rounded-full transition-colors",
        disabled ? "bg-red-200" : over ? "bg-accent-600" : "bg-accent-200",
      ].join(" ")}
    />
  );
}

/** Wraps one rendered element with selection, hover, drag and lock behaviour. */
function EditableElement({
  element,
  positioned,
  selectedId,
  editingWidth,
  breakpoints,
  sectionId,
  context,
}: {
  element: BuilderElement;
  positioned: boolean;
  selectedId: string | null;
  editingWidth: number;
  breakpoints: readonly BreakpointDefinition[];
  sectionId: string;
  context: DropContext;
}) {
  const { t } = useTranslation("builder");
  const select = useEditorStore((state) => state.select);
  const [hovered, setHovered] = useState(false);

  if (element.hidden) return null;

  const selected = element.id === selectedId;

  // Everything shown here comes from the shared resolver, so the canvas cannot disagree with what
  // preview and the published site produce at the same width.
  const resolved = resolveLayoutAt({
    width: editingWidth,
    base: element.responsiveLayout,
    geometry: element.geometry,
    breakpoints,
    overrides: element.breakpointOverrides,
  });
  if (!resolved.layout.visible) return null;

  const placed = applyConstraints({
    geometry: resolved.geometry,
    layout: resolved.layout,
    containerWidth: editingWidth,
  });

  return (
    <div
      data-editable-id={element.id}
      draggable={!element.locked && context.dragKind !== "section"}
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.setData(MOVE_MIME, element.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={(event) => {
        event.stopPropagation();
        // Locked elements stay selectable from Structure only, so a stray click cannot move them.
        if (element.locked) return;
        select({ kind: "element", elementId: element.id });
      }}
      style={
        positioned
          ? {
              position: "absolute",
              left: placed.x,
              top: placed.y,
              width: placed.width,
              height: placed.height,
              zIndex: element.zIndex,
            }
          : undefined
      }
      className={[
        "cursor-default",
        // High contrast against both light and dark content; selected always wins over hover.
        selected
          ? "outline outline-2 outline-offset-1 outline-accent-600"
          : hovered && !element.locked
            ? "outline outline-1 outline-offset-1 outline-accent-300"
            : "",
      ].join(" ")}
    >
      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-5 left-0 rounded bg-accent-600 px-1.5 py-0.5 text-[10px]
            font-medium text-white"
        >
          {element.name || t(`elements.${element.type}`)}
        </span>
      )}

      {element.type === "container" ? (
        <EditableContainer
          element={element}
          selectedId={selectedId}
          editingWidth={editingWidth}
          breakpoints={breakpoints}
          sectionId={sectionId}
          context={context}
        />
      ) : (
        <ElementRenderer element={element} positioned={false} />
      )}
    </div>
  );
}

/**
 * A container's children, rendered by the editor rather than the renderer.
 *
 * The layout comes from the same `containerStyle` the published output uses, so this is the shared
 * rendering with insertion markers threaded between the children — which is the only way a person
 * can drop something *into* a container at a chosen position rather than at its end.
 */
function EditableContainer({
  element,
  selectedId,
  editingWidth,
  breakpoints,
  sectionId,
  context,
}: {
  element: Extract<BuilderElement, { type: "container" }>;
  selectedId: string | null;
  editingWidth: number;
  breakpoints: readonly BreakpointDefinition[];
  sectionId: string;
  context: DropContext;
}) {
  // Depth is checked once here rather than per marker: every marker inside this container answers
  // the same question, and the answer is a property of the container.
  const full = !canAcceptChild(element);
  const marker = (index: number) => (
    <InsertionMarker
      key={`marker-${index}`}
      target={{ sectionId, containerId: element.id, index }}
      context={context}
      disabled={full}
    />
  );

  return (
    <div style={containerStyle(element)}>
      {marker(0)}
      {element.children.map((child, index) => (
        <div key={child.id} className="contents">
          <EditableElement
            element={child}
            positioned={element.layout === "free"}
            selectedId={selectedId}
            editingWidth={editingWidth}
            breakpoints={breakpoints}
            sectionId={sectionId}
            context={context}
          />
          {marker(index + 1)}
        </div>
      ))}
    </div>
  );
}

function EditableSection({
  section,
  selectedId,
  editingWidth,
  breakpoints,
  zoom,
  context,
}: {
  section: BuilderSection;
  selectedId: string | null;
  editingWidth: number;
  breakpoints: readonly BreakpointDefinition[];
  zoom: number;
  context: DropContext;
}) {
  const { t } = useTranslation("builder");
  const select = useEditorStore((state) => state.select);
  const selection = useEditorStore((state) => state.ui.selection);
  const [over, setOver] = useState(false);
  const isSelected = selection?.kind === "section" && selection.sectionId === section.id;
  const free = section.layoutMode === "free";

  if (section.hidden) return null;

  /** A free section takes a coordinate: where the pointer is, is where the element goes. */
  const coordinateOf = (event: DragEvent<HTMLElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
  };

  return (
    <section
      data-section-id={section.id}
      aria-label={section.name || t("elements.section")}
      onClick={(event) => {
        event.stopPropagation();
        select({ kind: "section", sectionId: section.id });
      }}
      onDragOver={
        free && context.dragKind !== null && context.dragKind !== "section"
          ? (event) => {
              event.preventDefault();
              setOver(true);
            }
          : undefined
      }
      onDragLeave={() => setOver(false)}
      onDrop={
        free
          ? (event) => {
              setOver(false);
              context.onDrop(event, { sectionId: section.id, at: coordinateOf(event) });
            }
          : undefined
      }
      style={sectionStyle(section)}
      className={[
        isSelected ? "outline outline-2 -outline-offset-2 outline-accent-600" : "",
        over ? "outline-dashed outline-2 -outline-offset-2 outline-accent-400" : "",
      ].join(" ")}
    >
      {section.elements.length === 0 && (
        <p className="p-8 text-center text-sm text-ink-400">{t("canvas.emptySection")}</p>
      )}

      {/* A free section is addressed by coordinate, so markers between its children would be a
          second, contradictory answer to "where does this go". */}
      {!free && <InsertionMarker target={{ sectionId: section.id, index: 0 }} context={context} />}

      {section.elements.map((element, index) => (
        <div key={element.id} className={free ? undefined : "contents"}>
          <EditableElement
            element={element}
            positioned={free}
            selectedId={selectedId}
            editingWidth={editingWidth}
            breakpoints={breakpoints}
            sectionId={section.id}
            context={context}
          />
          {!free && <InsertionMarker target={{ sectionId: section.id, index: index + 1 }} context={context} />}
        </div>
      ))}
    </section>
  );
}

const SECTION_LAYOUTS: SectionLayoutMode[] = ["free", "flex", "grid"];

/** Creates a section at one position, in a layout the author picks rather than inherits. */
function AddSectionRow({ atIndex }: { atIndex: number }) {
  const { t } = useTranslation("builder");
  const addSection = useEditorStore((state) => state.addSection);

  return (
    <div className="flex items-center justify-center gap-1 py-1 opacity-40 transition-opacity focus-within:opacity-100 hover:opacity-100">
      {SECTION_LAYOUTS.map((layout) => (
        <button
          key={layout}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            addSection(layout, atIndex);
          }}
          className="rounded border border-dashed border-ink-300 bg-white px-2 py-0.5 text-[10px] font-medium
            text-ink-600 hover:border-accent-500 hover:text-accent-700"
        >
          {t("canvas.addSection", { layout: t(`section.mode.${layout}`) })}
        </button>
      ))}
    </div>
  );
}

export function EditableCanvas({ page }: { page: BuilderPage | null }) {
  const { t } = useTranslation("builder");
  const zoom = useEditorStore((state) => state.ui.zoom);
  const editingWidth = useEditorStore((state) => state.ui.editingWidth);
  const breakpoints = useEditorStore((state) => state.history.present.breakpoints);
  const sharedSections = useEditorStore((state) => state.history.present.sharedSections);
  const selection = useEditorStore((state) => state.ui.selection);
  const store = useEditorStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [dragKind, setDragKind] = useState<DragKind | null>(null);

  const selectedElementId = selection?.kind === "element" ? selection.elementId : null;

  useEffect(() => {
    if (selectedElementId === null) {
      setTarget(null);
      return;
    }
    setTarget(containerRef.current?.querySelector<HTMLElement>(`[data-editable-id="${selectedElementId}"]`) ?? null);
  }, [selectedElementId, page]);

  useEffect(() => {
    if (dragKind === null) return;
    // Escape cancels: the browser ends the drag itself, and this clears the markers it left behind.
    // Nothing here writes to the document, which is the whole point of a cancelled drag.
    const clear = () => setDragKind(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [dragKind]);

  if (page === null) return null;

  const selectedElement =
    selectedElementId === null
      ? null
      : (page.sections.flatMap((section) => section.elements).find((element) => element.id === selectedElementId) ??
        null);

  /** Reads the live DOM box back into logical geometry once an interaction settles. */
  const commitGeometry = (node: HTMLElement) => {
    if (selectedElement === null) return;
    store.moveElement(
      selectedElement.id,
      constrainGeometry({
        x: Number.parseFloat(node.style.left || String(selectedElement.geometry.x)),
        y: Number.parseFloat(node.style.top || String(selectedElement.geometry.y)),
        width: Number.parseFloat(node.style.width || String(selectedElement.geometry.width)),
        height: Number.parseFloat(node.style.height || String(selectedElement.geometry.height)),
        rotation: selectedElement.geometry.rotation,
      }),
    );
  };

  const context: DropContext = {
    dragKind,
    onDrop: (event, destination) => {
      const payload = readDragPayload(event.dataTransfer);
      setDragKind(null);
      if (payload === null) return;

      if (payload.kind === "create") store.insertElement(payload.type as ElementType, destination);
      if (payload.kind === "move") store.moveElementTo(payload.elementId, destination);
    },
  };

  const sections = resolvePageSections({ sharedSections }, page);

  return (
    <div
      className="h-full overflow-auto bg-ink-100 p-8"
      onDragEnter={(event) => setDragKind(dragKindOf(event.dataTransfer))}
      onDragOver={(event) => {
        if (dragKindOf(event.dataTransfer) !== null) event.preventDefault();
      }}
    >
      <div
        role="group"
        aria-label={t("canvas.label")}
        onClick={() => store.select(null)}
        style={{ width: editingWidth * zoom }}
        className="mx-auto"
      >
        <div
          ref={containerRef}
          style={{
            width: editingWidth,
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
            backgroundColor: page.canvas.backgroundColor,
            minHeight: page.canvas.minHeight,
          }}
          className="shadow-sm"
        >
          {sections.map((section, index) => (
            <div key={section.id}>
              <AddSectionRow atIndex={index} />
              <EditableSection
                section={section}
                selectedId={selectedElementId}
                editingWidth={editingWidth}
                breakpoints={breakpoints}
                zoom={zoom}
                context={context}
              />
            </div>
          ))}
          <AddSectionRow atIndex={sections.length} />
        </div>
      </div>

      {/* Duplicate and Delete only: the inspector is one panel away, and a floating copy of it would
          cover the element it is describing. */}
      {selectedElement !== null && !selectedElement.locked && (
        <div
          role="toolbar"
          aria-label={t("canvas.elementActions")}
          className="fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border
            border-ink-200 bg-white p-1 shadow-lg"
        >
          <button
            type="button"
            aria-label={t("canvas.duplicateElement")}
            onClick={() => store.duplicateElement(selectedElement.id)}
            className="rounded p-1.5 text-ink-700 hover:bg-ink-50"
          >
            <Copy aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            aria-label={t("canvas.deleteElement")}
            onClick={() => store.deleteElement(selectedElement.id)}
            className="rounded p-1.5 text-red-600 hover:bg-red-50"
          >
            <Trash2 aria-hidden className="size-4" />
          </button>
        </div>
      )}

      {target !== null && selectedElement !== null && !selectedElement.locked && (
        <Moveable
          target={target}
          draggable
          resizable
          origin={false}
          keepRatio={false}
          /* Exactly eight handles: four corners resize both axes, four sides resize one. */
          renderDirections={[...RESIZE_HANDLES]}
          /* Moveable works in screen pixels; telling it the zoom keeps logical geometry correct. */
          zoom={1}
          throttleDrag={0}
          throttleResize={0}
          onDragStart={() => store.beginTransaction(`drag:${selectedElement.id}`)}
          onDrag={({ target: node, left, top }) => {
            const element = node as HTMLElement;
            element.style.left = `${left}px`;
            element.style.top = `${top}px`;
          }}
          /* One history entry per interaction, not one per pointer event. */
          onDragEnd={({ target: node }) => {
            commitGeometry(node as HTMLElement);
            store.endTransaction();
          }}
          onResizeStart={() => store.beginTransaction(`resize:${selectedElement.id}`)}
          onResize={({ target: node, width, height, drag }) => {
            const element = node as HTMLElement;
            element.style.width = `${width}px`;
            element.style.height = `${height}px`;
            element.style.left = `${drag.left}px`;
            element.style.top = `${drag.top}px`;
          }}
          onResizeEnd={({ target: node }) => {
            commitGeometry(node as HTMLElement);
            store.endTransaction();
          }}
        />
      )}
    </div>
  );
}
