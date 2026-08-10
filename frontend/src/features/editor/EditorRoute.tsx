import { useEffect } from "react";
import { useParams } from "react-router";

import { EditorShell } from "@/features/editor/EditorShell";
import { useEditorStore } from "@/features/editor/store/editorStore";

/** Loads the project into the editor store, cancelling the request if the route changes. */
export function EditorRoute() {
  const { workspaceId = "", projectId = "" } = useParams();
  const load = useEditorStore((state) => state.load);

  useEffect(() => {
    const controller = new AbortController();
    void load(workspaceId, projectId, controller.signal);
    return () => controller.abort();
  }, [load, workspaceId, projectId]);

  return <EditorShell workspaceId={workspaceId} projectId={projectId} />;
}
