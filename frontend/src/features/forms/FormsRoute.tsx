import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

import { PageMetadata } from "@/components/common/PageMetadata";
import { FormEditor } from "@/features/forms/FormEditor";
import { FormsOverview } from "@/features/forms/FormsOverview";
import { SubmissionsInbox } from "@/features/forms/SubmissionsInbox";

/**
 * The Forms Center, under the authenticated site shell.
 *
 * Three destinations rather than one screen with modes: an overview, one form's questions, and the
 * answers. Each is a real address, so it can be linked to from the builder, from the site dashboard
 * and from a notification, and reloading one lands where it was rather than at the top.
 */
function useScope() {
  const { workspaceId = "", projectId = "" } = useParams();
  return { workspaceId, projectId, basePath: `/app/${workspaceId}/sites/${projectId}/forms` };
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useTranslation("common");
  return (
    <div className="px-6 py-10 sm:px-10">
      <PageMetadata title={`${title} — ${t("productName")}`} />
      <div className="mx-auto max-w-5xl">{children}</div>
    </div>
  );
}

export function FormsRoute() {
  const { t } = useTranslation("forms");
  const scope = useScope();

  return (
    <Frame title={t("title")}>
      <FormsOverview {...scope} />
    </Frame>
  );
}

export function FormEditorRoute() {
  const { t } = useTranslation("forms");
  const scope = useScope();
  const { formId } = useParams();

  return (
    <Frame title={formId === undefined ? t("editor.newTitle") : t("editor.editTitle")}>
      <FormEditor {...scope} {...(formId === undefined ? {} : { formId })} />
    </Frame>
  );
}

export function SubmissionsRoute() {
  const { t } = useTranslation("forms");
  const scope = useScope();

  return (
    <Frame title={t("inbox.title")}>
      <SubmissionsInbox {...scope} />
    </Frame>
  );
}
