import { emptyRecords } from "./empty.js";
import type { ParseResult } from "./result.js";

/** Keep in lockstep with recordsSchema healthDays.max / workouts.max (Hobby 10s). */
export const WHOOP_IMPORT_CAP = 400;

type DayAcc = {
  loggedOn: string;
  whoopRecovery?: number | null;
  garminBodyBattery?: number | null;
  sleepHours?: number | null;
  strain?: number | null;
  steps?: number | null;
};

type ImportWorkout = {
  loggedOn: string;
  name: string;
  durationMin?: number | null;
  strain?: number | null;
};

export function parseWhoop(text: string): ParseResult {
  return parseWhoopCsvFiles([{ name: "whoop.csv", body: text }]);
}

export function parseWhoopCsvFiles(files: { name: string; body: string }[]): ParseResult {
  const days = new Map<string, DayAcc>();
  const workouts: ImportWorkout[] = [];
  for (const file of files) {
    if (isJournalCsv(file.name)) continue;
    ingestWhoopCsv(file.body, days, workouts);
  }
  return finishWhoop(days, workouts);
}

export function isWhoopZipCsv(path: string): boolean {
  const normalized = path.toLowerCase().replace(/\\/g, "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (base.includes("journal")) return false;
  if (!base.endsWith(".csv")) return false;
  return (
    /physiological|recovery|whoop/.test(normalized) ||
    /^(sleeps?|workouts?)\.csv$/.test(base)
  );
}

/** Physiological cycles first, then sleeps (overlay), then workouts. */
export function whoopZipCsvRank(path: string): number {
  const normalized = path.toLowerCase().replace(/\\/g, "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (/^workouts?\.csv$/.test(base)) return 2;
  if (/^sleeps?\.csv$/.test(base)) return 1;
  return 0;
}

function isJournalCsv(path: string): boolean {
  const base = path.toLowerCase().replace(/\\/g, "/");
  return base.slice(base.lastIndexOf("/") + 1).includes("journal");
}

function ingestWhoopCsv(text: string, days: Map<string, DayAcc>, workouts: ImportWorkout[]): void {
  const rows = parseCsv(text);
  for (const row of rows) {
    const date = pickDate(row);
    if (!date) continue;
    const recovery = pickNum(row, [
      "recovery score %",
      "recovery score",
      "recovery_score",
      "recovery",
      "whoop_recovery",
    ]);
    const strain = pickNum(row, ["day strain", "day_strain", "strain"]);
    const sleepHours = pickSleepHours(row);
    const steps = pickNum(row, ["steps"]);
    if (recovery != null || strain != null || sleepHours != null || steps != null) {
      const day = days.get(date) ?? { loggedOn: date };
      if (recovery != null) day.whoopRecovery = clamp(recovery, 0, 100);
      if (strain != null) day.strain = strain;
      if (sleepHours != null) day.sleepHours = sleepHours;
      if (steps != null) day.steps = Math.round(steps);
      days.set(date, day);
    }

    const workoutName = pickStr(row, ["activity name", "workout", "activity", "sport"]);
    if (workoutName) {
      workouts.push({
        loggedOn: date,
        name: workoutName,
        durationMin: pickNum(row, ["duration (min)", "duration_min", "duration"]),
        strain: pickNum(row, ["activity strain", "activity_strain", "workout_strain"]),
      });
    }
  }
}

function finishWhoop(days: Map<string, DayAcc>, workouts: ImportWorkout[]): ParseResult {
  if (days.size === 0) {
    return {
      kind: "error",
      error: "No Whoop recovery, sleep, or strain columns found.",
    };
  }

  const uniqueDates = [...days.keys()].sort();
  const keptDates =
    uniqueDates.length > WHOOP_IMPORT_CAP ? uniqueDates.slice(-WHOOP_IMPORT_CAP) : uniqueDates;
  const kept = new Set(keptDates);

  const records = emptyRecords("whoop");
  records.healthDays = keptDates.map((loggedOn) => days.get(loggedOn)!);
  const eligible = workouts
    .map((workout, index) => ({ workout, index }))
    .filter(({ workout }) => kept.has(workout.loggedOn));
  const newestIndexes = new Set(
    [...eligible]
      .sort((a, b) => b.workout.loggedOn.localeCompare(a.workout.loggedOn) || b.index - a.index)
      .slice(0, WHOOP_IMPORT_CAP)
      .map(({ index }) => index),
  );
  records.workouts = eligible
    .filter(({ index }) => newestIndexes.has(index))
    .map(({ workout }) => workout);
  return { kind: "ok", records };
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cols[idx] ?? "").trim();
    });
    out.push(row);
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        q = !q;
      }
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function pickDate(row: Record<string, string>): string | undefined {
  const raw =
    pickStr(row, [
      "cycle start time",
      "workout start time",
      "start time",
      "date",
      "day",
      "cycle_start",
      "sleep_start",
      "logged_on",
      "calendar_date",
    ]) ?? Object.values(row)[0];
  if (!raw) return undefined;
  const iso = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!m) return undefined;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function pickStr(row: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = row[key];
    if (v) return v;
  }
  return undefined;
}

function pickNum(row: Record<string, string>, keys: string[]): number | undefined {
  const v = pickStr(row, keys);
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function pickSleepHours(row: Record<string, string>): number | undefined {
  const hours = pickNum(row, ["sleep_hours", "hours_asleep", "total_sleep_hours"]);
  if (hours != null) return hours;
  const milli = pickNum(row, ["total_sleep_time_milli", "sleep_milli"]);
  if (milli != null) return milli / 3_600_000;
  const minutes = pickNum(row, ["asleep duration (min)", "sleep_minutes", "total_sleep_minutes"]);
  if (minutes != null) return minutes / 60;
  return undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
