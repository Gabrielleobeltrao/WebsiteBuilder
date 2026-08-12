import {
  deviceOriginOf,
  resolveElementForDevice,
  TEXT_TAGS,
  type BuilderElement,
  type BuilderPage,
} from "@websitebuilder/shared";
import { useTranslation } from "react-i18next";

import { selectEditingDevice, useEditorStore } from "@/features/editor/store/editorStore";
import { DeviceValue } from "./DeviceValue";
import { ColorField, InspectorGroup, LengthField, NumberField, SelectField, TextField, ToggleField } from "./controls";
import { LinkEditor } from "./LinkEditor";
import { MediaPickerField } from "./MediaPickerField";
import { VisualElementInspector } from "./VisualElementInspector";

/**
 * One inspector for every element type, always in the same five groups. Only the controls that can
 * actually affect the selected type are rendered — a disabled control that can never do anything is
 * worse than an absent one.
 */

/** A small bundled list. Arbitrary remote font loading is deliberately out of scope. */
const FONTS = ["Inter", "Inter Tight", "Georgia", "Times New Roman", "Courier New"] as const;
const WEIGHTS = [300, 400, 500, 600, 700, 800] as const;

export function ElementInspector({ element, pages }: { element: BuilderElement; pages: readonly BuilderPage[] }) {
  const { t } = useTranslation("builder");
  const store = useEditorStore();
  const key = `element:${element.id}`;
  const device = useEditorStore(selectEditingDevice);
  const resolved = resolveElementForDevice({
    device,
    base: element.responsiveLayout,
    geometry: element.geometry,
    overrides: element.breakpointOverrides,
  });

  const patch = (recipe: (current: BuilderElement) => BuilderElement) =>
    store.update((document) => {
      const walk = (elements: readonly BuilderElement[]): BuilderElement[] =>
        elements.map((candidate) => {
          if (candidate.id === element.id) return recipe(candidate);
          if (candidate.type === "container") return { ...candidate, children: walk(candidate.children) };
          return candidate;
        });
      return {
        ...document,
        pages: document.pages.map((page) => ({
          ...page,
          sections: page.sections.map((section) => ({ ...section, elements: walk(section.elements) })),
        })),
      };
    });

  const structured = !["text", "image", "button", "container"].includes(element.type);

  return (
    <>
      {structured && (
        <VisualElementInspector element={element} pages={pages} patch={patch} transactionKey={key} />
      )}

      {!structured && (
      <InspectorGroup titleKey="content">
        {element.type === "text" && (
          <>
            <TextField
              label={t("fields.content")}
              value={element.content}
              transactionKey={`${key}:content`}
              multiline
              onChange={(content) => patch((current) => (current.type === "text" ? { ...current, content } : current))}
            />
            <SelectField
              label={t("fields.tag")}
              value={element.tag}
              options={TEXT_TAGS.map((tag) => ({ value: tag, label: t(`options.tag.${tag}`) }))}
              onChange={(tag) => patch((current) => (current.type === "text" ? { ...current, tag } : current))}
            />
          </>
        )}

        {element.type === "image" && (
          <>
            <SelectField
              label={t("fields.imageSource")}
              value={element.source.kind}
              options={(["empty", "url", "media"] as const).map((kind) => ({
                value: kind,
                label: t(`options.source.${kind}`),
              }))}
              onChange={(kind) =>
                patch((current) =>
                  current.type === "image"
                    ? {
                        ...current,
                        source:
                          kind === "url"
                            ? { kind: "url", url: "" }
                            : kind === "media"
                              ? { kind: "media", mediaId: "" }
                              : { kind: "empty" },
                      }
                    : current,
                )
              }
            />
            {element.source.kind === "url" && (
              <TextField
                label={t("fields.imageUrl")}
                value={element.source.url}
                transactionKey={`${key}:url`}
                onChange={(url) =>
                  patch((current) =>
                    current.type === "image" ? { ...current, source: { kind: "url", url } } : current,
                  )
                }
              />
            )}
            {element.source.kind === "media" && (
              <MediaPickerField
                label={t("fields.image")}
                value={element.source.mediaId}
                onChange={(mediaId) =>
                  patch((current) =>
                    current.type === "image" ? { ...current, source: { kind: "media", mediaId } } : current,
                  )
                }
                onClear={() =>
                  patch((current) =>
                    current.type === "image" ? { ...current, source: { kind: "media", mediaId: "" } } : current,
                  )
                }
              />
            )}
            <ToggleField
              label={t("fields.decorative")}
              checked={element.decorative}
              onChange={(decorative) =>
                patch((current) => (current.type === "image" ? { ...current, decorative } : current))
              }
            />
            {!element.decorative && (
              <TextField
                label={t("fields.alt")}
                value={element.alt}
                transactionKey={`${key}:alt`}
                onChange={(alt) => patch((current) => (current.type === "image" ? { ...current, alt } : current))}
              />
            )}
            <TextField
              label={t("fields.caption")}
              value={element.caption ?? ""}
              transactionKey={`${key}:caption`}
              onChange={(caption) => patch((current) => (current.type === "image" ? { ...current, caption } : current))}
            />
            <LinkEditor
              link={element.link ?? { kind: "none" }}
              pages={pages}
              transactionKey={`${key}:imageLink`}
              onChange={(link) => patch((current) => (current.type === "image" ? { ...current, link } : current))}
            />
            <SelectField
              label={t("fields.loading")}
              value={element.loading ?? "lazy"}
              options={(["lazy", "eager"] as const).map((value) => ({ value, label: t(`options.loading.${value}`) }))}
              onChange={(loading) => patch((current) => (current.type === "image" ? { ...current, loading } : current))}
            />
            <p className="text-[11px] text-ink-500">{t("fields.loadingHint")}</p>
          </>
        )}

        {element.type === "button" && (
          <>
            <TextField
              label={t("fields.text")}
              value={element.text}
              transactionKey={`${key}:text`}
              onChange={(text) => patch((current) => (current.type === "button" ? { ...current, text } : current))}
            />
            <LinkEditor
              link={element.link}
              pages={pages}
              transactionKey={`${key}:link`}
              onChange={(link) => patch((current) => (current.type === "button" ? { ...current, link } : current))}
            />
          </>
        )}
      </InspectorGroup>
      )}

      {!structured && (
      <InspectorGroup titleKey="style">
        {element.type === "text" && (
          <>
            <SelectField
              label={t("fields.fontFamily")}
              value={element.style.fontFamily}
              options={FONTS.map((font) => ({ value: font, label: font }))}
              onChange={(fontFamily) =>
                patch((current) =>
                  current.type === "text" ? { ...current, style: { ...current.style, fontFamily } } : current,
                )
              }
            />
            <LengthField
              label={t("fields.fontSize")}
              value={element.style.fontSize}
              transactionKey={`${key}:fontSize`}
              onChange={(fontSize) =>
                patch((current) =>
                  current.type === "text" ? { ...current, style: { ...current.style, fontSize } } : current,
                )
              }
            />
            <SelectField
              label={t("fields.fontWeight")}
              value={String(element.style.fontWeight)}
              options={WEIGHTS.map((weight) => ({ value: String(weight), label: String(weight) }))}
              onChange={(weight) =>
                patch((current) =>
                  current.type === "text"
                    ? { ...current, style: { ...current.style, fontWeight: Number(weight) } }
                    : current,
                )
              }
            />
            <SelectField
              label={t("fields.textAlign")}
              value={element.style.textAlign}
              options={(["left", "center", "right"] as const).map((value) => ({
                value,
                label: t(`options.align.${value}`),
              }))}
              onChange={(textAlign) =>
                patch((current) =>
                  current.type === "text" ? { ...current, style: { ...current.style, textAlign } } : current,
                )
              }
            />
            <ColorField
              label={t("fields.color")}
              value={element.style.color}
              transactionKey={`${key}:color`}
              onChange={(color) =>
                patch((current) =>
                  current.type === "text" ? { ...current, style: { ...current.style, color } } : current,
                )
              }
            />
            <NumberField
              label={t("fields.lineHeight")}
              value={element.style.lineHeight}
              min={0.8}
              max={3}
              step={0.1}
              transactionKey={`${key}:lineHeight`}
              onChange={(lineHeight) =>
                patch((current) =>
                  current.type === "text" ? { ...current, style: { ...current.style, lineHeight } } : current,
                )
              }
            />
          </>
        )}

        {element.type === "image" && (
          <>
            <SelectField
              label={t("fields.objectFit")}
              value={element.style.objectFit}
              options={(["cover", "contain", "fill"] as const).map((value) => ({
                value,
                label: t(`options.objectFit.${value}`),
              }))}
              onChange={(objectFit) =>
                patch((current) =>
                  current.type === "image" ? { ...current, style: { ...current.style, objectFit } } : current,
                )
              }
            />
            <NumberField
              label={t("fields.borderRadius")}
              value={element.style.borderRadius}
              min={0}
              transactionKey={`${key}:radius`}
              onChange={(borderRadius) =>
                patch((current) =>
                  current.type === "image" ? { ...current, style: { ...current.style, borderRadius } } : current,
                )
              }
            />
          </>
        )}

        {element.type === "button" && (
          <>
            <ColorField
              label={t("fields.textColor")}
              value={element.style.textColor}
              transactionKey={`${key}:textColor`}
              onChange={(textColor) =>
                patch((current) =>
                  current.type === "button" ? { ...current, style: { ...current.style, textColor } } : current,
                )
              }
            />
            <ColorField
              label={t("fields.backgroundColor")}
              value={element.style.backgroundColor}
              transactionKey={`${key}:backgroundColor`}
              onChange={(backgroundColor) =>
                patch((current) =>
                  current.type === "button" ? { ...current, style: { ...current.style, backgroundColor } } : current,
                )
              }
            />
            <NumberField
              label={t("fields.borderRadius")}
              value={element.style.borderRadius}
              min={0}
              transactionKey={`${key}:radius`}
              onChange={(borderRadius) =>
                patch((current) =>
                  current.type === "button" ? { ...current, style: { ...current.style, borderRadius } } : current,
                )
              }
            />
            <SelectField
              label={t("fields.horizontalAlign")}
              value={element.style.horizontalAlign}
              options={(["left", "center", "right"] as const).map((value) => ({
                value,
                label: t(`options.align.${value}`),
              }))}
              onChange={(horizontalAlign) =>
                patch((current) =>
                  current.type === "button" ? { ...current, style: { ...current.style, horizontalAlign } } : current,
                )
              }
            />
          </>
        )}
      </InspectorGroup>
      )}

      <InspectorGroup titleKey="layout">
        {/*
          The geometry of the device on the canvas, not the base geometry.

          Both the value shown and the value written follow the device switcher. Showing the base
          while editing a device would be the same lie in reverse: an author would correct a number
          that is not the one their phone uses.
        */}
        <div className="grid grid-cols-2 gap-2">
          {(["x", "y", "width", "height"] as const).map((axis) => (
            <div key={axis}>
              <NumberField
                label={t(`fields.${axis}`)}
                value={resolved.authoredGeometry[axis]}
                {...(axis === "width" || axis === "height" ? { min: 8 } : {})}
                transactionKey={`${key}:${axis}:${device}`}
                onChange={(value) =>
                  store.moveElement(element.id, { ...resolved.authoredGeometry, [axis]: value })
                }
              />
              <DeviceValue
                origin={deviceOriginOf(device, resolved.origins.geometry)}
                source={resolved.origins.geometry}
                onReset={() => store.clearBreakpointOverride(element.id, device, "geometry", axis)}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {(["front", "forward", "backward", "back"] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              onClick={() => store.changeZOrder(element.id, direction)}
              className="rounded border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-600"
            >
              {t(`zorder.${direction}`)}
            </button>
          ))}
        </div>
      </InspectorGroup>

      <InspectorGroup titleKey="responsive" defaultOpen={false}>
        <LengthField
          label={t("fields.width")}
          value={element.responsiveLayout.width}
          transactionKey={`${key}:responsiveWidth`}
          onChange={(width) =>
            patch((current) => ({ ...current, responsiveLayout: { ...current.responsiveLayout, width } }))
          }
        />
        <LengthField
          label={t("fields.height")}
          value={element.responsiveLayout.height}
          transactionKey={`${key}:responsiveHeight`}
          onChange={(height) =>
            patch((current) => ({ ...current, responsiveLayout: { ...current.responsiveLayout, height } }))
          }
        />
      </InspectorGroup>

      <InspectorGroup titleKey="advanced" defaultOpen={false}>
        <TextField
          label={t("fields.displayName")}
          value={element.name}
          transactionKey={`${key}:name`}
          onChange={(name) => store.renameElement(element.id, name)}
        />
        <ToggleField
          label={t("fields.locked")}
          checked={element.locked}
          onChange={(locked) => store.setElementFlag(element.id, "locked", locked)}
        />
        <ToggleField
          label={t("fields.hidden")}
          checked={element.hidden}
          onChange={(hidden) => store.setElementFlag(element.id, "hidden", hidden)}
        />
      </InspectorGroup>
    </>
  );
}
