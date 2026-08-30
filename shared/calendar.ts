import type { Dose, Peptide, PeptideUnit } from "./types.js";

export type CalendarDose = {
  peptideId: string;
  name: string;
  color: string;
  amount: number;
  unit: PeptideUnit;
};

export function monthCells(year: number, month: number): Array<string | null> {
  const first = new Date(year, month - 1, 1).getDay();
  const last = new Date(year, month, 0).getDate();
  const cells: Array<string | null> = Array.from({ length: first }, () => null);
  for (let d = 1; d <= last; d++) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return cells;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const dt = new Date(year, month - 1 + delta, 1);
  return { year: dt.getFullYear(), month: dt.getMonth() + 1 };
}

export function dosesByDay(doses: Dose[], peptides: Peptide[]): Map<string, CalendarDose[]> {
  const byId = new Map(peptides.map((peptide) => [peptide.id, peptide]));
  const days = new Map<string, CalendarDose[]>();
  for (const dose of doses) {
    if (dose.undone) continue;
    const peptide = byId.get(dose.peptideId);
    if (!peptide) continue;
    const list = days.get(dose.loggedOn) ?? [];
    if (list.some((row) => row.peptideId === peptide.id)) continue;
    list.push({
      peptideId: peptide.id,
      name: peptide.name,
      color: peptide.color,
      amount: dose.amount,
      unit: dose.unit,
    });
    days.set(dose.loggedOn, list);
  }
  return days;
}
