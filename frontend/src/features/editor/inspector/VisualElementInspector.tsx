import {
  ICON_NAMES,
  SOCIAL_NETWORKS,
  socialUrlMatchesNetwork,
  VIDEO_PROVIDERS,
  type BuilderElement,
  type BuilderPage,
} from "@websitebuilder/shared";
import { useTranslation } from "react-i18next";

import { ColorField, InspectorGroup, NumberField, SelectField, TextField, ToggleField } from "./controls";
import { ItemsEditor } from "./ItemsEditor";
import { MediaPickerField } from "./MediaPickerField";
import { LinkEditor } from "./LinkEditor";

/**
 * Content editing for the blocks that carry structured data.
 *
 * One file rather than fifteen: every one of these is the same three moves — a few typed fields, a
 * repeatable list, and a link — and splitting them apart would mean fifteen places to keep the same
 * transaction and validation behaviour consistent. Style, layout and advanced controls are shared
 * and live in the inspector shell; what is here is what makes each block *this* block.
 */
export function VisualElementInspector({
  element,
  pages,
  patch,
  transactionKey,
}: {
  element: BuilderElement;
  pages: readonly BuilderPage[];
  patch: (recipe: (current: BuilderElement) => BuilderElement) => void;
  transactionKey: string;
}) {
  const { t } = useTranslation("builder");
  const key = transactionKey;

  /** Applies a partial payload to whichever element type is selected. */
  const set = (values: Record<string, unknown>) =>
    patch((current) => ({ ...current, ...values }) as BuilderElement);

  const iconOptions = ICON_NAMES.map((name) => ({ value: name, label: name }));

  switch (element.type) {
    case "icon":
      return (
        <>
          <InspectorGroup titleKey="content">
            <SelectField
              label={t("fields.icon")}
              value={element.icon}
              options={iconOptions}
              onChange={(icon) => set({ icon })}
            />
            <LinkEditor
              link={element.link}
              pages={pages}
              transactionKey={`${key}:link`}
              onChange={(link) => set({ link })}
            />
          </InspectorGroup>
          <InspectorGroup titleKey="style">
            <NumberField
              label={t("fields.size")}
              value={element.size}
              min={8}
              max={200}
              transactionKey={`${key}:size`}
              onChange={(size) => set({ size: Math.round(size) })}
            />
            <ColorField label={t("fields.color")} value={element.color} transactionKey={`${key}:color`} onChange={(color) => set({ color })} />
          </InspectorGroup>
        </>
      );

    case "iconList":
      return (
        <>
          <InspectorGroup titleKey="content">
            <ItemsEditor
              label={t("fields.items")}
              items={element.items}
              max={20}
              create={() => ({ icon: ICON_NAMES[0]!, text: "" })}
              describe={(item, index) => item.text || t("items.position", { index: index + 1 })}
              onChange={(items) => set({ items })}
            >
              {(item, update) => (
                <>
                  <SelectField
                    label={t("fields.icon")}
                    value={item.icon}
                    options={iconOptions}
                    onChange={(icon) => update({ ...item, icon })}
                  />
                  <TextField
                    label={t("fields.text")}
                    value={item.text}
                    transactionKey={`${key}:item`}
                    onChange={(text) => update({ ...item, text })}
                  />
                </>
              )}
            </ItemsEditor>
          </InspectorGroup>
          <InspectorGroup titleKey="style">
            <NumberField label={t("fields.iconSize")} value={element.iconSize} min={8} max={64} transactionKey={`${key}:iconSize`} onChange={(iconSize) => set({ iconSize: Math.round(iconSize) })} />
            <NumberField label={t("fields.gap")} value={element.gap} min={0} max={48} transactionKey={`${key}:gap`} onChange={(gap) => set({ gap: Math.round(gap) })} />
          </InspectorGroup>
        </>
      );

    case "divider":
      return (
        <InspectorGroup titleKey="style">
          <NumberField label={t("fields.thickness")} value={element.thickness} min={1} max={20} transactionKey={`${key}:thickness`} onChange={(thickness) => set({ thickness: Math.round(thickness) })} />
          <SelectField
            label={t("fields.lineStyle")}
            value={element.style}
            options={(["solid", "dashed", "dotted"] as const).map((value) => ({ value, label: t(`options.lineStyle.${value}`) }))}
            onChange={(style) => set({ style })}
          />
          <ColorField label={t("fields.color")} value={element.color} transactionKey={`${key}:color`} onChange={(color) => set({ color })} />
        </InspectorGroup>
      );

    case "spacer":
      // Height is geometry, and geometry is edited in the shared Layout group with its device
      // overrides. A second control here would be a second answer to the same question.
      return (
        <InspectorGroup titleKey="content">
          <p className="text-[11px] text-ink-500">{t("fields.spacerHint")}</p>
        </InspectorGroup>
      );

    case "accordion":
      return (
        <>
          <InspectorGroup titleKey="content">
            <ItemsEditor
              label={t("fields.questions")}
              items={element.items}
              max={30}
              create={() => ({ question: "", answer: "" })}
              describe={(item, index) => item.question || t("items.position", { index: index + 1 })}
              onChange={(items) => set({ items })}
            >
              {(item, update) => (
                <>
                  <TextField label={t("fields.question")} value={item.question} transactionKey={`${key}:question`} onChange={(question) => update({ ...item, question })} />
                  <TextField label={t("fields.answer")} value={item.answer} multiline transactionKey={`${key}:answer`} onChange={(answer) => update({ ...item, answer })} />
                </>
              )}
            </ItemsEditor>
          </InspectorGroup>
          <InspectorGroup titleKey="advanced" defaultOpen={false}>
            <ToggleField label={t("fields.allowMultiple")} checked={element.allowMultiple} onChange={(allowMultiple) => set({ allowMultiple })} />
          </InspectorGroup>
        </>
      );

    case "tabs":
      return (
        <InspectorGroup titleKey="content">
          <ItemsEditor
            label={t("fields.tabs")}
            items={element.items}
            max={12}
            create={() => ({ label: "", content: "" })}
            describe={(item, index) => item.label || t("items.position", { index: index + 1 })}
            onChange={(items) => set({ items })}
          >
            {(item, update) => (
              <>
                <TextField label={t("fields.label")} value={item.label} transactionKey={`${key}:label`} onChange={(label) => update({ ...item, label })} />
                <TextField label={t("fields.content")} value={item.content} multiline transactionKey={`${key}:tabContent`} onChange={(content) => update({ ...item, content })} />
              </>
            )}
          </ItemsEditor>
        </InspectorGroup>
      );

    case "gallery":
      return (
        <>
          <InspectorGroup titleKey="content">
            <ItemsEditor
              label={t("fields.images")}
              items={element.mediaIds}
              max={60}
              create={() => ""}
              describe={(item, index) => item || t("items.position", { index: index + 1 })}
              onChange={(mediaIds) => set({ mediaIds })}
            >
              {(item, update) => <MediaPickerField label={t("fields.image")} value={item} onChange={update} />}
            </ItemsEditor>
          </InspectorGroup>
          <InspectorGroup titleKey="style">
            <NumberField label={t("fields.columns")} value={element.columns} min={1} max={6} transactionKey={`${key}:columns`} onChange={(columns) => set({ columns: Math.round(columns) })} />
            <NumberField label={t("fields.gap")} value={element.gap} min={0} max={48} transactionKey={`${key}:gap`} onChange={(gap) => set({ gap: Math.round(gap) })} />
            <ToggleField label={t("fields.lightbox")} checked={element.lightbox} onChange={(lightbox) => set({ lightbox })} />
          </InspectorGroup>
        </>
      );

    case "video":
      return (
        <InspectorGroup titleKey="content">
          <SelectField
            label={t("fields.provider")}
            value={element.provider}
            options={VIDEO_PROVIDERS.map((value) => ({ value, label: t(`options.provider.${value}`) }))}
            onChange={(provider) => set({ provider })}
          />
          <TextField label={t("fields.videoId")} value={element.videoId} transactionKey={`${key}:videoId`} onChange={(videoId) => set({ videoId })} />
          <p className="text-[11px] text-ink-500">{t("fields.videoIdHint")}</p>
          <TextField label={t("fields.title")} value={element.title} transactionKey={`${key}:title`} onChange={(title) => set({ title })} />
        </InspectorGroup>
      );

    case "socialLinks":
      return (
        <>
          <InspectorGroup titleKey="content">
            <ItemsEditor
              label={t("fields.profiles")}
              items={element.items}
              max={12}
              create={() => ({ network: SOCIAL_NETWORKS[0]!, url: "https://" })}
              describe={(item) => item.network}
              onChange={(items) => set({ items })}
            >
              {(item, update) => (
                <>
                  <SelectField
                    label={t("fields.network")}
                    value={item.network}
                    options={SOCIAL_NETWORKS.map((value) => ({ value, label: value }))}
                    onChange={(network) => update({ ...item, network })}
                  />
                  <TextField label={t("fields.address")} value={item.url} transactionKey={`${key}:socialUrl`} onChange={(url) => update({ ...item, url })} />
                  {item.url.trim() !== "" && !socialUrlMatchesNetwork(item.network, item.url) && (
                    // A row labelled Instagram that opens somewhere else is the shape of a phishing
                    // link, and the person who added it is rarely the one who notices.
                    <p role="alert" className="text-[11px] text-red-700">
                      {t("fields.socialMismatch", { network: item.network })}
                    </p>
                  )}
                </>
              )}
            </ItemsEditor>
          </InspectorGroup>
          <InspectorGroup titleKey="style">
            <NumberField label={t("fields.iconSize")} value={element.iconSize} min={12} max={64} transactionKey={`${key}:iconSize`} onChange={(iconSize) => set({ iconSize: Math.round(iconSize) })} />
            <NumberField label={t("fields.gap")} value={element.gap} min={0} max={48} transactionKey={`${key}:gap`} onChange={(gap) => set({ gap: Math.round(gap) })} />
          </InspectorGroup>
        </>
      );

    case "downloadButton":
      return (
        <InspectorGroup titleKey="content">
          <MediaPickerField
            label={t("fields.file")}
            value={element.mediaId}
            onChange={(mediaId) => set({ mediaId })}
            onClear={() => set({ mediaId: "" })}
          />
          <TextField label={t("fields.label")} value={element.label} transactionKey={`${key}:label`} onChange={(label) => set({ label })} />
        </InspectorGroup>
      );

    case "breadcrumbs":
      return (
        <InspectorGroup titleKey="content">
          <SelectField
            label={t("fields.separator")}
            value={element.separator}
            options={(["chevron", "slash", "dot"] as const).map((value) => ({ value, label: t(`options.separator.${value}`) }))}
            onChange={(separator) => set({ separator })}
          />
          <TextField label={t("fields.navigationLabel")} value={element.label} transactionKey={`${key}:label`} onChange={(label) => set({ label })} />
          <p className="text-[11px] text-ink-500">{t("fields.breadcrumbsHint")}</p>
        </InspectorGroup>
      );

    case "table":
      return (
        <>
          <InspectorGroup titleKey="content">
            <TextField label={t("fields.caption")} value={element.caption} transactionKey={`${key}:caption`} onChange={(caption) => set({ caption })} />
            <ToggleField label={t("fields.hasHeaderRow")} checked={element.hasHeaderRow} onChange={(hasHeaderRow) => set({ hasHeaderRow })} />
            <ItemsEditor
              label={t("fields.columnsLabel")}
              items={element.headers}
              max={12}
              create={() => ""}
              describe={(item, index) => item || t("items.position", { index: index + 1 })}
              onChange={(headers) =>
                set({
                  headers,
                  // Rows follow the columns, so a table can never store cells nobody can reach.
                  rows: element.rows.map((row) => headers.map((_, index) => row[index] ?? "")),
                })
              }
            >
              {(item, update) => <TextField label={t("fields.header")} value={item} transactionKey={`${key}:header`} onChange={update} />}
            </ItemsEditor>
            <ItemsEditor
              label={t("fields.rows")}
              items={element.rows}
              max={200}
              create={() => element.headers.map(() => "")}
              describe={(_, index) => t("items.row", { index: index + 1 })}
              onChange={(rows) => set({ rows })}
            >
              {(row, update) => (
                <>
                  {row.map((cell, column) => (
                    <TextField
                      key={column}
                      label={element.headers[column] || t("items.column", { index: column + 1 })}
                      value={cell}
                      transactionKey={`${key}:cell`}
                      onChange={(value) => update(row.map((current, index) => (index === column ? value : current)))}
                    />
                  ))}
                </>
              )}
            </ItemsEditor>
          </InspectorGroup>
        </>
      );

    case "pricingTable":
      return (
        <InspectorGroup titleKey="content">
          <ItemsEditor
            label={t("fields.plans")}
            items={element.plans}
            max={6}
            create={() => ({ name: "", price: "", period: "", features: [], highlighted: false, link: { kind: "none" as const }, ctaLabel: "" })}
            describe={(item, index) => item.name || t("items.position", { index: index + 1 })}
            onChange={(plans) => set({ plans })}
          >
            {(plan, update) => (
              <>
                <TextField label={t("fields.planName")} value={plan.name} transactionKey={`${key}:planName`} onChange={(name) => update({ ...plan, name })} />
                <TextField label={t("fields.price")} value={plan.price} transactionKey={`${key}:price`} onChange={(price) => update({ ...plan, price })} />
                <TextField label={t("fields.period")} value={plan.period} transactionKey={`${key}:period`} onChange={(period) => update({ ...plan, period })} />
                <ToggleField label={t("fields.highlighted")} checked={plan.highlighted} onChange={(highlighted) => update({ ...plan, highlighted })} />
                <TextField label={t("fields.ctaLabel")} value={plan.ctaLabel} transactionKey={`${key}:ctaLabel`} onChange={(ctaLabel) => update({ ...plan, ctaLabel })} />
                <LinkEditor link={plan.link} pages={pages} transactionKey={`${key}:planLink`} onChange={(link) => update({ ...plan, link })} />
                <ItemsEditor
                  label={t("fields.features")}
                  items={plan.features}
                  max={20}
                  create={() => ""}
                  describe={(feature, index) => feature || t("items.position", { index: index + 1 })}
                  onChange={(features) => update({ ...plan, features })}
                >
                  {(feature, updateFeature) => (
                    <TextField label={t("fields.feature")} value={feature} transactionKey={`${key}:feature`} onChange={updateFeature} />
                  )}
                </ItemsEditor>
              </>
            )}
          </ItemsEditor>
        </InspectorGroup>
      );

    case "announcementBar":
      return (
        <>
          <InspectorGroup titleKey="content">
            <TextField label={t("fields.text")} value={element.text} transactionKey={`${key}:text`} onChange={(text) => set({ text })} />
            <LinkEditor link={element.link} pages={pages} transactionKey={`${key}:link`} onChange={(link) => set({ link })} />
          </InspectorGroup>
          <InspectorGroup titleKey="style">
            <ColorField label={t("fields.backgroundColor")} value={element.backgroundColor} transactionKey={`${key}:background`} onChange={(backgroundColor) => set({ backgroundColor })} />
            <ColorField label={t("fields.textColor")} value={element.textColor} transactionKey={`${key}:textColor`} onChange={(textColor) => set({ textColor })} />
          </InspectorGroup>
          <InspectorGroup titleKey="advanced" defaultOpen={false}>
            <ToggleField label={t("fields.dismissible")} checked={element.dismissible} onChange={(dismissible) => set({ dismissible })} />
          </InspectorGroup>
        </>
      );

    case "form":
      return (
        <>
          <InspectorGroup titleKey="content">
            <TextField label={t("fields.formId")} value={element.formId} transactionKey={`${key}:formId`} onChange={(formId) => set({ formId })} />
            <p className="text-[11px] text-ink-500">{t("fields.formIdHint")}</p>
            <TextField label={t("fields.submitLabel")} value={element.submitLabel} transactionKey={`${key}:submitLabel`} onChange={(submitLabel) => set({ submitLabel })} />
            <TextField label={t("fields.successMessage")} value={element.successMessage} multiline transactionKey={`${key}:success`} onChange={(successMessage) => set({ successMessage })} />
            <TextField label={t("fields.errorMessage")} value={element.errorMessage} multiline transactionKey={`${key}:error`} onChange={(errorMessage) => set({ errorMessage })} />
          </InspectorGroup>
          <InspectorGroup titleKey="advanced" defaultOpen={false}>
            <ToggleField label={t("fields.consentRequired")} checked={element.consentRequired} onChange={(consentRequired) => set({ consentRequired })} />
            {element.consentRequired && (
              <TextField label={t("fields.consentText")} value={element.consentText} multiline transactionKey={`${key}:consent`} onChange={(consentText) => set({ consentText })} />
            )}
          </InspectorGroup>
        </>
      );

    default:
      // The four core blocks are handled by the inspector that owns their typography and media
      // controls; this component is only reached for the structured ones.
      return null;
  }
}
