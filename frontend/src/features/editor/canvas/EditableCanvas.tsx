import { DESIGN_WIDTH, type BuilderElement, type BuilderPage, type BuilderSection } from "@websitebuilder/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Moveable from "react-moveable";

import { ElementRenderer } from "@/components/renderer/ElementRenderer";
import { sectionStyle } from "@/components/renderer/styles";
import { constrainGeometry, RESIZE_HANDLES } from "@/features/editor/canvas/coordinates";
import { useEditorStore } from "@/features/editor/store/editorStore";

/**
 * Editor interaction layer over the shared renderer.
 *
 * Selection outlines, hover boundaries, labels and resize handles live here and nowhere else, so
 * none of them can reach preview or published output. The renderer underneath is the same component
 * a visitor gets.
 */

/** Wraps one rendered element with selection, hover and lock behaviour. */
function EditableElement({
  element,
  positioned,
  selected,
}: {
  element: BuilderElement;
  positioned: boolean;
  selected: boolean;
}) {
  const { t } = useTranslation("builder");
  const select = useEditorStore((state) => state.select);
  const [hovered, setHovered] = useState(false);

  if (element.hidden) return null;

  return (
    <div
      data-editable-id={element.id}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={(event) => {
        event.stopPropagation();
        // Locked elements stay selectable from Layers only, so a stray click cannot move them.
        if (element.locked) return;
        select({ kind: "element", elementId: element.id });
      }}
      style={
        positioned
          ? {
              position: "absolute",
              left: element.geometry.x,
              top: element.geometry.y,
              width: element.geometry.width,
              height: element.geometry.height,
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
      <ElementRenderer element={element} positioned={false} />
    </div>
  );
}

function EditableSection({ section, selectedElementId }: { section: BuilderSection; selectedElementId: string | null }) {
  const { t } = useTranslation("builder");
  const select = useEditorStore((state) => state.select);
  const selection = useEditorStore((state) => state.ui.selection);
  const isSelected = selection?.kind === "section" && selection.sectionId === section.id;

  if (section.hidden) return null;

  return (
    <section
      aria-label={section.name || t("elements.section")}
      onClick={(event) => {
        event.stopPropagation();
        select({ kind: "section", sectionId: section.id });
      }}
      style={sectionStyle(section)}
      className={isSelected ? "outline outline-2 -outline-offset-2 outline-accent-600" : ""}
    >
      {section.elements.length === 0 && (
        <p className="p-8 text-center text-sm text-ink-400">{t("canvas.emptySection")}</p>
      )}
      {section.elements.map((element) => (
        <EditableElement
          key={element.id}
          element={element}
          positioned={section.layoutMode === "free"}
          selected={element.id === selectedElementId}
        />
      ))}
    </section>
  );
}

export function EditableCanvas({ page }: { page: BuilderPage | null }) {
  const { t } = useTranslation("builder");
  const zoom = useEditorStore((state) => state.ui.zoom);
  const selection = useEditorStore((state) => state.ui.selection);
  const store = useEditorStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  const selectedElementId = selection?.kind === "element" ? selection.elementId : null;

  useEffect(() => {
    if (selectedElementId === null) {
      setTarget(null);
      return;
    }
    setTarget(containerRef.current?.querySelector<HTMLElement>(`[data-editable-id="${selectedElementId}"]`) ?? null);
  }, [selectedElementId, page]);

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

  return (
    <div className="h-full overflow-auto bg-ink-100 p-8">
      <div
        role="group"
        aria-label={t("canvas.label")}
        onClick={() => store.select(null)}
        style={{ width: DESIGN_WIDTH * zoom }}
        className="mx-auto"
      >
        <div
          ref={containerRef}
          style={{
            width: DESIGN_WIDTH,
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
            backgroundColor: page.canvas.backgroundColor,
            minHeight: page.canvas.minHeight,
          }}
          className="shadow-sm"
        >
          {page.sections.map((section) => (
            <EditableSection key={section.id} section={section} selectedElementId={selectedElementId} />
          ))}
        </div>
      </div>

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
