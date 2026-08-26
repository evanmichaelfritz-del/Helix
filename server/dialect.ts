import type { Database } from "./db.ts";

export function activeDoseSql(dialect: Database["dialect"]): string {
  return dialect === "postgres" ? "undone = FALSE" : "undone = 0";
}

export function undoneParam(dialect: Database["dialect"], undone: boolean): number | boolean {
  if (dialect === "postgres") return undone;
  return undone ? 1 : 0;
}

export function isUndone(value: unknown): boolean {
  return value === true || value === 1 || value === "t" || value === "true";
}
