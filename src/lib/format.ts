import type { WeightUnit } from "@shared/types.ts";

export function formatWeight(kg: number, unit: WeightUnit): string {
  if (unit === "lb") return `${(kg * 2.20462262).toFixed(1)} lb`;
  return `${kg.toFixed(1)} kg`;
}

export function formatWeightChip(kg: number, unit: WeightUnit): string {
  if (unit === "lb") return `W ${Math.round(kg * 2.20462262)} lb`;
  return `W ${kg.toFixed(1)} kg`;
}

export function signedDelta(kg: number, unit: WeightUnit): string {
  const v = unit === "lb" ? kg * 2.20462262 : kg;
  const label = unit === "lb" ? "lb" : "kg";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(1)} ${label}`;
}

export function dayHeading(on: string): string {
  const [y, m, d] = on.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const weekday = dt.toLocaleDateString(undefined, { weekday: "long" });
  return `${weekday} ${d}`;
}

export function hoursLabel(hours: number): string {
  const h = Math.floor(hours);
  const min = Math.round((hours - h) * 60);
  if (min === 0) return `${h}h`;
  return `${h}h ${min}m`;
}

export function kgFromInput(value: number, unit: WeightUnit): number {
  return unit === "lb" ? value / 2.20462262 : value;
}
