import { DEVICE_ORDER, type DeviceMode } from "@websitebuilder/shared";
import { useEffect, useRef } from "react";
import { useParams, useSearchParams } from "react-router";

import { EditorShell } from "@/features/editor/EditorShell";
import { findElement } from "@/features/editor/store/elements";
import { useEditorStore } from "@/features/editor/store/editorStore";

/**
 * Loads the project into the editor store, cancelling the request if the route changes.
 *
 * The address can also name what to open: a page, a device and an element. That is how a readiness
 * finding becomes a click — "this overflows on a phone" opens the page, switches to the phone, and
 * selects the element, rather than describing where to go and leaving the reader to navigate.
 */
export function EditorRoute() {
  const { workspaceId = "", projectId = "", pageId } = useParams();
  const [searchParams] = useSearchParams();
  const load = useEditorStore((state) => state.load);
  const loadStatus = useEditorStore((state) => state.loadStatus);
  const applied = useRef<string | null>(null);

  const element = searchParams.get("element");
  const device = searchParams.get("device");

  useEffect(() => {
    const controller = new AbortController();
    void load(workspaceId, projectId, controller.signal);
    return () => controller.abort();
  }, [load, workspaceId, projectId]);

  useEffect(() => {
    if (loadStatus !== "ready") return;

    // Applied once per address: after this, the page, device and selection belong to the person
    // editing, and re-imposing the URL's version on every render would fight them.
    const key = `${pageId ?? ""}:${device ?? ""}:${element ?? ""}`;
    if (applied.current === key) return;
    applied.current = key;

    const store = useEditorStore.getState();
    if (pageId !== undefined && store.history.present.pages.some((page) => page.id === pageId)) {
      store.setCurrentPage(pageId);
    }
    if (isDevice(device)) store.setEditingDevice(device);
    if (element !== null && findElement(store.history.present, element) !== null) {
      store.select({ kind: "element", elementId: element });
    }
  }, [loadStatus, pageId, device, element]);

  return <EditorShell workspaceId={workspaceId} projectId={projectId} />;
}

function isDevice(value: string | null): value is DeviceMode {
  return value !== null && (DEVICE_ORDER as readonly string[]).includes(value);
}
