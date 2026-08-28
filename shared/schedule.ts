export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type PeptideSchedule = {
  days: Weekday[];
  morning: boolean;
  evening: boolean;
};

export const DEFAULT_PEPTIDE_SCHEDULE: PeptideSchedule = {
  days: [0, 1, 2, 3, 4, 5, 6],
  morning: true,
  evening: false,
};

const WEEKDAY_SET = new Set<number>([0, 1, 2, 3, 4, 5, 6]);

export function parsePeptideSchedule(raw: unknown): PeptideSchedule {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PEPTIDE_SCHEDULE };
  const obj = raw as Record<string, unknown>;
  const days = Array.isArray(obj.days)
    ? obj.days
        .map((d) => (typeof d === "number" ? d : Number(d)))
        .filter((d): d is Weekday => Number.isInteger(d) && WEEKDAY_SET.has(d))
    : [...DEFAULT_PEPTIDE_SCHEDULE.days];
  const uniqueDays = [...new Set(days)].sort((a, b) => a - b) as Weekday[];
  const morning = obj.morning === undefined ? DEFAULT_PEPTIDE_SCHEDULE.morning : obj.morning === true;
  const evening = obj.evening === true;
  return {
    days: uniqueDays.length > 0 ? uniqueDays : [...DEFAULT_PEPTIDE_SCHEDULE.days],
    morning: morning || (!morning && !evening),
    evening,
  };
}

export function serializePeptideSchedule(schedule: PeptideSchedule): string {
  return JSON.stringify({
    days: [...schedule.days].sort((a, b) => a - b),
    morning: schedule.morning,
    evening: schedule.evening,
  });
}

export function weekdayFromLocalDate(on: string): Weekday {
  const [y, m, d] = on.split("-").map(Number);
  return new Date(y, m - 1, d).getDay() as Weekday;
}

export function isScheduledOnDay(schedule: PeptideSchedule, weekday: Weekday): boolean {
  return schedule.days.includes(weekday);
}

export function scheduleSummary(schedule: PeptideSchedule): string {
  const dayPart =
    schedule.days.length === 7
      ? "Daily"
      : schedule.days.map((d) => WEEKDAY_LABELS[d].slice(0, 1)).join(" ");
  const times: string[] = [];
  if (schedule.morning) times.push("AM");
  if (schedule.evening) times.push("PM");
  return `${dayPart} · ${times.join(" & ") || "Any time"}`;
}

export function scheduleTimesLabel(schedule: PeptideSchedule): string {
  const labels: string[] = [];
  if (schedule.morning) labels.push("Morning");
  if (schedule.evening) labels.push("Evening");
  return labels.join(" · ") || "Any time";
}
