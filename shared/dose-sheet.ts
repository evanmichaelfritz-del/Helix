import type { Dose, PeptideUnit } from "./types.js";

export type DoseSheetMode =
  | { kind: "save" }
  | { kind: "undo"; doseId: string; amount: number; unit: PeptideUnit };

export function doseSheetMode(logged: Pick<Dose, "id" | "amount" | "unit"> | undefined): DoseSheetMode {
  if (logged) {
    return { kind: "undo", doseId: logged.id, amount: logged.amount, unit: logged.unit };
  }
  return { kind: "save" };
}

export function resolveDoseLoggedOn<T extends string>(loggedOn: T | undefined, today: T): T {
  return loggedOn ?? today;
}

export function canLogDoseOn(on: string, today: string): boolean {
  return on <= today;
}
