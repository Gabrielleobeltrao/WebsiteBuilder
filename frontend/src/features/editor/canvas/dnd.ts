import type { ElementType } from "@websitebuilder/shared";

/**
 * The builder's drag protocol, in one place.
 *
 * Native drag and drop, deliberately: the browser already owns the drag image, the cancel-on-Escape
 * behaviour and the pointer capture, and a library would reimplement all three. What it does not
 * give us is a way to read the payload while the pointer is moving — `getData` returns nothing until
 * the drop — so validity has to be decided from the MIME type alone. Hence two types rather than one
 * with a discriminator inside the payload.
 */

/** A new element from the library. Payload: the element type. */
export const CREATE_MIME = "application/x-websitebuilder-create";

/** An element already in the document. Payload: its id. */
export const MOVE_MIME = "application/x-websitebuilder-move";

/** A section being reordered. Payload: its id. */
export const SECTION_MIME = "application/x-websitebuilder-section";

export type DragKind = "create" | "move" | "section";

/** What is being dragged, from the types alone — the only thing readable mid-drag. */
export function dragKindOf(transfer: Pick<DataTransfer, "types"> | null): DragKind | null {
  const types = transfer?.types;
  if (types === undefined) return null;
  if ([...types].includes(CREATE_MIME)) return "create";
  if ([...types].includes(MOVE_MIME)) return "move";
  if ([...types].includes(SECTION_MIME)) return "section";
  return null;
}

/** The payload, readable only once the drop happens. */
export function readDragPayload(
  transfer: Pick<DataTransfer, "getData"> | null,
): { kind: "create"; type: ElementType } | { kind: "move"; elementId: string } | { kind: "section"; sectionId: string } | null {
  if (transfer === null) return null;

  const created = transfer.getData(CREATE_MIME);
  if (created) return { kind: "create", type: created as ElementType };

  const moved = transfer.getData(MOVE_MIME);
  if (moved) return { kind: "move", elementId: moved };

  const section = transfer.getData(SECTION_MIME);
  if (section) return { kind: "section", sectionId: section };

  return null;
}
