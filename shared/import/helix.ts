import { HELIX_EXPORT_KIND, type PeptideUnit } from "../types.ts";
import { emptyRecords } from "./empty.ts";
import type { ParseResult } from "./result.ts";

export function parseHelixHelper(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: "error", error: "That file is not valid JSON." };
  }
  if (!raw || typeof raw !== "object") {
    return { kind: "error", error: "Helix helper JSON must be an object." };
  }
  const obj = raw as Record<string, unknown>;
  if ("accessToken" in obj || "token" in obj || "serverFn" in obj) {
    return {
      kind: "error",
      error: "Token paste is not supported. Export helper JSON from grok.me, then drop that file here.",
    };
  }
  if (obj.kind !== HELIX_EXPORT_KIND && obj.kind !== "helix-export") {
    return { kind: "error", error: "Not a Helix helper JSON file." };
  }

  const records = emptyRecords("helix");
  records.peptides = asArray(obj.peptides).map(readPeptide).filter((x) => x !== undefined);
  records.vials = asArray(obj.vials).map(readVial).filter((x) => x !== undefined);
  records.doses = asArray(obj.doses).map(readDose).filter((x) => x !== undefined);
  records.weighIns = asArray(obj.weighIns).map(readWeighIn).filter((x) => x !== undefined);
  records.healthDays = asArray(obj.healthDays).map(readHealthDay).filter((x) => x !== undefined);
  records.workouts = asArray(obj.workouts).map(readWorkout).filter((x) => x !== undefined);
  return { kind: "ok", records };
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
}

function str(row: Record<string, unknown>, key: string): string | undefined {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(row: Record<string, unknown>, key: string): number | undefined {
  const v = row[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function isUnit(unit: string): unit is PeptideUnit {
  return unit === "mcg" || unit === "mg" || unit === "IU" || unit === "mL";
}

function readPeptide(row: Record<string, unknown>) {
  const name = str(row, "name");
  const unit = str(row, "unit");
  if (!name || !unit || !isUnit(unit)) return undefined;
  return {
    name,
    unit,
    color: str(row, "color"),
    lastAmount: num(row, "lastAmount") ?? null,
  };
}

function readVial(row: Record<string, unknown>) {
  const peptideName = str(row, "peptideName") ?? str(row, "peptide");
  const totalAmount = num(row, "totalAmount");
  const remainingAmount = num(row, "remainingAmount") ?? totalAmount;
  const dose = num(row, "dose");
  if (!peptideName || totalAmount == null || remainingAmount == null || dose == null) return undefined;
  return {
    peptideName,
    label: str(row, "label") ?? null,
    totalAmount,
    remainingAmount,
    dose,
    openedOn: str(row, "openedOn") ?? null,
  };
}

function readDose(row: Record<string, unknown>) {
  const peptideName = str(row, "peptideName") ?? str(row, "peptide");
  const amount = num(row, "amount");
  const unit = str(row, "unit");
  const loggedOn = str(row, "loggedOn");
  if (!peptideName || amount == null || !unit || !loggedOn || !isUnit(unit)) return undefined;
  return { peptideName, amount, unit, loggedOn, loggedAt: str(row, "loggedAt") };
}

function readWeighIn(row: Record<string, unknown>) {
  const loggedOn = str(row, "loggedOn");
  const kg = num(row, "kg");
  if (!loggedOn || kg == null) return undefined;
  return { loggedOn, kg };
}

function readHealthDay(row: Record<string, unknown>) {
  const loggedOn = str(row, "loggedOn");
  if (!loggedOn) return undefined;
  return {
    loggedOn,
    whoopRecovery: num(row, "whoopRecovery") ?? null,
    garminBodyBattery: num(row, "garminBodyBattery") ?? null,
    sleepHours: num(row, "sleepHours") ?? null,
    strain: num(row, "strain") ?? null,
    steps: num(row, "steps") ?? null,
  };
}

function readWorkout(row: Record<string, unknown>) {
  const loggedOn = str(row, "loggedOn");
  const name = str(row, "name");
  if (!loggedOn || !name) return undefined;
  return {
    loggedOn,
    name,
    durationMin: num(row, "durationMin") ?? null,
    strain: num(row, "strain") ?? null,
  };
}
