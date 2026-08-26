import type {
  RecoveryTone,
  RunwayTone,
  TodayHero,
  TodaySupporting,
  Vial,
} from "./types.js";

export function remainingInjections(vial: Pick<Vial, "remainingAmount" | "dose">): number {
  if (vial.dose <= 0) return 0;
  return Math.max(0, Math.floor(vial.remainingAmount / vial.dose + 1e-9));
}

export function runwayTone(remaining: number): RunwayTone {
  if (remaining <= 1) return "red";
  if (remaining <= 3) return "amber";
  return "ok";
}

export function recoveryTone(pct: number): RecoveryTone {
  if (pct >= 67) return "green";
  if (pct >= 34) return "amber";
  return "red";
}

export function stepperDelta(unit: string): number {
  if (unit === "mcg") return 25;
  if (unit === "mg") return 0.05;
  if (unit === "IU") return 0.5;
  if (unit === "mL") return 0.05;
  return 1;
}

export const EMPTY_HERO_TITLE = "No reading yet";

export type HealthDaySlice = {
  loggedOn?: string;
  whoopRecovery: number | null;
  garminBodyBattery: number | null;
  sleepHours: number | null;
  strain?: number | null;
  steps?: number | null;
  sleepPerf?: number | null;
};

export function todayHero(day: HealthDaySlice | null): TodayHero {
  if (!day) return { kind: "empty" };
  if (day.whoopRecovery != null) {
    return {
      kind: "whoop",
      recovery: day.whoopRecovery,
      tone: recoveryTone(day.whoopRecovery),
    };
  }
  if (day.garminBodyBattery != null) {
    return { kind: "garmin", bodyBattery: day.garminBodyBattery };
  }
  if (day.sleepHours != null) {
    return { kind: "sleep", hours: day.sleepHours };
  }
  return { kind: "empty" };
}

export const pickTodayHero = todayHero;

export function pickHealthDay<T extends { loggedOn: string }>(days: T[], on: string): T | null {
  for (const day of days) {
    if (day.loggedOn === on) return day;
  }
  return null;
}

export function supportingLines(
  day: HealthDaySlice | null,
  weighIns: Array<{ kg: number; loggedOn: string }>,
  hero: TodayHero,
): TodaySupporting {
  void day?.sleepPerf;
  const sleepHours = hero.kind === "sleep" ? null : (day?.sleepHours ?? null);
  const strain = day?.strain ?? null;
  const steps = strain == null ? (day?.steps ?? null) : null;
  const cutoff = day?.loggedOn;
  const relevant = weighIns
    .filter((row) => (cutoff ? row.loggedOn <= cutoff : true))
    .sort((a, b) => a.loggedOn.localeCompare(b.loggedOn));
  const current = relevant[relevant.length - 1];
  const prev = relevant[relevant.length - 2];
  return {
    sleepHours,
    strain,
    steps,
    weightKg: current?.kg ?? null,
    weightDeltaKg: current && prev ? current.kg - prev.kg : null,
  };
}

export function todaysWorkouts<T extends { loggedOn: string }>(workouts: T[], on: string): T[] {
  return workouts.filter((row) => row.loggedOn === on);
}
