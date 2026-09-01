import type { Context } from "hono";
import type { Database } from "./db.js";
import type { UserPublic, UserSettings } from "../shared/types.js";
import { DEFAULT_SETTINGS } from "../shared/types.js";

export type Env = {
  Variables: {
    db: Database;
    user: UserRow | null;
  };
};

export type AppContext = Context<Env>;

export type UserRow = {
  id: string;
  email: string | null;
  password_hash: string | null;
  display_name: string | null;
  settings: string;
  created_at: string;
};

export type PeptideRow = {
  id: string;
  user_id: string;
  name: string;
  unit: string;
  color: string;
  last_amount: number | null;
  schedule: string;
  body_effect?: string | null;
  expected_results?: string | null;
  created_at: string;
};

export type VialRow = {
  id: string;
  user_id: string;
  peptide_id: string;
  label: string | null;
  total_amount: number;
  remaining_amount: number;
  dose: number;
  bac_ml?: number | null;
  syringe_units?: number | null;
  opened_on: string | null;
  created_at: string;
};

export type DoseRow = {
  id: string;
  user_id: string;
  peptide_id: string;
  vial_id: string | null;
  amount: number;
  unit: string;
  logged_on: string;
  logged_at: string;
  undone: number | boolean;
};

export type WeighInRow = {
  id: string;
  user_id: string;
  kg: number;
  logged_on: string;
  created_at: string;
};

export type HealthDayRow = {
  id: string;
  user_id: string;
  logged_on: string;
  whoop_recovery: number | null;
  garmin_body_battery: number | null;
  sleep_hours: number | null;
  strain: number | null;
  steps: number | null;
  source: string | null;
};

export type WorkoutRow = {
  id: string;
  user_id: string;
  logged_on: string;
  name: string;
  duration_min: number | null;
  strain: number | null;
  source: string | null;
  created_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rawSettings(raw: unknown): Record<string, unknown> | null {
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseWeightUnit(parsed: Record<string, unknown>): UserSettings["weightUnit"] {
  if (parsed.weightUnit === "lb") return "lb";
  if (parsed.weightUnit === "kg" && parsed.weightUnitChosen === true) return "kg";
  return "lb";
}

export function parseSettings(raw: unknown): UserSettings {
  const parsed = rawSettings(raw);
  if (!parsed) return { ...DEFAULT_SETTINGS };
  return {
    theme:
      parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system"
        ? parsed.theme
        : DEFAULT_SETTINGS.theme,
    faceId: parsed.faceId === true,
    reduceEffects: parsed.reduceEffects === true,
    weightUnit: parseWeightUnit(parsed),
  };
}

export function serializeSettings(settings: UserSettings): string {
  return JSON.stringify({ ...settings, weightUnitChosen: true });
}

export function migratedWeightSettings(raw: unknown): UserSettings | null {
  const parsed = rawSettings(raw);
  if (!parsed) return { ...DEFAULT_SETTINGS };
  const wasDefaultKg = parsed.weightUnit === "kg" && parsed.weightUnitChosen !== true;
  const missing = parsed.weightUnit !== "kg" && parsed.weightUnit !== "lb";
  if (!wasDefaultKg && !missing) return null;
  return parseSettings(parsed);
}

export function toPublicUser(row: Omit<UserRow, "settings"> & { settings: unknown }): UserPublic {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    settings: parseSettings(row.settings),
    createdAt: row.created_at,
  };
}

export function num(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
