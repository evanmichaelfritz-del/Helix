const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const FOUR_DIGIT_DAY = /^\d{4}-\d{2}-\d{2}$/;

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

/** +23:59 is a real offset. +24:00 and +99:99 are not, and Date rejects them. */
function offsetInRange(offset: string): boolean {
  if (offset === "Z") return true;
  const match = /^[+-](\d{2}):?(\d{2})$/.exec(offset);
  if (!match) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

function utcIso(value: string): string | undefined {
  let iso: string;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    iso = date.toISOString();
  } catch {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(iso)) return undefined;
  return iso;
}

/** ISO datetime with a Z or numeric offset, stored as UTC Z. Undefined when it is not one. */
export function normalizeLoggedAt(value: string): string | undefined {
  const match = ISO_DATE_TIME.exec(value);
  if (!match || !offsetInRange(match[7] ?? "")) return undefined;
  if (!realCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) return undefined;
  return utcIso(value);
}

/**
 * Date-only stays as written. An ISO datetime keeps that same calendar day, not the UTC day.
 * Undefined for impossible dates, bad offsets, and instants Date would print outside year 0000–9999.
 */
export function normalizeOpenedOn(value: string): string | undefined {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const written = realCalendarDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
    return written && FOUR_DIGIT_DAY.test(written) ? written : undefined;
  }
  const match = ISO_DATE_TIME.exec(value);
  if (!match || !offsetInRange(match[7] ?? "")) return undefined;
  const written = realCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
  if (!written || !FOUR_DIGIT_DAY.test(written) || !utcIso(value)) return undefined;
  return written;
}
