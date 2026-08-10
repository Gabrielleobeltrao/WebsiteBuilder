import { useCallback } from "react";
import { useTranslation } from "react-i18next";

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/**
 * Formats a timestamp with `Intl.RelativeTimeFormat` in the active locale, so "2 days ago" and
 * "há 2 dias" come from the platform rather than from a hand-written translation table.
 */
export function useRelativeTime(): (isoTimestamp: string, now?: Date) => string {
  const { i18n } = useTranslation();

  return useCallback(
    (isoTimestamp: string, now = new Date()) => {
      const timestamp = Date.parse(isoTimestamp);
      if (Number.isNaN(timestamp)) return "";

      const formatter = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });
      const elapsed = timestamp - now.getTime();

      for (const [unit, milliseconds] of UNITS) {
        if (Math.abs(elapsed) >= milliseconds) {
          return formatter.format(Math.round(elapsed / milliseconds), unit);
        }
      }
      return formatter.format(0, "minute");
    },
    [i18n.language],
  );
}
