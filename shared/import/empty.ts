import type { ImportRecords, ImportSource } from "../types.ts";

export function emptyRecords(source: ImportSource): ImportRecords {
  return {
    source,
    healthDays: [],
    workouts: [],
    weighIns: [],
    peptides: [],
    vials: [],
    doses: [],
  };
}
