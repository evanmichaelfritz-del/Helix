import type { Dose, HealthDay, Peptide, PeptideUnit, Vial, WeighIn, Workout } from "../../shared/types.ts";
import { parseLocalDate } from "../../shared/types.ts";
import type { DoseRow, HealthDayRow, PeptideRow, VialRow, WeighInRow, WorkoutRow } from "../context.ts";
import { num } from "../context.ts";

function unitOf(unit: string): PeptideUnit {
  if (unit === "mcg" || unit === "mg" || unit === "IU" || unit === "mL") return unit;
  return "mcg";
}

function dateOf(value: string) {
  return parseLocalDate(value) ?? (value as Dose["loggedOn"]);
}

export function mapPeptide(row: PeptideRow): Peptide {
  return {
    id: row.id,
    name: row.name,
    unit: unitOf(row.unit),
    color: row.color,
    lastAmount: num(row.last_amount),
    createdAt: row.created_at,
  };
}

export function mapVial(row: VialRow): Vial {
  return {
    id: row.id,
    peptideId: row.peptide_id,
    label: row.label,
    totalAmount: Number(row.total_amount),
    remainingAmount: Number(row.remaining_amount),
    dose: Number(row.dose),
    openedOn: row.opened_on,
    createdAt: row.created_at,
  };
}

export function mapDose(row: DoseRow): Dose {
  return {
    id: row.id,
    peptideId: row.peptide_id,
    vialId: row.vial_id,
    amount: Number(row.amount),
    unit: unitOf(row.unit),
    loggedOn: dateOf(row.logged_on),
    loggedAt: row.logged_at,
    undone: Number(row.undone) !== 0,
  };
}

export function mapWeighIn(row: WeighInRow): WeighIn {
  return {
    id: row.id,
    kg: Number(row.kg),
    loggedOn: dateOf(row.logged_on),
    createdAt: row.created_at,
  };
}

export function mapHealthDay(row: HealthDayRow): HealthDay {
  return {
    id: row.id,
    loggedOn: dateOf(row.logged_on),
    whoopRecovery: num(row.whoop_recovery),
    garminBodyBattery: num(row.garmin_body_battery),
    sleepHours: num(row.sleep_hours),
    strain: num(row.strain),
    steps: num(row.steps),
    source: row.source,
  };
}

export function mapWorkout(row: WorkoutRow): Workout {
  return {
    id: row.id,
    loggedOn: dateOf(row.logged_on),
    name: row.name,
    durationMin: num(row.duration_min),
    strain: num(row.strain),
    source: row.source,
    createdAt: row.created_at,
  };
}
