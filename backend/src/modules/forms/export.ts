import { renderCsv, type FormDefinitionInput } from "@websitebuilder/shared";

import type { FormSubmission } from "./repository";

/**
 * CSV export.
 *
 * Columns come from the definition's current fields, so a renamed label produces a readable header
 * while the values underneath still resolve by stable field id. Every cell is escaped by the shared
 * helper, which neutralises spreadsheet formulas — a submitted value is untrusted input right up to
 * the moment someone opens it in Excel.
 */
export function buildSubmissionCsv(
  definition: Pick<FormDefinitionInput, "fields">,
  submissions: readonly FormSubmission[],
): string {
  const fields = definition.fields.filter((field) => field.type !== "hidden");

  const header = ["Submitted at", "Status", ...fields.map((field) => field.label)];
  const rows = submissions.map((submission) => [
    submission.createdAt,
    submission.status,
    ...fields.map((field) => formatCell(submission.values[field.id])),
  ]);

  return renderCsv([header, ...rows]);
}

function formatCell(value: unknown): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  if (Array.isArray(value)) return value.join("; ");
  return value === undefined || value === null ? "" : String(value);
}
