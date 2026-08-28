import { describe, expect, it } from "vitest";
import { isPeptideScheduledToday } from "./health.js";
import {
  DEFAULT_PEPTIDE_SCHEDULE,
  parsePeptideSchedule,
  scheduleSummary,
  weekdayFromLocalDate,
} from "./schedule.js";

describe("parsePeptideSchedule", () => {
  it("returns defaults for invalid input", () => {
    expect(parsePeptideSchedule(null)).toEqual(DEFAULT_PEPTIDE_SCHEDULE);
  });

  it("normalizes days and time flags", () => {
    expect(
      parsePeptideSchedule({ days: [1, 3, 3, 9], morning: false, evening: true }),
    ).toEqual({ days: [1, 3], morning: false, evening: true });
  });
});

describe("scheduleSummary", () => {
  it("formats daily and split times", () => {
    expect(scheduleSummary(DEFAULT_PEPTIDE_SCHEDULE)).toBe("Daily · AM");
    expect(
      scheduleSummary({ days: [1, 3, 5], morning: true, evening: true }),
    ).toBe("M W F · AM & PM");
  });
});

describe("isPeptideScheduledToday", () => {
  it("matches weekday from local date", () => {
    const weekday = weekdayFromLocalDate("2026-08-26");
    expect(isPeptideScheduledToday({ days: [weekday], morning: true, evening: false }, "2026-08-26")).toBe(
      true,
    );
    expect(isPeptideScheduledToday({ days: [(weekday + 1) % 7 as 0 | 1 | 2 | 3 | 4 | 5 | 6], morning: true, evening: false }, "2026-08-26")).toBe(
      false,
    );
  });
});
