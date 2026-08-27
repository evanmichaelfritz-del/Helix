import type { Database } from "./db.js";

export function activeDoseSql(dialect: Database["dialect"], alias?: string): string {
  const column = alias ? `${alias}.undone` : "undone";
  return dialect === "postgres" ? `${column} = FALSE` : `${column} = 0`;
}

export function undoneParam(dialect: Database["dialect"], undone: boolean): number | boolean {
  if (dialect === "postgres") return undone;
  return undone ? 1 : 0;
}

export function isUndone(value: unknown): boolean {
  return value === true || value === 1 || value === "t" || value === "true";
}
