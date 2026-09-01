export const SYRINGE_UNITS = [30, 50, 100] as const;
export type SyringeUnits = (typeof SYRINGE_UNITS)[number];

export type WaterUnit = "ml" | "IU";
export type DoseUnit = "mcg" | "mg";

export const WATER_UNITS = ["ml", "IU"] as const;
export const DOSE_UNITS = ["mcg", "mg"] as const;
export const UNITS_PER_ML = 100;
export const MCG_PER_MG = 1000;
export const MAX_CALC_PEPTIDES = 3;

export type DrawPeptide = {
  vialMg: number;
  doseMg: number;
};

export type DrawRequest = {
  syringe: SyringeUnits;
  peptides: DrawPeptide[];
  waterMl: number;
};

export type DrawOk = {
  kind: "ok";
  units: number;
  concentrationMgMl: number;
  dosesPerVial: number;
  doseMl: number;
  overSyringe: boolean;
};

export type NeedInputs = { kind: "need-inputs" };
export type DrawResult = DrawOk | NeedInputs;

export type ReverseRequest = {
  vialMg: number;
  doseMg: number;
  units: number;
};

export type ReverseOk = {
  kind: "ok";
  waterMl: number;
  waterIu: number;
};

export type ReverseResult = ReverseOk | NeedInputs;

export function parseSyringeUnits(value: string): SyringeUnits | undefined {
  if (value === "30") return 30;
  if (value === "50") return 50;
  if (value === "100") return 100;
  return undefined;
}

export function isWaterUnit(value: string): value is WaterUnit {
  return value === "ml" || value === "IU";
}

export function isDoseUnit(value: string): value is DoseUnit {
  return value === "mcg" || value === "mg";
}

export function parsePositive(raw: string): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export function waterToMl(value: number, unit: WaterUnit): number {
  return unit === "IU" ? value / UNITS_PER_ML : value;
}

export function waterFromMl(ml: number, unit: WaterUnit): number {
  return unit === "IU" ? ml * UNITS_PER_ML : ml;
}

export function convertWater(value: number, from: WaterUnit, to: WaterUnit): number {
  return waterFromMl(waterToMl(value, from), to);
}

export function doseToMg(value: number, unit: DoseUnit): number {
  return unit === "mcg" ? value / MCG_PER_MG : value;
}

export function doseFromMg(mg: number, unit: DoseUnit): number {
  return unit === "mcg" ? mg * MCG_PER_MG : mg;
}

export function convertDose(value: number, from: DoseUnit, to: DoseUnit): number {
  return doseFromMg(doseToMg(value, from), to);
}

export function formulateDraw(req: DrawRequest): DrawResult {
  const vialMg = req.peptides.reduce((sum, row) => sum + Math.max(0, row.vialMg), 0);
  const doseMg = req.peptides.reduce((sum, row) => sum + Math.max(0, row.doseMg), 0);
  if (!(req.waterMl > 0) || !(vialMg > 0) || !(doseMg > 0)) {
    return { kind: "need-inputs" };
  }
  const concentrationMgMl = vialMg / req.waterMl;
  const doseMl = doseMg / concentrationMgMl;
  const units = doseMl * UNITS_PER_ML;
  return {
    kind: "ok",
    units,
    concentrationMgMl,
    dosesPerVial: vialMg / doseMg,
    doseMl,
    overSyringe: units > req.syringe,
  };
}

export function formulateReverse(req: ReverseRequest): ReverseResult {
  if (!(req.vialMg > 0) || !(req.doseMg > 0) || !(req.units > 0)) {
    return { kind: "need-inputs" };
  }
  const waterMl = (req.vialMg * (req.units / UNITS_PER_ML)) / req.doseMg;
  return {
    kind: "ok",
    waterMl,
    waterIu: waterMl * UNITS_PER_ML,
  };
}

export function syringeTicks(syringe: SyringeUnits): number[] {
  const step = syringe === 30 ? 5 : 10;
  const ticks: number[] = [];
  for (let n = 0; n <= syringe; n += step) ticks.push(n);
  return ticks;
}

export function formatUnits(units: number): string {
  const rounded = Math.round(units * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1);
}

export function formatMgMl(value: number): string {
  return value.toFixed(2);
}

export function formatMl(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

export function vialAmountToMg(opts: { unit: "mcg" | "mg" | "IU" | "mL"; amount: number }): number | undefined {
  if (!(opts.amount > 0)) return undefined;
  if (opts.unit === "mcg") return opts.amount / MCG_PER_MG;
  if (opts.unit === "mg") return opts.amount;
  return undefined;
}
