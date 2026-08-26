import type { Context } from "hono";
import type { Database } from "./db.ts";
import type { UserPublic, UserSettings } from "../shared/types.ts";
import { DEFAULT_SETTINGS } from "../shared/types.ts";

export type Env = {
  Variables: {
    db: Database;
    user: UserRow | null;
  };
};

export type AppContext = Context<Env>;

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
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
  undone: number;
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

export function parseSettings(raw: string): UserSettings {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
    const obj = parsed as Record<string, unknown>;
    return {
      theme:
        obj.theme === "light" || obj.theme === "dark" || obj.theme === "system"
          ? obj.theme
          : DEFAULT_SETTINGS.theme,
      faceId: obj.faceId === true,
      reduceEffects: obj.reduceEffects === true,
      weightUnit: obj.weightUnit === "lb" ? "lb" : "kg",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function toPublicUser(row: UserRow): UserPublic {
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
