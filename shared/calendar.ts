export function monthCells(year: number, month: number): Array<string | null> {
  const first = new Date(year, month - 1, 1).getDay();
  const last = new Date(year, month, 0).getDate();
  const cells: Array<string | null> = Array.from({ length: first }, () => null);
  for (let d = 1; d <= last; d++) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  const last = new Date(year, month, 0).getDate();
  return {
    from: `${year}-${String(month).padStart(2, "0")}-01`,
    to: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
  };
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const dt = new Date(year, month - 1 + delta, 1);
  return { year: dt.getFullYear(), month: dt.getMonth() + 1 };
}

export function monthTitle(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function inspectHeading(on: string): string {
  const [y, m, d] = on.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export const CAL_WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;

export const CAL_CHIP_CAP = 3;
