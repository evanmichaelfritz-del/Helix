import { HELIX_EXPORT_KIND, type PeptideUnit } from "../types.js";
import { emptyRecords } from "./empty.js";
import type { ParseResult } from "./result.js";
import { isWhoopZipCsv } from "./whoop.js";

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

/** You helper picker: bare helper JSON, or a zip that unwraps to one. Not Whoop/Garmin/Apple. */
export async function parseHelixHelperFile(file: {
  name: string;
  type: string;
  buffer: ArrayBuffer;
}): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) {
    return parseHelixHelper(new TextDecoder("utf-8").decode(file.buffer));
  }
  if (name.endsWith(".zip")) {
    return unwrapHelperZip(file.buffer);
  }
  return { kind: "error", error: "Drop a Helix helper JSON, or a zip that contains one." };
}

async function unwrapHelperZip(buffer: ArrayBuffer): Promise<ParseResult> {
  const { default: JSZip } = await import("jszip");
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return { kind: "error", error: "That zip could not be opened." };
  }

  const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir && !isIgnoredZipPath(path));
  const jsonPaths = paths.filter((path) => path.toLowerCase().endsWith(".json")).sort((a, b) => a.localeCompare(b));

  const helpers: string[] = [];
  for (const path of jsonPaths) {
    const body = await zip.files[path].async("string");
    if (hasHelperKind(body)) helpers.push(body);
  }
  if (helpers.length > 0) {
    return parseHelixHelper(helpers[0]);
  }

  if (paths.some((path) => isWhoopZipCsv(path))) {
    return {
      kind: "error",
      error: "That zip is a Whoop export. Drop it on Vitals, not You.",
    };
  }

  return {
    kind: "error",
    error: "That zip does not contain a Helix helper JSON (kind helix-helper-json).",
  };
}

function hasHelperKind(text: string): boolean {
  try {
    const raw = JSON.parse(text) as { kind?: unknown };
    return raw?.kind === HELIX_EXPORT_KIND || raw?.kind === "helix-export";
  } catch {
    return false;
  }
}

function isIgnoredZipPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("__MACOSX/") || normalized.includes("/__MACOSX/")) return true;
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  return base.startsWith(".") || base.startsWith("._");
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
