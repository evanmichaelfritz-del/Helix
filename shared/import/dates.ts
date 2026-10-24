const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

function realCalendarDate(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return undefined;
  }
  const monthText = String(month).padStart(2, "0");
  const dayText = String(day).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${monthText}-${dayText}`;
}

/** ISO datetime with a Z or numeric offset, stored as UTC Z. Undefined when it is not one. */
export function normalizeLoggedAt(value: string): string | undefined {
  const match = ISO_DATE_TIME.exec(value);
  if (!match) return undefined;
  if (!realCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/**
 * Date-only, or an ISO datetime reduced to its UTC calendar day.
 * Undefined for impossible dates such as 2023-02-29 and 2024-13-45.
 */
export function normalizeOpenedOn(value: string): string | undefined {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return realCalendarDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
  }
  const logged = normalizeLoggedAt(value);
  if (!logged) return undefined;
  return logged.slice(0, 10);
}
