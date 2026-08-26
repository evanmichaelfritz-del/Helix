import { emptyRecords } from "./empty.js";
import type { ParseResult } from "./result.js";

type DayAcc = {
  loggedOn: string;
  garminBodyBattery?: number | null;
  sleepHours?: number | null;
  steps?: number | null;
  strain?: number | null;
};

export function parseGarmin(files: { name: string; body: string }[]): ParseResult {
  const days = new Map<string, DayAcc>();
  const workouts: { loggedOn: string; name: string; durationMin?: number | null }[] = [];
  let sawJson = false;

  for (const file of files) {
    if (file.name.toLowerCase().includes("activit") && file.name.toLowerCase().endsWith(".csv")) {
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(file.body);
    } catch {
      continue;
    }
    sawJson = true;
    walk(data, file.name, days, workouts);
  }

  if (!sawJson) {
    return {
      kind: "error",
      error:
        "Garmin body battery needs the JSON dailies zip, not Connect Activities CSV.",
    };
  }
  if (days.size === 0) {
    return {
      kind: "error",
      error:
        "No Garmin dailies with body battery, sleep, or steps found. Export JSON dailies, not Activities CSV.",
    };
  }
  const records = emptyRecords("garmin");
  records.healthDays = [...days.values()];
  records.workouts = workouts;
  return { kind: "ok", records };
}

function walk(
  data: unknown,
  fileName: string,
  days: Map<string, DayAcc>,
  workouts: { loggedOn: string; name: string; durationMin?: number | null }[],
): void {
  if (Array.isArray(data)) {
    for (const item of data) walk(item, fileName, days, workouts);
    return;
  }
  if (!data || typeof data !== "object") return;
  const row = data as Record<string, unknown>;
  const date = findDate(row);
  if (date) {
    const battery = findBodyBattery(row);
    const steps = findNumber(row, ["steps", "totalSteps", "stepCount"]);
    const sleep = findSleepHours(row);
    if (battery != null || steps != null || sleep != null) {
      const day = days.get(date) ?? { loggedOn: date };
      if (battery != null) day.garminBodyBattery = clamp(Math.round(battery), 0, 100);
      if (steps != null) day.steps = Math.round(steps);
      if (sleep != null) day.sleepHours = sleep;
      days.set(date, day);
    }
    const workoutName = asString(row.activityName ?? row.activityType ?? row.name);
    if (workoutName && (row.duration || row.durationInSeconds || row.movingDuration)) {
      const seconds =
        findNumber(row, ["durationInSeconds", "movingDuration", "duration"]) ?? undefined;
      workouts.push({
        loggedOn: date,
        name: workoutName,
        durationMin: seconds != null ? Math.round(seconds / 60) : null,
      });
    }
  }
  for (const value of Object.values(row)) {
    if (value && typeof value === "object") walk(value, fileName, days, workouts);
  }
}

function findDate(row: Record<string, unknown>): string | undefined {
  const keys = [
    "calendarDate",
    "calendar_date",
    "date",
    "day",
    "startTime",
    "startTimeGmt",
    "timestamp",
  ];
  for (const key of keys) {
    const v = row[key];
    const s = asString(v);
    if (!s) continue;
    const iso = s.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  }
  return undefined;
}

function findBodyBattery(row: Record<string, unknown>): number | undefined {
  const direct = findNumber(row, [
    "bodyBatteryMostRecentValue",
    "bodyBatteryHighestValue",
    "bodyBatteryAvg",
    "bodyBattery",
    "mostRecentValue",
  ]);
  if (direct != null) return direct;
  const nested = row.bodyBattery;
  if (nested && typeof nested === "object") {
    const obj = nested as Record<string, unknown>;
    return findNumber(obj, ["mostRecentValue", "highestValue", "avg", "charged", "value"]);
  }
  const arr = row.bodyBatteryValuesArray;
  if (Array.isArray(arr) && arr.length > 0) {
    const last = arr[arr.length - 1];
    if (Array.isArray(last) && typeof last[1] === "number") return last[1];
    if (last && typeof last === "object") {
      const v = findNumber(last as Record<string, unknown>, ["value", "bodyBattery"]);
      if (v != null) return v;
    }
  }
  return undefined;
}

function findSleepHours(row: Record<string, unknown>): number | undefined {
  const hours = findNumber(row, ["sleepHours", "sleepTimeHours"]);
  if (hours != null) return hours;
  const seconds = findNumber(row, ["sleepSeconds", "sleepTimeSeconds", "durationInSeconds"]);
  if (seconds != null && seconds > 60 * 30) return seconds / 3600;
  const milli = findNumber(row, ["sleepTimeMilliseconds"]);
  if (milli != null) return milli / 3_600_000;
  return undefined;
}

function findNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
