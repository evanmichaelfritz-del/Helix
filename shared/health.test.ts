import { describe, expect, it } from "vitest";
import { cn } from "./cn.js";
import {
  EMPTY_HERO_TITLE,
  pickHealthDay,
  pickTodayHero,
  recoveryTone,
  supportingLines,
  todayHero,
  todaysWorkouts,
} from "./health.js";
import { HELIX_THEME_KEY, parseThemePref, THEME_OPTIONS } from "./theme.js";

describe("cn", () => {
  it("joins vial-runway and peptide-swatch classnames", () => {
    expect(cn("vial-runway", "tiny", false && "hidden", "amber")).toBe("vial-runway tiny amber");
    expect(cn("peptide-swatch", undefined, null)).toBe("peptide-swatch");
  });
});

describe("today helpers", () => {
  it("picks the HealthDay whose loggedOn is today, never days[0]", () => {
    const days = [
      { loggedOn: "2026-08-25", whoopRecovery: 90 },
      { loggedOn: "2026-08-26", whoopRecovery: 40 },
    ];
    expect(pickHealthDay(days, "2026-08-26")?.whoopRecovery).toBe(40);
    expect(pickHealthDay(days, "2026-08-26")).not.toBe(days[0]);
    expect(pickHealthDay(days, "2026-08-27")).toBeNull();
  });

  it("uses supportingLines for sleep, strain or steps, and weigh-in weight", () => {
    const day = {
      loggedOn: "2026-08-26",
      whoopRecovery: 71,
      garminBodyBattery: null,
      sleepHours: 7.5,
      strain: 12.2,
      steps: 8000,
      sleepPerf: 94,
    };
    const hero = pickTodayHero(day);
    expect(hero.kind).toBe("whoop");
    const lines = supportingLines(
      day,
      [
        { kg: 83, loggedOn: "2026-08-25" },
        { kg: 82.4, loggedOn: "2026-08-26" },
      ],
      hero,
    );
    expect(lines.sleepHours).toBe(7.5);
    expect(lines.strain).toBe(12.2);
    expect(lines.steps).toBeNull();
    expect(lines.weightKg).toBe(82.4);
    expect(lines.weightDeltaKg).toBeCloseTo(-0.6);
  });

  it("takes weight from weigh-ins, not from an empty HealthDay", () => {
    const lines = supportingLines(null, [{ kg: 80.1, loggedOn: "2026-08-26" }], { kind: "empty" });
    expect(lines.weightKg).toBe(80.1);
    expect(lines.sleepHours).toBeNull();
  });

  it("ignores sleepPerf for hero and supporting", () => {
    const day = {
      loggedOn: "2026-08-26",
      whoopRecovery: null,
      garminBodyBattery: null,
      sleepHours: null,
      strain: null,
      steps: null,
      sleepPerf: 99,
    };
    expect(todayHero(day).kind).toBe("empty");
    expect(supportingLines(day, [], { kind: "empty" }).sleepHours).toBeNull();
  });

  it("omits workouts that are not loggedOn today", () => {
    const rows = [
      { id: "1", loggedOn: "2026-08-25", name: "Yesterday" },
      { id: "2", loggedOn: "2026-08-26", name: "Today" },
    ];
    expect(todaysWorkouts(rows, "2026-08-26").map((w) => w.name)).toEqual(["Today"]);
  });

  it("locks the empty hero title and Whoop recovery bands", () => {
    expect(EMPTY_HERO_TITLE).toBe("No reading yet");
    expect(recoveryTone(67)).toBe("green");
    expect(recoveryTone(66)).toBe("amber");
    expect(recoveryTone(34)).toBe("amber");
    expect(recoveryTone(33)).toBe("red");
  });
});

describe("theme", () => {
  it("defaults to system and labels Follow system / Light / Dark", () => {
    expect(HELIX_THEME_KEY).toBe("helix-theme");
    expect(parseThemePref(null)).toBe("system");
    expect(THEME_OPTIONS.map((o) => o.label)).toEqual(["Follow system", "Light", "Dark"]);
  });
});
