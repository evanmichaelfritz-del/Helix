export type MixUnit = "mg" | "mcg";

export const MIX_UNITS: MixUnit[] = ["mg", "mcg"];

export const SYRINGE_CAPS = [30, 50, 100] as const;

export type SyringeCap = (typeof SYRINGE_CAPS)[number];

export function asMixUnit(unit: string | null | undefined): MixUnit {
  return unit === "mcg" ? "mcg" : "mg";
}

export function asSyringeCap(value: number | null | undefined): SyringeCap {
  if (value === 30 || value === 50) return value;
  return 100;
}

export function vialMath(input: {
  mg: number;
  bacMl: number;
  dose: number;
  unit: "mg" | "mcg";
  syringeUnits?: number;
}) {
  const { mg, bacMl, dose, unit, syringeUnits = 100 } = input;
  if (!(mg > 0) || !(bacMl > 0) || !(dose > 0) || !(syringeUnits > 0)) return null;
  const concMgMl = mg / bacMl;
  const concMcgMl = concMgMl * 1000;
  const drawMl = unit === "mcg" ? dose / concMcgMl : dose / concMgMl;
  return {
    concMgMl,
    concMcgMl,
    drawMl,
    drawUnits: drawMl * syringeUnits,
    dosesPerVial: unit === "mcg" ? (mg * 1000) / dose : mg / dose,
  };
}

export type VialMath = NonNullable<ReturnType<typeof vialMath>>;

export function compactNum(n: number, places = 2): string {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(places).replace(/0+$/, "").replace(/\.$/, "");
}

export function mixLead(math: VialMath, dose: number, unit: MixUnit): string {
  return `Draw ${compactNum(math.drawUnits)} units for ${compactNum(dose)}${unit}`;
}

export function mixMeta(math: VialMath): string {
  return `${compactNum(math.drawMl, 3)} mL · ${compactNum(math.concMgMl)} mg/mL · ${compactNum(math.dosesPerVial)} doses / vial`;
}

export function lastMixFor(
  peptide: { id: string; unit: string; lastAmount: number | null },
  vials: Array<{
    peptideId: string;
    bacMl: number | null;
    totalAmount: number;
    dose: number;
    syringeUnits: number;
  }>,
): {
  mg: number;
  bacMl: number;
  dose: number;
  unit: MixUnit;
  syringeUnits: SyringeCap;
  fromLast: boolean;
} {
  const last = vials.find((v) => v.peptideId === peptide.id && v.bacMl != null && v.bacMl > 0);
  const unit = asMixUnit(peptide.unit);
  const defaultDose = peptide.lastAmount != null && peptide.lastAmount > 0 ? peptide.lastAmount : 1;
  if (last && last.bacMl != null) {
    return {
      mg: last.totalAmount,
      bacMl: last.bacMl,
      dose: last.dose,
      unit,
      syringeUnits: asSyringeCap(last.syringeUnits),
      fromLast: true,
    };
  }
  return { mg: 30, bacMl: 2, dose: defaultDose, unit, syringeUnits: 100, fromLast: false };
}

export function syringeMarks(max: number): { minor: number[]; labels: number[] } {
  const minorEvery = max === 100 ? 2 : 1;
  const labelEvery = max === 100 ? 10 : 5;
  const minor: number[] = [];
  const labels: number[] = [];
  for (let i = 0; i <= max; i += minorEvery) {
    if (i % labelEvery !== 0) minor.push(i);
  }
  for (let i = 0; i <= max; i += labelEvery) labels.push(i);
  return { minor, labels };
}
