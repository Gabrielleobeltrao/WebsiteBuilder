import type { FormSummary, PublishedForm } from "@websitebuilder/shared";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formsApi } from "@/api/forms";

/**
 * The project's form definitions, for everything in the builder that needs them.
 *
 * The canvas renders real fields, the inspector offers a picker, and readiness reports a block
 * bound to something that is gone — three consumers of one list, so it is fetched once here rather
 * than three times by three components that would then disagree while one of them was still loading.
 */
export function useProjectForms(
  workspaceId: string,
  projectId: string,
  /**
   * Whether this project has anything to load forms for.
   *
   * Most sites have no form block at all, and asking for a list to render none of it is a request
   * per builder session that answers a question nobody asked. The builder passes "does the document
   * contain a form block", which is also what makes the request appear the moment one is inserted.
   */
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    try {
      setForms(await formsApi.list(workspaceId, projectId));
    } catch {
      // A builder that will not open because a form list failed is worse than a builder whose form
      // blocks say they could not load one. The block's own unbound state covers it.
      setForms([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, projectId, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** The draft definition, shaped the way the renderer consumes a published one. */
  const resolveForm = useMemo(() => {
    const byId = new Map(
      forms.map((form): [string, PublishedForm] => [
        form.id,
        {
          id: form.id,
          name: form.name,
          revision: form.revision,
          fields: form.fields,
          submitLabel: form.submitLabel,
          successBehavior: form.successBehavior,
          ...(form.errorMessage === undefined ? {} : { errorMessage: form.errorMessage }),
          status: form.archived ? "archived" : form.status,
        },
      ]),
    );

    return (formId: string) => byId.get(formId) ?? null;
  }, [forms]);

  return { forms, loading, reload, resolveForm };
}
