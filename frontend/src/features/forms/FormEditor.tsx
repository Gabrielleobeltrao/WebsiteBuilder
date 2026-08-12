import {
  buildFormTemplate,
  FORM_FIELD_TYPES,
  FORM_TEMPLATE_IDS,
  findSetupIssues,
  type BuilderPage,
  type FormDefinitionInput,
  type FormField,
  type FormFieldType,
  type FormTemplateId,
} from "@websitebuilder/shared";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { ApiError } from "@/api/client";
import { formsApi } from "@/api/forms";
import { projectsApi } from "@/api/projects";

type EditorState =
  | { status: "loading" }
  | { status: "error"; code: string }
  | { status: "ready"; definition: FormDefinitionInput; revision: number | null };

type SaveState = "clean" | "dirty" | "saving" | "saved" | "conflict" | "failed";

/**
 * One form's questions, edited on their own screen.
 *
 * Deliberately not a canvas. What is being decided here — which questions are asked, in what order,
 * which are required, what happens after sending — has no visual arrangement to it, and the same
 * definition is shown by however many pages reference it, so a page is the wrong place to edit it
 * from.
 *
 * Every control is a real control. There is no JSON field: a product that asks somebody to type a
 * data structure has not finished the feature.
 */
export function FormEditor({
  workspaceId,
  projectId,
  formId,
  basePath,
}: {
  workspaceId: string;
  projectId: string;
  /** Absent for a new form. */
  formId?: string;
  basePath: string;
}) {
  const { t } = useTranslation(["forms", "errors", "common"]);
  const navigate = useNavigate();
  const nameId = useId();
  const templateId = useId();

  const [state, setState] = useState<EditorState>({ status: "loading" });
  const [save, setSave] = useState<SaveState>("clean");
  const [failure, setFailure] = useState<string | null>(null);
  const [pages, setPages] = useState<readonly BuilderPage[]>([]);

  /**
   * A plain resolver for keys the template factory chooses.
   *
   * The factory names its own keys, so the type-safe `t` cannot know them at the call site. One
   * narrow cast here beats spreading string casts through the factory itself.
   */
  const copy = useCallback((key: string) => (t as Translate)(`forms:${key}`), [t]);

  const template = useCallback((id: FormTemplateId) => buildFormTemplate(id, copy), [copy]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        // The page list is needed for "open another page" after sending, and a redirect to a page
        // that does not exist is a dead end the editor must not let somebody save.
        const project = await projectsApi.load(workspaceId, projectId, signal ? { signal } : {});
        setPages(project.pages);

        if (formId === undefined) {
          setState({ status: "ready", definition: template("blank"), revision: null });
          return;
        }

        const loaded = await formsApi.load(workspaceId, projectId, formId, signal ? { signal } : {});
        const { id, workspaceId: _w, projectId: _p, status, archived, revision, createdAt, updatedAt, usages, ...definition } =
          loaded;
        setState({ status: "ready", definition, revision });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", code: error instanceof ApiError ? error.code : "INTERNAL_ERROR" });
      }
    },
    [workspaceId, projectId, formId, template],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const definition = state.status === "ready" ? state.definition : null;

  const issues = useMemo(
    () =>
      definition === null
        ? []
        : findSetupIssues(definition, { pageExists: (pageId) => pages.some((page) => page.id === pageId) }),
    [definition, pages],
  );

  const patch = (values: Partial<FormDefinitionInput>) => {
    setState((current) =>
      current.status === "ready" ? { ...current, definition: { ...current.definition, ...values } } : current,
    );
    setSave("dirty");
  };

  const setFields = (fields: FormField[]) => patch({ fields });

  const submit = async () => {
    if (definition === null) return;
    if (definition.name.trim() === "") {
      setFailure("VALIDATION_ERROR");
      return;
    }

    setSave("saving");
    setFailure(null);
    try {
      if (formId === undefined || state.status !== "ready" || state.revision === null) {
        const created = await formsApi.create(workspaceId, projectId, definition);
        setSave("saved");
        navigate(`${basePath}/${created.id}/edit`, { replace: true });
        return;
      }

      const updated = await formsApi.update(workspaceId, projectId, formId, definition, state.revision);
      setState({ status: "ready", definition, revision: updated.revision });
      setSave("saved");
    } catch (error) {
      // A stale save is not a failure to retry blindly: somebody else's work is in the record, and
      // overwriting it without showing it is the thing revisions exist to prevent.
      if (error instanceof ApiError && error.code === "REVISION_CONFLICT") {
        setSave("conflict");
        return;
      }
      setSave("failed");
      setFailure(error instanceof ApiError ? error.code : "INTERNAL_ERROR");
    }
  };

  return (
    <div>
      <Link to={basePath} className="text-sm font-medium text-ink-600 underline underline-offset-4">
        {t("forms:actions.back")}
      </Link>

      <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-ink-950">
        {formId === undefined ? t("forms:editor.newTitle") : t("forms:editor.editTitle")}
      </h1>

      {state.status === "loading" && (
        <p role="status" className="mt-8 rounded-lg border border-ink-100 p-8 text-center text-ink-500">
          {t("common:state.loading")}
        </p>
      )}

      {state.status === "error" && (
        <div role="alert" className="mt-8 rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="text-sm text-red-800">{t(`errors:${state.code}` as "errors:INTERNAL_ERROR")}</p>
        </div>
      )}

      {save === "conflict" && (
        <div role="alert" className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">{t("forms:editor.conflict")}</p>
          <button
            type="button"
            onClick={() => {
              setSave("clean");
              void load();
            }}
            className="mt-3 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900"
          >
            {t("forms:editor.reload")}
          </button>
        </div>
      )}

      {failure !== null && (
        <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {t(`errors:${failure}` as "errors:INTERNAL_ERROR")}
        </p>
      )}

      {definition !== null && (
        <form
          className="mt-6 space-y-8"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <section className="space-y-3">
            <label htmlFor={nameId} className="block text-sm font-medium text-ink-800">
              {t("forms:editor.name")}
              <input
                id={nameId}
                value={definition.name}
                onChange={(event) => patch({ name: event.target.value })}
                className="mt-1 w-full max-w-md rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
              />
            </label>

            {formId === undefined && (
              <label htmlFor={templateId} className="block text-sm font-medium text-ink-800">
                {t("forms:editor.template")}
                <select
                  id={templateId}
                  onChange={(event) => {
                    // A template is a starting point, not a type: it replaces what is here and is
                    // then forgotten, so nothing downstream can constrain what the form becomes.
                    setState({ status: "ready", definition: template(event.target.value as FormTemplateId), revision: null });
                    setSave("dirty");
                  }}
                  className="mt-1 w-full max-w-md rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
                >
                  {FORM_TEMPLATE_IDS.map((id) => (
                    <option key={id} value={id}>
                      {t(`forms:templates.${id}.name` as "forms:templates.blank.name")}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>

          <FieldList fields={definition.fields} onChange={setFields} />

          <AfterSubmit definition={definition} pages={pages} onChange={patch} />

          <Delivery definition={definition} onChange={patch} />

          {issues.some((issue) => issue.code === "no-fields") && (
            <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {t("forms:editor.noFields")}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={save === "saving"}
              className="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t("forms:actions.save")}
            </button>
            <p aria-live="polite" className="text-xs text-ink-500">
              {save === "saving"
                ? t("forms:editor.saving")
                : save === "saved"
                  ? t("forms:editor.saved")
                  : save === "dirty"
                    ? t("forms:editor.unsaved")
                    : ""}
            </p>
          </div>
        </form>
      )}
    </div>
  );
}

/** How the type-safe `t` reads where a key is chosen at runtime rather than written out. */
type Translate = (key: string, values?: Record<string, unknown>) => string;

/** A question by the name a person would recognise, falling back to its position. */
function describe(field: FormField, index: number, translate: Translate): string {
  return field.label.trim() === "" ? translate("editor.fieldPosition", { index: index + 1 }) : field.label;
}

/**
 * The questions, reordered and edited in place.
 *
 * The id is generated from the label once and then frozen: it is what every stored answer is keyed
 * by, so changing it when somebody fixes a typo in the question would orphan every reply already
 * received.
 */
function FieldList({ fields, onChange }: { fields: FormField[]; onChange: (fields: FormField[]) => void }) {
  const { t } = useTranslation("forms");

  const update = (index: number, field: FormField) =>
    onChange(fields.map((current, position) => (position === index ? field : current)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    onChange(next);
  };

  const add = () => {
    const taken = new Set(fields.map((field) => field.id));
    let index = fields.length + 1;
    while (taken.has(`field${index}`)) index += 1;
    onChange([...fields, { id: `field${index}`, type: "shortText", label: "", required: false }]);
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink-900">{t("editor.fields")}</h2>

      <ul className="space-y-3">
        {fields.map((field, index) => (
          <li key={field.id} className="rounded-lg border border-ink-200 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-ink-800">
                {t("editor.fieldLabel")}
                <input
                  value={field.label}
                  onChange={(event) => update(index, { ...field, label: event.target.value })}
                  className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
                />
              </label>

              <label className="block text-sm font-medium text-ink-800">
                {t("editor.fieldType")}
                <select
                  value={field.type}
                  onChange={(event) => update(index, { ...field, type: event.target.value as FormFieldType })}
                  className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
                >
                  {FORM_FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`fieldTypes.${type}` as "fieldTypes.shortText")}
                    </option>
                  ))}
                </select>
              </label>

              {(field.type === "select" || field.type === "radio") && (
                <label className="block text-sm font-medium text-ink-800 sm:col-span-2">
                  {t("editor.fieldOptions")}
                  <textarea
                    rows={3}
                    value={(field.options ?? []).join("\n")}
                    onChange={(event) =>
                      update(index, {
                        ...field,
                        options: event.target.value.split("\n").map((line) => line.trim()).filter((line) => line !== ""),
                      })
                    }
                    className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
                  />
                </label>
              )}

              <label className="block text-sm font-medium text-ink-800 sm:col-span-2">
                {t("editor.fieldHelp")}
                <input
                  value={field.helpText ?? ""}
                  onChange={(event) => {
                    const helpText = event.target.value;
                    const { helpText: _dropped, ...rest } = field;
                    update(index, helpText === "" ? rest : { ...rest, helpText });
                  }}
                  className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-ink-800">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(event) => update(index, { ...field, required: event.target.checked })}
                />
                {t("editor.fieldRequired")}
              </label>

              {/* Named after the question they act on, so a screen reader hears "Move Email up"
                  rather than six identical buttons called "Move". */}
              <button
                type="button"
                onClick={() => move(index, -1)}
                className="text-xs text-ink-600 underline"
              >
                {t("editor.moveUp", { field: describe(field, index, t as Translate) })}
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                className="text-xs text-ink-600 underline"
              >
                {t("editor.moveDown", { field: describe(field, index, t as Translate) })}
              </button>
              <button
                type="button"
                onClick={() => onChange(fields.filter((_, position) => position !== index))}
                className="text-xs text-red-700 underline"
              >
                {t("editor.removeField", { field: describe(field, index, t as Translate) })}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={add}
        className="rounded-md border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
      >
        {t("editor.addField")}
      </button>
    </section>
  );
}

function AfterSubmit({
  definition,
  pages,
  onChange,
}: {
  definition: FormDefinitionInput;
  pages: readonly BuilderPage[];
  onChange: (values: Partial<FormDefinitionInput>) => void;
}) {
  const { t } = useTranslation("forms");
  const group = useId();

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink-900">{t("editor.afterSubmit")}</h2>

      <fieldset className="space-y-2">
        <legend className="sr-only">{t("editor.afterSubmit")}</legend>

        <label className="flex items-center gap-2 text-sm text-ink-800">
          <input
            type="radio"
            name={group}
            checked={definition.successBehavior.type === "message"}
            onChange={() => onChange({ successBehavior: { type: "message", message: t("templates.blank.success") } })}
          />
          {t("editor.successMessage")}
        </label>

        {definition.successBehavior.type === "message" && (
          <textarea
            aria-label={t("editor.successMessage")}
            rows={2}
            value={definition.successBehavior.message}
            onChange={(event) => onChange({ successBehavior: { type: "message", message: event.target.value } })}
            className="w-full max-w-md rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
          />
        )}

        <label className="flex items-center gap-2 text-sm text-ink-800">
          <input
            type="radio"
            name={group}
            checked={definition.successBehavior.type === "internalRedirect"}
            onChange={() =>
              onChange({ successBehavior: { type: "internalRedirect", pageId: pages[0]?.id ?? "" } })
            }
          />
          {t("editor.successRedirect")}
        </label>

        {definition.successBehavior.type === "internalRedirect" && (
          <label className="block text-sm font-medium text-ink-800">
            {t("editor.successPage")}
            {/* Only this site's own pages. A redirect somewhere else is a link, and a link a visitor
                did not click is where a form becomes an open redirect. */}
            <select
              value={definition.successBehavior.pageId}
              onChange={(event) =>
                onChange({ successBehavior: { type: "internalRedirect", pageId: event.target.value } })
              }
              className="mt-1 w-full max-w-md rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
            >
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <label className="block text-sm font-medium text-ink-800">
        {t("editor.submitLabel")}
        <input
          value={definition.submitLabel}
          onChange={(event) => onChange({ submitLabel: event.target.value })}
          className="mt-1 w-full max-w-md rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
        />
      </label>

      <label className="block text-sm font-medium text-ink-800">
        {t("editor.errorMessage")}
        <input
          value={definition.errorMessage ?? ""}
          onChange={(event) => {
            const errorMessage = event.target.value;
            onChange(errorMessage === "" ? { errorMessage: undefined } : { errorMessage });
          }}
          className="mt-1 w-full max-w-md rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
        />
      </label>
    </section>
  );
}

function Delivery({
  definition,
  onChange,
}: {
  definition: FormDefinitionInput;
  onChange: (values: Partial<FormDefinitionInput>) => void;
}) {
  const { t } = useTranslation("forms");

  return (
    <section className="space-y-3">
      <label className="block text-sm font-medium text-ink-800">
        {t("editor.notifications")}
        <textarea
          rows={2}
          value={definition.notificationRecipients.join("\n")}
          onChange={(event) =>
            onChange({
              notificationRecipients: event.target.value
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line !== ""),
            })
          }
          className="mt-1 w-full max-w-md rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
        />
      </label>
      <p className="max-w-md text-xs text-ink-500">{t("editor.notificationsHint")}</p>

      <label className="block text-sm font-medium text-ink-800">
        {t("editor.retention")}
        <input
          type="number"
          min={1}
          max={3650}
          value={definition.retentionDays ?? ""}
          placeholder={t("editor.retentionNever")}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange({ retentionDays: Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined });
          }}
          className="mt-1 w-32 rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
        />
        <span className="ml-2 text-xs text-ink-500">{t("editor.retentionDays")}</span>
      </label>
    </section>
  );
}
