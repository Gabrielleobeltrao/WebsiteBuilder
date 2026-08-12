import {
  CONTACT_ITEM_KINDS,
  FORM_PRESETS,
  hasTimezone,
  ICON_NAMES,
  SOCIAL_NETWORKS,
  socialUrlMatchesNetwork,
  VIDEO_PROVIDERS,
  type BuilderElement,
  type BuilderPage,
} from "@websitebuilder/shared";
import { useTranslation } from "react-i18next";

import { RichTextEditor } from "@/components/common/RichTextEditor";

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
              items={element.items}
              max={60}
              create={() => ({ mediaId: "", alt: "", decorative: false, caption: "" })}
              describe={(item, index) => item.alt || item.mediaId || t("items.position", { index: index + 1 })}
              onChange={(items) => set({ items })}
            >
              {(item, update) => (
                <>
                  <MediaPickerField
                    label={t("fields.image")}
                    value={item.mediaId}
                    onChange={(mediaId) => update({ ...item, mediaId })}
                  />
                  <ToggleField
                    label={t("fields.decorative")}
                    checked={item.decorative}
                    onChange={(decorative) => update({ ...item, decorative })}
                  />
                  {!item.decorative && (
                    <TextField
                      label={t("fields.alt")}
                      value={item.alt}
                      transactionKey={`${key}:galleryAlt`}
                      onChange={(alt) => update({ ...item, alt })}
                    />
                  )}
                  <TextField
                    label={t("fields.caption")}
                    value={item.caption}
                    transactionKey={`${key}:galleryCaption`}
                    onChange={(caption) => update({ ...item, caption })}
                  />
                </>
              )}
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

    case "form": {
      // Presentation only. What the form asks and what it says after a submission belong to the
      // definition, which the Forms Center edits once for every page that shows it.
      const presentation = element.presentation;
      const setPresentation = (values: Partial<typeof presentation>) =>
        set({ presentation: { ...presentation, ...values } });

      return (
        <>
          <InspectorGroup titleKey="content">
            <TextField label={t("fields.formId")} value={element.formId} transactionKey={`${key}:formId`} onChange={(formId) => set({ formId })} />
            <p className="text-[11px] text-ink-500">{t("fields.formIdHint")}</p>
          </InspectorGroup>
          <InspectorGroup titleKey="layout">
            <SelectField
              label={t("fields.formPreset")}
              value={presentation.preset}
              options={FORM_PRESETS.map((preset) => ({ value: preset, label: t(`fields.formPresetOption.${preset}` as "fields.formPresetOption.stacked") }))}
              onChange={(preset) => setPresentation({ preset: preset as typeof presentation.preset })}
            />
            <SelectField
              label={t("fields.formAlignment")}
              value={presentation.alignment}
              options={(["start", "center", "end"] as const).map((value) => ({
                value,
                label: t(`fields.formAlignmentOption.${value}` as "fields.formAlignmentOption.start"),
              }))}
              onChange={(alignment) => setPresentation({ alignment: alignment as typeof presentation.alignment })}
            />
            <NumberField label={t("fields.fieldGap")} value={presentation.fieldGap} min={0} max={64} transactionKey={`${key}:fieldGap`} onChange={(fieldGap) => setPresentation({ fieldGap })} />
            <NumberField label={t("fields.formPadding")} value={presentation.padding} min={0} max={96} transactionKey={`${key}:formPadding`} onChange={(padding) => setPresentation({ padding })} />
          </InspectorGroup>
          <InspectorGroup titleKey="style">
            <ColorField label={t("fields.backgroundColor")} value={presentation.backgroundColor} transactionKey={`${key}:formBackground`} onChange={(backgroundColor) => setPresentation({ backgroundColor })} />
            <ColorField label={t("fields.textColor")} value={presentation.textColor} transactionKey={`${key}:formText`} onChange={(textColor) => setPresentation({ textColor })} />
            <ColorField label={t("fields.accentColor")} value={presentation.accentColor} transactionKey={`${key}:formAccent`} onChange={(accentColor) => setPresentation({ accentColor })} />
            <ColorField label={t("fields.borderColor")} value={presentation.borderColor} transactionKey={`${key}:formBorder`} onChange={(borderColor) => setPresentation({ borderColor })} />
            <NumberField label={t("fields.borderWidth")} value={presentation.borderWidth} min={0} max={8} transactionKey={`${key}:formBorderWidth`} onChange={(borderWidth) => setPresentation({ borderWidth })} />
            <NumberField label={t("fields.borderRadius")} value={presentation.borderRadius} min={0} max={48} transactionKey={`${key}:formBorderRadius`} onChange={(borderRadius) => setPresentation({ borderRadius })} />
          </InspectorGroup>
        </>
      );
    }

    case "richText":
      return (
        <InspectorGroup titleKey="content">
          {/* The same editor the blog post body uses, against the same validated document shape.
              This block previously offered a sentence pointing at a canvas toolbar that does not
              exist, which left it as the one block in the catalog nobody could put words into. */}
          <RichTextEditor
            label={t("fields.richText")}
            value={element.content}
            onChange={(content) => set({ content })}
          />
          <p className="text-[11px] text-ink-500">{t("fields.richTextHint")}</p>
        </InspectorGroup>
      );

    case "navigationMenu":
      return (
        <>
          <InspectorGroup titleKey="content">
            <ItemsEditor
              label={t("fields.menuItems")}
              items={element.items}
              max={20}
              create={() => ({ label: "", link: { kind: "none" as const } })}
              describe={(item, index) => item.label || t("items.position", { index: index + 1 })}
              onChange={(items) => set({ items })}
            >
              {(item, update) => (
                <>
                  <TextField label={t("fields.label")} value={item.label} transactionKey={`${key}:menuLabel`} onChange={(label) => update({ ...item, label })} />
                  <LinkEditor link={item.link} pages={pages} transactionKey={`${key}:menuLink`} onChange={(link) => update({ ...item, link })} />
                </>
              )}
            </ItemsEditor>
          </InspectorGroup>
          <InspectorGroup titleKey="style">
            <SelectField
              label={t("fields.orientation")}
              value={element.orientation}
              options={(["horizontal", "vertical"] as const).map((value) => ({ value, label: t(`options.orientation.${value}`) }))}
              onChange={(orientation) => set({ orientation })}
            />
            <NumberField label={t("fields.collapseBelow")} value={element.collapseBelow} min={320} max={1440} transactionKey={`${key}:collapse`} onChange={(collapseBelow) => set({ collapseBelow: Math.round(collapseBelow) })} />
          </InspectorGroup>
        </>
      );

    case "siteLogo":
      return (
        <InspectorGroup titleKey="content">
          <MediaPickerField label={t("fields.image")} value={element.mediaId} onChange={(mediaId) => set({ mediaId })} onClear={() => set({ mediaId: "" })} />
          <TextField label={t("fields.alt")} value={element.alt} transactionKey={`${key}:logoAlt`} onChange={(alt) => set({ alt })} />
          <TextField label={t("fields.fallbackText")} value={element.fallbackText} transactionKey={`${key}:fallback`} onChange={(fallbackText) => set({ fallbackText })} />
          <ToggleField label={t("fields.linksHome")} checked={element.linksHome} onChange={(linksHome) => set({ linksHome })} />
        </InspectorGroup>
      );

    case "testimonial":
      return (
        <InspectorGroup titleKey="content">
          <TextField label={t("fields.quote")} value={element.quote} multiline transactionKey={`${key}:quote`} onChange={(quote) => set({ quote })} />
          <TextField label={t("fields.personName")} value={element.personName} transactionKey={`${key}:personName`} onChange={(personName) => set({ personName })} />
          <TextField label={t("fields.personRole")} value={element.personRole} transactionKey={`${key}:personRole`} onChange={(personRole) => set({ personRole })} />
          <MediaPickerField label={t("fields.avatar")} value={element.avatarMediaId} onChange={(avatarMediaId) => set({ avatarMediaId })} onClear={() => set({ avatarMediaId: "" })} />
          <SelectField
            label={t("fields.rating")}
            value={element.rating === undefined ? "none" : String(element.rating)}
            options={["none", "1", "2", "3", "4", "5"].map((value) => ({ value, label: value === "none" ? t("fields.noRating") : value }))}
            onChange={(value) => set(value === "none" ? { rating: undefined } : { rating: Number(value) })}
          />
        </InspectorGroup>
      );

    case "carousel":
      return (
        <>
          <InspectorGroup titleKey="content">
            <ItemsEditor
              label={t("fields.slides")}
              items={element.slides}
              max={20}
              create={() => ({ mediaId: "", alt: "", heading: "", text: "", link: { kind: "none" as const }, ctaLabel: "" })}
              describe={(item, index) => item.heading || t("items.position", { index: index + 1 })}
              onChange={(slides) => set({ slides })}
            >
              {(slide, update) => (
                <>
                  <MediaPickerField label={t("fields.image")} value={slide.mediaId} onChange={(mediaId) => update({ ...slide, mediaId })} />
                  <TextField label={t("fields.alt")} value={slide.alt} transactionKey={`${key}:slideAlt`} onChange={(alt) => update({ ...slide, alt })} />
                  <TextField label={t("fields.heading")} value={slide.heading} transactionKey={`${key}:slideHeading`} onChange={(heading) => update({ ...slide, heading })} />
                  <TextField label={t("fields.text")} value={slide.text} multiline transactionKey={`${key}:slideText`} onChange={(text) => update({ ...slide, text })} />
                  <TextField label={t("fields.ctaLabel")} value={slide.ctaLabel} transactionKey={`${key}:slideCta`} onChange={(ctaLabel) => update({ ...slide, ctaLabel })} />
                  <LinkEditor link={slide.link} pages={pages} transactionKey={`${key}:slideLink`} onChange={(link) => update({ ...slide, link })} />
                </>
              )}
            </ItemsEditor>
          </InspectorGroup>
          <InspectorGroup titleKey="advanced" defaultOpen={false}>
            <NumberField label={t("fields.autoplaySeconds")} value={element.autoplaySeconds} min={0} max={60} transactionKey={`${key}:autoplay`} onChange={(autoplaySeconds) => set({ autoplaySeconds: Math.round(autoplaySeconds) })} />
            <p className="text-[11px] text-ink-500">{t("fields.autoplayHint")}</p>
          </InspectorGroup>
        </>
      );

    case "contactInfo":
      return (
        <>
          <InspectorGroup titleKey="content">
            <ItemsEditor
              label={t("fields.details")}
              items={element.items}
              max={12}
              create={() => ({ kind: "email" as const, label: "", value: "" })}
              describe={(item, index) => item.value || t("items.position", { index: index + 1 })}
              onChange={(items) => set({ items })}
            >
              {(item, update) => (
                <>
                  <SelectField
                    label={t("fields.detailKind")}
                    value={item.kind}
                    options={CONTACT_ITEM_KINDS.map((value) => ({ value, label: t(`options.contact.${value}`) }))}
                    onChange={(kind) => update({ ...item, kind })}
                  />
                  <TextField label={t("fields.label")} value={item.label} transactionKey={`${key}:contactLabel`} onChange={(label) => update({ ...item, label })} />
                  <TextField label={t("fields.value")} value={item.value} transactionKey={`${key}:contactValue`} onChange={(value) => update({ ...item, value })} />
                </>
              )}
            </ItemsEditor>
          </InspectorGroup>
          <InspectorGroup titleKey="style">
            <NumberField label={t("fields.iconSize")} value={element.iconSize} min={12} max={48} transactionKey={`${key}:contactIconSize`} onChange={(iconSize) => set({ iconSize: Math.round(iconSize) })} />
          </InspectorGroup>
        </>
      );

    case "counter":
      return (
        <InspectorGroup titleKey="content">
          <SelectField
            label={t("fields.display")}
            value={element.display}
            options={(["number", "bar"] as const).map((value) => ({ value, label: t(`options.display.${value}`) }))}
            onChange={(display) => set({ display })}
          />
          <NumberField label={t("fields.value")} value={element.value} transactionKey={`${key}:counterValue`} onChange={(value) => set({ value })} />
          {element.display === "bar" && (
            <NumberField label={t("fields.max")} value={element.max ?? 100} min={1} transactionKey={`${key}:counterMax`} onChange={(max) => set({ max })} />
          )}
          <TextField label={t("fields.prefix")} value={element.prefix} transactionKey={`${key}:prefix`} onChange={(prefix) => set({ prefix })} />
          <TextField label={t("fields.suffix")} value={element.suffix} transactionKey={`${key}:suffix`} onChange={(suffix) => set({ suffix })} />
          <TextField label={t("fields.label")} value={element.label} transactionKey={`${key}:counterLabel`} onChange={(label) => set({ label })} />
        </InspectorGroup>
      );

    case "countdown":
      return (
        <InspectorGroup titleKey="content">
          <TextField label={t("fields.target")} value={element.target} transactionKey={`${key}:target`} onChange={(target) => set({ target })} />
          {element.target.trim() !== "" && !hasTimezone(element.target) && (
            // A wall-clock time is a different moment in every timezone, which is how a launch
            // counts down to the wrong instant for half the visitors.
            <p role="alert" className="text-[11px] text-red-700">
              {t("fields.targetNeedsZone")}
            </p>
          )}
          <p className="text-[11px] text-ink-500">{t("fields.targetHint")}</p>
          <TextField label={t("fields.expiredText")} value={element.expiredText} transactionKey={`${key}:expired`} onChange={(expiredText) => set({ expiredText })} />
        </InspectorGroup>
      );

    case "tableOfContents":
      return (
        <InspectorGroup titleKey="content">
          <TextField label={t("fields.title")} value={element.title} transactionKey={`${key}:tocTitle`} onChange={(title) => set({ title })} />
          <NumberField label={t("fields.minLevel")} value={element.minLevel} min={1} max={6} transactionKey={`${key}:minLevel`} onChange={(minLevel) => set({ minLevel: Math.round(minLevel) })} />
          <NumberField label={t("fields.maxLevel")} value={element.maxLevel} min={1} max={6} transactionKey={`${key}:maxLevel`} onChange={(maxLevel) => set({ maxLevel: Math.round(maxLevel) })} />
        </InspectorGroup>
      );

    default:
      // The four core blocks are handled by the inspector that owns their typography and media
      // controls; this component is only reached for the structured ones.
      return null;
  }
}
