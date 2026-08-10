import { parseExternalUrl, type BuilderPage, type SafeLink } from "@websitebuilder/shared";
import { useTranslation } from "react-i18next";

import { SelectField, TextField, ToggleField } from "./controls";

/**
 * Typed link editor. The user picks a kind and fills typed fields; no free-form href is ever
 * accepted, so an unsafe protocol has no way in. Client validation is feedback only — the server
 * validates the same schema.
 */
const KINDS = ["none", "internal", "external", "email", "phone", "whatsapp"] as const;

export function LinkEditor({
  link,
  pages,
  transactionKey,
  onChange,
}: {
  link: SafeLink;
  pages: readonly BuilderPage[];
  transactionKey: string;
  onChange: (link: SafeLink) => void;
}) {
  const { t } = useTranslation("builder");

  const missingPage = link.kind === "internal" && !pages.some((page) => page.id === link.pageId);
  const unsafeUrl = link.kind === "external" && parseExternalUrl(link.url) === null && link.url.trim().length > 0;

  return (
    <div className="space-y-3">
      <SelectField
        label={t("fields.linkKind")}
        value={link.kind}
        options={KINDS.map((kind) => ({ value: kind, label: t(`options.link.${kind}`) }))}
        onChange={(kind) => {
          switch (kind) {
            case "none":
              return onChange({ kind: "none" });
            case "internal":
              return onChange({ kind: "internal", pageId: pages[0]?.id ?? "" });
            case "external":
              return onChange({ kind: "external", url: "", newTab: true });
            case "email":
              return onChange({ kind: "email", email: "" });
            case "phone":
              return onChange({ kind: "phone", phone: "" });
            case "whatsapp":
              return onChange({ kind: "whatsapp", phone: "" });
          }
        }}
      />

      {link.kind === "internal" && (
        <>
          <SelectField
            label={t("fields.linkPage")}
            value={link.pageId}
            options={pages.map((page) => ({ value: page.id, label: page.name }))}
            onChange={(pageId) => onChange({ kind: "internal", pageId })}
          />
          {missingPage && (
            <p role="alert" className="text-xs text-red-700">
              {t("validation.missingPage")}
            </p>
          )}
        </>
      )}

      {link.kind === "external" && (
        <>
          <TextField
            label={t("fields.linkUrl")}
            value={link.url}
            transactionKey={`${transactionKey}:url`}
            onChange={(url) => onChange({ ...link, url })}
          />
          {unsafeUrl && (
            <p role="alert" className="text-xs text-red-700">
              {t("validation.unsafeUrl")}
            </p>
          )}
          <ToggleField
            label={t("fields.newTab")}
            checked={link.newTab}
            onChange={(newTab) => onChange({ ...link, newTab })}
          />
        </>
      )}

      {link.kind === "email" && (
        <TextField
          label={t("fields.linkEmail")}
          value={link.email}
          transactionKey={`${transactionKey}:email`}
          onChange={(email) => onChange({ kind: "email", email })}
        />
      )}

      {(link.kind === "phone" || link.kind === "whatsapp") && (
        <TextField
          label={t("fields.linkPhone")}
          value={link.phone}
          transactionKey={`${transactionKey}:phone`}
          onChange={(phone) =>
            onChange(link.kind === "phone" ? { kind: "phone", phone } : { ...link, kind: "whatsapp", phone })
          }
        />
      )}

      {link.kind === "whatsapp" && (
        <TextField
          label={t("fields.linkMessage")}
          value={link.message ?? ""}
          transactionKey={`${transactionKey}:message`}
          onChange={(message) => onChange({ ...link, message })}
        />
      )}
    </div>
  );
}
