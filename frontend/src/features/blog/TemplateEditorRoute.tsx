import { useEffect } from "react";
import { useParams } from "react-router";

import { EditorShell } from "@/features/editor/EditorShell";
import { useEditorStore } from "@/features/editor/store/editorStore";

/**
 * The blog's own layouts, edited in the builder that edits everything else.
 *
 * A template is a page: it has sections, it holds blocks, it is dragged and inspected the same way.
 * What makes it a template is that some of its blocks are bound to a post's fields, and that it is
 * rendered by the blog's routes rather than being routed itself.
 *
 * So this route loads one into the same store the site builder uses, rather than standing up a
 * second editor that would have to re-implement history, autosave, the catalog and every block
 * behaviour — and would drift from the first one within a month.
 */
export function TemplateEditorRoute() {
  const { workspaceId = "", projectId = "", kind = "article" } = useParams();
  const loadBlogTemplate = useEditorStore((state) => state.loadBlogTemplate);
  const templateKind = kind === "index" ? "index" : "article";

  useEffect(() => {
    const controller = new AbortController();
    void loadBlogTemplate(workspaceId, projectId, templateKind, controller.signal);
    return () => controller.abort();
  }, [loadBlogTemplate, workspaceId, projectId, templateKind]);

  return <EditorShell workspaceId={workspaceId} projectId={projectId} />;
}
