import { describe, expect, it } from "vitest";
import {
  asMixUnit,
  asSyringeCap,
  compactNum,
  lastMixFor,
  mixLead,
  mixMeta,
  syringeMarks,
  vialMath,
} from "./vial-math.js";

describe("vialMath", () => {
  it("matches the locked mg formula at 100u", () => {
    const math = vialMath({ mg: 30, bacMl: 2, dose: 2, unit: "mg", syringeUnits: 100 });
    expect(math).not.toBeNull();
    expect(math!.concMgMl).toBeCloseTo(15);
    expect(math!.concMcgMl).toBeCloseTo(15000);
    expect(math!.drawMl).toBeCloseTo(2 / 15);
    expect(math!.drawUnits).toBeCloseTo((2 / 15) * 100);
    expect(math!.dosesPerVial).toBeCloseTo(15);
  });

  it("matches the locked mcg formula at 100u", () => {
    const math = vialMath({ mg: 5, bacMl: 2, dose: 250, unit: "mcg" });
    expect(math).not.toBeNull();
    expect(math!.concMgMl).toBeCloseTo(2.5);
    expect(math!.drawMl).toBeCloseTo(0.1);
    expect(math!.drawUnits).toBeCloseTo(10);
    expect(math!.dosesPerVial).toBeCloseTo(20);
  });

  it("scales draw units with the syringe barrel", () => {
    const u100 = vialMath({ mg: 10, bacMl: 2, dose: 1, unit: "mg", syringeUnits: 100 });
    const u50 = vialMath({ mg: 10, bacMl: 2, dose: 1, unit: "mg", syringeUnits: 50 });
    const u30 = vialMath({ mg: 10, bacMl: 2, dose: 1, unit: "mg", syringeUnits: 30 });
    expect(u100!.drawUnits).toBeCloseTo(u100!.drawMl * 100);
    expect(u50!.drawUnits).toBeCloseTo(u50!.drawMl * 50);
    expect(u30!.drawUnits).toBeCloseTo(u30!.drawMl * 30);
    expect(u100!.dosesPerVial).toBeCloseTo(u50!.dosesPerVial);
  });

  it("returns null when any input is missing or not positive", () => {
    expect(vialMath({ mg: 0, bacMl: 2, dose: 1, unit: "mg" })).toBeNull();
    expect(vialMath({ mg: 10, bacMl: 0, dose: 1, unit: "mg" })).toBeNull();
    expect(vialMath({ mg: 10, bacMl: 2, dose: 0, unit: "mg" })).toBeNull();
    expect(vialMath({ mg: 10, bacMl: 2, dose: 1, unit: "mg", syringeUnits: 0 })).toBeNull();
    expect(vialMath({ mg: Number.NaN, bacMl: 2, dose: 1, unit: "mg" })).toBeNull();
  });

  it("does not invent BAC", () => {
    expect(vialMath({ mg: 30, bacMl: Number.NaN, dose: 2, unit: "mg" })).toBeNull();
  });
});

describe("syringeMarks", () => {
  it("uses live function R ticks on 100u: minor 2, labels 10", () => {
    const marks = syringeMarks(100);
    expect(marks.labels).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(marks.minor).toContain(2);
    expect(marks.minor).toContain(98);
    expect(marks.minor).not.toContain(10);
    expect(marks.minor.every((n) => n % 2 === 0 && n % 10 !== 0)).toBe(true);
  });

  it("ticks 30u and 50u minor every 1, labels every 5", () => {
    const u30 = syringeMarks(30);
    expect(u30.labels).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(u30.minor).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24, 26, 27, 28, 29]);
    const u50 = syringeMarks(50);
    expect(u50.labels).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    expect(u50.minor).toContain(1);
    expect(u50.minor).toContain(49);
    expect(u50.minor).not.toContain(5);
  });
});

describe("mix readout", () => {
  it("leads Rec 8 with draw units then meta", () => {
    const math = vialMath({ mg: 5, bacMl: 2, dose: 250, unit: "mcg" })!;
    expect(mixLead(math, 250, "mcg")).toBe("Draw 10 units for 250mcg");
    expect(mixMeta(math)).toBe("0.1 mL · 2.5 mg/mL · 20 doses / vial");
  });

  it("compacts trailing zeros", () => {
    expect(compactNum(15)).toBe("15");
    expect(compactNum(1.7)).toBe("1.7");
    expect(compactNum(0.1, 3)).toBe("0.1");
  });

  it("coerces mix unit and syringe cap", () => {
    expect(asMixUnit("mcg")).toBe("mcg");
    expect(asMixUnit("IU")).toBe("mg");
    expect(asSyringeCap(30)).toBe(30);
    expect(asSyringeCap(50)).toBe(50);
    expect(asSyringeCap(100)).toBe(100);
    expect(asSyringeCap(null)).toBe(100);
  });
});

describe("lastMixFor", () => {
  it("uses last mix with BAC, else 30mg / 2mL / defaultDose", () => {
    const peptide = { id: "p1", unit: "mcg", lastAmount: 250 };
    expect(lastMixFor(peptide, [])).toEqual({
      mg: 30,
      bacMl: 2,
      dose: 250,
      unit: "mcg",
      syringeUnits: 100,
      fromLast: false,
    });
    const imported = lastMixFor(peptide, [
      { peptideId: "p1", bacMl: null, totalAmount: 5, dose: 250, syringeUnits: 100 },
    ]);
    expect(imported.fromLast).toBe(false);
    expect(imported.bacMl).toBe(2);
    const last = lastMixFor(peptide, [
      { peptideId: "p1", bacMl: 2, totalAmount: 10, dose: 300, syringeUnits: 50 },
    ]);
    expect(last).toEqual({
      mg: 10,
      bacMl: 2,
      dose: 300,
      unit: "mcg",
      syringeUnits: 50,
      fromLast: true,
    });
  });
});
