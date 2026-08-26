import { emptyRecords } from "./empty.ts";
import type { ParseResult } from "./result.ts";

type DayAcc = {
  loggedOn: string;
  whoopRecovery?: number | null;
  garminBodyBattery?: number | null;
  sleepHours?: number | null;
  strain?: number | null;
  steps?: number | null;
};

export function parseWhoop(text: string): ParseResult {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { kind: "error", error: "That CSV is empty." };
  }
  const days = new Map<string, DayAcc>();
  const workouts: ImportWorkouts = [];

  for (const row of rows) {
    const date = pickDate(row);
    if (!date) continue;
    const day = days.get(date) ?? { loggedOn: date };
    const recovery = pickNum(row, [
      "recovery_score",
      "recovery score",
      "recovery",
      "whoop_recovery",
    ]);
    const strain = pickNum(row, ["day_strain", "strain", "day strain"]);
    const sleepHours = pickSleepHours(row);
    const steps = pickNum(row, ["steps"]);
    if (recovery != null) day.whoopRecovery = clamp(recovery, 0, 100);
    if (strain != null) day.strain = strain;
    if (sleepHours != null) day.sleepHours = sleepHours;
    if (steps != null) day.steps = Math.round(steps);
    days.set(date, day);

    const workoutName = pickStr(row, ["workout", "activity", "sport"]);
    if (workoutName) {
      workouts.push({
        loggedOn: date,
        name: workoutName,
        durationMin: pickNum(row, ["duration_min", "duration (min)", "duration"]),
        strain: pickNum(row, ["activity_strain", "workout_strain"]),
      });
    }
  }

  if (days.size === 0) {
    return {
      kind: "error",
      error: "No Whoop recovery, sleep, or strain columns found.",
    };
  }

  const records = emptyRecords("whoop");
  records.healthDays = [...days.values()];
  records.workouts = workouts;
  return { kind: "ok", records };
}

type ImportWorkouts = {
  loggedOn: string;
  name: string;
  durationMin?: number | null;
  strain?: number | null;
}[];

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
    pickStr(row, ["date", "day", "cycle_start", "sleep_start", "logged_on", "calendar_date"]) ??
    Object.values(row)[0];
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
  const minutes = pickNum(row, ["sleep_minutes", "total_sleep_minutes"]);
  if (minutes != null) return minutes / 60;
  return undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
