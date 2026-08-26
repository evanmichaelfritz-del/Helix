import type { RecoveryTone, RunwayTone, TodayHero, Vial } from "./types.ts";

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

export function todayHero(day: {
  whoopRecovery: number | null;
  garminBodyBattery: number | null;
  sleepHours: number | null;
} | null): TodayHero {
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
