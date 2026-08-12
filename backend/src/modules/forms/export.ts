import { renderCsv, type FormDefinitionInput } from "@websitebuilder/shared";

import type { FormSubmission } from "./repository";

/**
 * CSV export.
 *
 * Columns come from the definition's current fields, so a renamed label produces a readable header
 * while the values underneath still resolve by stable field id. Every cell is escaped by the shared
 * helper, which neutralises spreadsheet formulas — a submitted value is untrusted input right up to
 * the moment someone opens it in Excel.
 *
 * Nothing is dropped. An answer to a question the form no longer asks lands in a final column,
 * labelled with the question that was actually asked, taken from the snapshot the submission itself
 * carries: a column that silently disappears is a customer losing records to a rename.
 */
const RETIRED_COLUMN = "Retired questions";

export function submissionCsvHeader(definition: Pick<FormDefinitionInput, "fields">): string[] {
  return [
    "Submitted at",
    "Status",
    ...definition.fields.filter((field) => field.type !== "hidden").map((field) => field.label),
    RETIRED_COLUMN,
  ];
}

export function submissionCsvRow(
  definition: Pick<FormDefinitionInput, "fields">,
  submission: FormSubmission,
): string[] {
  const fields = definition.fields.filter((field) => field.type !== "hidden");
  const current = new Set(definition.fields.map((field) => field.id));
  const asked = new Map(submission.fields.map((field) => [field.id, field.label]));

  const retired = Object.entries(submission.values)
    .filter(([fieldId]) => !current.has(fieldId))
    .map(([fieldId, value]) => `${asked.get(fieldId) ?? fieldId}: ${formatCell(value)}`)
    .join("; ");

  return [
    submission.createdAt,
    submission.status,
    ...fields.map((field) => formatCell(submission.values[field.id])),
    retired,
  ];
}

export function buildSubmissionCsv(
  definition: Pick<FormDefinitionInput, "fields">,
  submissions: readonly FormSubmission[],
): string {
  return renderCsv([submissionCsvHeader(definition), ...submissions.map((row) => submissionCsvRow(definition, row))]);
}

/**
 * The same export, produced a row at a time.
 *
 * An export is the one read whose size the customer chooses. Building the whole file in memory to
 * write it straight out is how one large export takes down a process serving every other tenant.
 */
export async function* streamSubmissionCsv(
  definition: Pick<FormDefinitionInput, "fields">,
  submissions: AsyncIterable<FormSubmission>,
): AsyncGenerator<string> {
  yield `${renderCsv([submissionCsvHeader(definition)])}\r\n`;
  for await (const submission of submissions) {
    yield `${renderCsv([submissionCsvRow(definition, submission)])}\r\n`;
  }
}

function formatCell(value: unknown): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  if (Array.isArray(value)) return value.join("; ");
  return value === undefined || value === null ? "" : String(value);
}
