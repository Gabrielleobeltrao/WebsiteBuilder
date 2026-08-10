import type { Logger } from "pino";

import type { FormDefinition, FormSubmission } from "./repository";

/**
 * Provider-neutral notification boundary.
 *
 * No transactional email provider is connected in this scope, so this is an interface plus a
 * development sink. What matters is the guarantee around it: a submission is stored first and
 * notified second, and a notification failure can never lose or reject the submission. Losing a
 * customer's lead because an email queue was down is a far worse outcome than a missed email.
 */
export type NotificationPayload = {
  formName: string;
  recipients: readonly string[];
  submissionId: string;
  submittedAt: string;
  /** Field labels paired with their submitted values, resolved through the definition. */
  fields: Array<{ label: string; value: string }>;
};

export type NotificationResult = { delivered: boolean; reason?: string };

export type NotificationAdapter = {
  readonly name: string;
  send: (payload: NotificationPayload) => Promise<NotificationResult>;
};

/**
 * Development sink. It records what would have been sent and never contacts anything, so tests and
 * local work exercise the same path production will use.
 */
export function createDevelopmentSink(logger: Logger): NotificationAdapter & { sent: NotificationPayload[] } {
  const sent: NotificationPayload[] = [];
  return {
    name: "development-sink",
    sent,
    async send(payload) {
      sent.push(payload);
      // Recipients are logged, values are not: a submission body has no place in application logs.
      logger.info({ form: payload.formName, recipients: payload.recipients.length }, "form notification captured");
      return { delivered: true };
    },
  };
}

/** Pairs stored values with their current labels, so a notification is readable by a human. */
export function buildNotificationPayload(
  definition: Pick<FormDefinition, "name" | "fields" | "notificationRecipients">,
  submission: Pick<FormSubmission, "id" | "values" | "createdAt">,
): NotificationPayload {
  return {
    formName: definition.name,
    recipients: definition.notificationRecipients,
    submissionId: submission.id,
    submittedAt: submission.createdAt,
    fields: definition.fields
      .filter((field) => field.type !== "hidden")
      .map((field) => ({
        label: field.label,
        value: formatValue(submission.values[field.id]),
      })),
  };
}

function formatValue(value: unknown): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  if (Array.isArray(value)) return value.join(", ");
  return value === undefined || value === null ? "" : String(value);
}

/**
 * Notifies without ever failing the submission.
 *
 * The caller has already stored the record. This reports what happened so it can be logged or
 * retried, and swallows every provider error rather than propagating it into a request that has
 * already succeeded.
 */
export async function notifySafely(
  adapter: NotificationAdapter,
  payload: NotificationPayload,
  logger: Logger,
): Promise<NotificationResult> {
  if (payload.recipients.length === 0) return { delivered: false, reason: "no-recipients" };

  try {
    return await adapter.send(payload);
  } catch (error) {
    logger.error({ err: error, adapter: adapter.name }, "form notification failed");
    return { delivered: false, reason: "provider-error" };
  }
}
