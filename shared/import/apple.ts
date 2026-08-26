import { XMLParser } from "fast-xml-parser";
import { emptyRecords } from "./empty.ts";
import type { ParseResult } from "./result.ts";

type DayAcc = {
  loggedOn: string;
  sleepHours?: number | null;
  steps?: number | null;
};

export function parseAppleHealth(xml: string): ParseResult {
  if (!xml.includes("HealthData") && !xml.includes("HKQuantityTypeIdentifier")) {
    return { kind: "error", error: "That file does not look like an Apple Health export." };
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    allowBooleanAttributes: true,
  });
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return { kind: "error", error: "Could not parse Apple Health XML." };
  }
  const recordsXml = asRecord(parsed);
  const healthData = asRecord(recordsXml?.HealthData) ?? recordsXml;
  const rawRecords = healthData?.Record;
  const list = Array.isArray(rawRecords) ? rawRecords : rawRecords ? [rawRecords] : [];

  const days = new Map<string, DayAcc>();
  const weighIns: { loggedOn: string; kg: number }[] = [];
  const workouts: { loggedOn: string; name: string; durationMin?: number | null }[] = [];
  const sleepMs = new Map<string, number>();
  const steps = new Map<string, number>();

  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    const type = String(rec.type ?? "");
    const start = String(rec.startDate ?? rec.creationDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;
    const value = Number(rec.value);

    if (type.includes("BodyMass") && Number.isFinite(value)) {
      const unit = String(rec.unit ?? "kg").toLowerCase();
      const kg = unit.includes("lb") ? value * 0.45359237 : value;
      weighIns.push({ loggedOn: start, kg });
    }
    if (type.includes("StepCount") && Number.isFinite(value)) {
      steps.set(start, (steps.get(start) ?? 0) + value);
    }
    if (type.includes("SleepAnalysis")) {
      const startAt = Date.parse(String(rec.startDate ?? ""));
      const endAt = Date.parse(String(rec.endDate ?? ""));
      if (Number.isFinite(startAt) && Number.isFinite(endAt) && endAt > startAt) {
        sleepMs.set(start, (sleepMs.get(start) ?? 0) + (endAt - startAt));
      }
    }
  }

  const rawWorkouts = healthData?.Workout;
  const workoutList = Array.isArray(rawWorkouts) ? rawWorkouts : rawWorkouts ? [rawWorkouts] : [];
  for (const item of workoutList) {
    const rec = asRecord(item);
    if (!rec) continue;
    const start = String(rec.startDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;
    const name = String(rec.workoutActivityType ?? rec.name ?? "Workout").replace(
      "HKWorkoutActivityType",
      "",
    );
    const duration = Number(rec.duration);
    workouts.push({
      loggedOn: start,
      name: name || "Workout",
      durationMin: Number.isFinite(duration) ? duration : null,
    });
  }

  for (const [date, total] of steps) {
    const day = days.get(date) ?? { loggedOn: date };
    day.steps = Math.round(total);
    days.set(date, day);
  }
  for (const [date, ms] of sleepMs) {
    const day = days.get(date) ?? { loggedOn: date };
    day.sleepHours = ms / 3_600_000;
    days.set(date, day);
  }

  if (days.size === 0 && weighIns.length === 0 && workouts.length === 0) {
    return { kind: "error", error: "No weight, sleep, steps, or workouts in that Apple Health export." };
  }

  const records = emptyRecords("apple");
  records.healthDays = [...days.values()];
  records.weighIns = latestWeighIns(weighIns);
  records.workouts = workouts;
  return { kind: "ok", records };
}

function latestWeighIns(rows: { loggedOn: string; kg: number }[]) {
  const byDay = new Map<string, { loggedOn: string; kg: number }>();
  for (const row of rows) byDay.set(row.loggedOn, row);
  return [...byDay.values()];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return undefined;
}
