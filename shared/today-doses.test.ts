import { describe, expect, it } from "vitest";
import { buildTodayScheduledDoses } from "./health.js";
import { DEFAULT_PEPTIDE_SCHEDULE } from "./schedule.js";
import type { Dose, Peptide } from "./types.js";

const peptide = (id: string, name: string, schedule = DEFAULT_PEPTIDE_SCHEDULE): Peptide => ({
  id,
  name,
  unit: "mcg",
  color: "#7EE0C8",
  lastAmount: 250,
  schedule,
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("buildTodayScheduledDoses", () => {
  it("lists peptides scheduled for the weekday with dose and timing", () => {
    const wednesday = "2026-08-26";
    const items = buildTodayScheduledDoses({
      peptides: [
        peptide("a", "Alpha"),
        peptide("b", "Beta", { days: [1], morning: false, evening: true }),
      ],
      vials: [
        {
          id: "v1",
          peptideId: "a",
          label: null,
          totalAmount: 2500,
          remainingAmount: 2000,
          dose: 250,
          openedOn: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      doses: [],
      on: wednesday,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.peptide.name).toBe("Alpha");
    expect(items[0]?.amount).toBe(250);
    expect(items[0]?.timesLabel).toBe("Morning");
  });

  it("marks logged doses and prefers the logged amount", () => {
    const on = "2026-08-26";
    const doses: Dose[] = [
      {
        id: "d1",
        peptideId: "a",
        vialId: null,
        amount: 300,
        unit: "mcg",
        loggedOn: on as Dose["loggedOn"],
        loggedAt: "2026-08-26T12:00:00.000Z",
        undone: false,
      },
    ];
    const items = buildTodayScheduledDoses({
      peptides: [peptide("a", "Alpha")],
      vials: [],
      doses,
      on,
    });
    expect(items[0]?.logged).toBe(true);
    expect(items[0]?.amount).toBe(300);
  });
});
