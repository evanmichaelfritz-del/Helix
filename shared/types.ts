export type LocalDate = string & { readonly __brand: "LocalDate" };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalDate(input: string): LocalDate | undefined {
  const match = DATE_RE.exec(input);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return undefined;
  }
  return input as LocalDate;
}

export function todayLocal(now = new Date()): LocalDate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}` as LocalDate;
}

export type PeptideUnit = "mcg" | "mg" | "IU" | "mL";

export const PEPTIDE_UNITS = ["mcg", "mg", "IU", "mL"] as const;

export const PEPTIDE_COLORS = [
  "#7EE0C8",
  "#C4B5FD",
  "#F5A524",
  "#7DD3FC",
  "#F9A8D4",
  "#A3E635",
  "#F0EDE4",
  "#FF5D6C",
] as const;

export type ThemePref = "system" | "light" | "dark";
export type WeightUnit = "kg" | "lb";

export type UserSettings = {
  theme: ThemePref;
  faceId: boolean;
  reduceEffects: boolean;
  weightUnit: WeightUnit;
};

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  faceId: false,
  reduceEffects: false,
  weightUnit: "lb",
};

export type UserPublic = {
  id: string;
  email: string | null;
  displayName: string | null;
  settings: UserSettings;
  createdAt: string;
};

export type { PeptideSchedule, Weekday } from "./schedule.js";
export { DEFAULT_PEPTIDE_SCHEDULE, WEEKDAY_LABELS } from "./schedule.js";

export type Peptide = {
  id: string;
  name: string;
  unit: PeptideUnit;
  color: string;
  lastAmount: number | null;
  schedule: import("./schedule.js").PeptideSchedule;
  bodyEffect: string | null;
  expectedResults: string | null;
  createdAt: string;
};

export type Vial = {
  id: string;
  peptideId: string;
  label: string | null;
  totalAmount: number;
  remainingAmount: number;
  dose: number;
  bacMl: number | null;
  syringeUnits: 30 | 50 | 100;
  openedOn: string | null;
  createdAt: string;
};

export type Dose = {
  id: string;
  peptideId: string;
  vialId: string | null;
  amount: number;
  unit: PeptideUnit;
  loggedOn: LocalDate;
  loggedAt: string;
  undone: boolean;
};

export type WeighIn = {
  id: string;
  kg: number;
  loggedOn: LocalDate;
  createdAt: string;
};

export type HealthDay = {
  id: string;
  loggedOn: LocalDate;
  whoopRecovery: number | null;
  garminBodyBattery: number | null;
  sleepHours: number | null;
  strain: number | null;
  steps: number | null;
  source: string | null;
  sleepPerf?: number | null;
};

export type Workout = {
  id: string;
  loggedOn: LocalDate;
  name: string;
  durationMin: number | null;
  strain: number | null;
  source: string | null;
  createdAt: string;
};

export type RunwayTone = "ok" | "amber" | "red";

export type RecoveryTone = "green" | "amber" | "red";

export type ProtocolStatus = "due" | "logged";

export type TodayProtocol =
  | { kind: "empty" }
  | {
      kind: "dose";
      peptide: Peptide;
      vial: Vial | null;
      remainingInjections: number | null;
      runwayTone: RunwayTone | null;
      status: ProtocolStatus;
      amount: number;
      unit: PeptideUnit;
    };

export type TodaySupporting = {
  sleepHours: number | null;
  strain: number | null;
  steps: number | null;
  weightKg: number | null;
  weightDeltaKg: number | null;
};

export type TodayHero =
  | { kind: "whoop"; recovery: number; tone: RecoveryTone }
  | { kind: "garmin"; bodyBattery: number }
  | { kind: "sleep"; hours: number }
  | { kind: "empty" };

export type TodayPayload = {
  on: LocalDate;
  day: HealthDay | null;
  weighIns: WeighIn[];
  hero: TodayHero;
  supporting: TodaySupporting;
  protocol: TodayProtocol;
  workouts: Workout[];
};

export type ImportSource = "whoop" | "garmin" | "apple" | "helix";

export type ImportRecords = {
  source: ImportSource;
  healthDays: Array<{
    loggedOn: string;
    whoopRecovery?: number | null;
    garminBodyBattery?: number | null;
    sleepHours?: number | null;
    strain?: number | null;
    steps?: number | null;
  }>;
  workouts: Array<{
    loggedOn: string;
    name: string;
    durationMin?: number | null;
    strain?: number | null;
  }>;
  weighIns: Array<{
    loggedOn: string;
    kg: number;
  }>;
  peptides: Array<{
    name: string;
    unit: PeptideUnit;
    color?: string;
    lastAmount?: number | null;
  }>;
  vials: Array<{
    peptideName: string;
    label?: string | null;
    totalAmount: number;
    remainingAmount: number;
    dose: number;
    openedOn?: string | null;
  }>;
  doses: Array<{
    peptideName: string;
    amount: number;
    unit: PeptideUnit;
    loggedOn: string;
    loggedAt?: string;
  }>;
};

export type ImportResult = {
  healthDays: number;
  workouts: number;
  weighIns: number;
  peptides: number;
  vials: number;
  doses: number;
  warnings: string[];
};

export const HELIX_EXPORT_KIND = "helix-helper-json";
export const HELIX_EXPORT_VERSION = 1;

export type HelixHelperJson = {
  kind: typeof HELIX_EXPORT_KIND;
  version: number;
  exportedAt: string;
  peptides?: ImportRecords["peptides"];
  vials?: ImportRecords["vials"];
  doses?: ImportRecords["doses"];
  weighIns?: ImportRecords["weighIns"];
  healthDays?: ImportRecords["healthDays"];
  workouts?: ImportRecords["workouts"];
};
