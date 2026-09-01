import { describe, expect, it } from "vitest";
import { dosesByDay, monthCells, shiftMonth } from "./calendar.js";
import { DEFAULT_PEPTIDE_SCHEDULE, parseLocalDate, type Dose, type Peptide } from "./types.js";

function on(value: string) {
  const parsed = parseLocalDate(value);
  if (!parsed) throw new Error(`bad date ${value}`);
  return parsed;
}

function peptide(partial: Pick<Peptide, "id" | "name" | "color">): Peptide {
  return {
    unit: "mcg",
    lastAmount: 250,
    schedule: DEFAULT_PEPTIDE_SCHEDULE,
    bodyEffect: null,
    expectedResults: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

function dose(partial: Pick<Dose, "id" | "peptideId" | "loggedOn"> & Partial<Dose>): Dose {
  return {
    vialId: null,
    amount: 250,
    unit: "mcg",
    loggedAt: "2026-08-29T12:00:00.000Z",
    undone: false,
    ...partial,
  };
}

describe("monthCells", () => {
  it("pads leading blanks from Sunday", () => {
    const cells = monthCells(2026, 8);
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBeNull();
    expect(cells[6]).toBe("2026-08-01");
    expect(cells.at(-1)).toBe("2026-08-31");
  });
});

describe("shiftMonth", () => {
  it("wraps December to January", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe("dosesByDay", () => {
  const bpc = peptide({ id: "p1", name: "BPC-157", color: "#7EE0C8" });
  const tb = peptide({ id: "p2", name: "TB-500", color: "#C4B5FD" });

  it("groups active doses by day with peptide color and name", () => {
    const days = dosesByDay(
      [
        dose({ id: "d1", peptideId: "p1", loggedOn: on("2026-08-29") }),
        dose({ id: "d2", peptideId: "p2", loggedOn: on("2026-08-29"), amount: 500 }),
        dose({ id: "d3", peptideId: "p1", loggedOn: on("2026-08-28") }),
        dose({ id: "d4", peptideId: "p2", loggedOn: on("2026-08-27"), undone: true }),
      ],
      [bpc, tb],
    );
    expect(days.get("2026-08-29")?.map((row) => row.name)).toEqual(["BPC-157", "TB-500"]);
    expect(days.get("2026-08-29")?.map((row) => row.color)).toEqual(["#7EE0C8", "#C4B5FD"]);
    expect(days.get("2026-08-28")).toEqual([
      { peptideId: "p1", name: "BPC-157", color: "#7EE0C8", amount: 250, unit: "mcg" },
    ]);
    expect(days.has("2026-08-27")).toBe(false);
  });

  it("skips doses whose peptide is gone", () => {
    const days = dosesByDay([dose({ id: "d1", peptideId: "missing", loggedOn: on("2026-08-29") })], [bpc]);
    expect(days.size).toBe(0);
  });
});
