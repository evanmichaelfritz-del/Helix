import { describe, expect, it } from "vitest";
import {
  convertDose,
  convertWater,
  formatUnits,
  formulateDraw,
  formulateReverse,
  syringeTicks,
  syringeUnitMarks,
  vialAmountToMg,
} from "./peptide-calc.js";

describe("formulateDraw", () => {
  it("matches the default 5 mg / 5 ml / 250 mcg draw", () => {
    const result = formulateDraw({
      syringe: 30,
      peptides: [{ vialMg: 5, doseMg: 0.25 }],
      waterMl: 5,
    });
    expect(result).toEqual({
      kind: "ok",
      units: 25,
      concentrationMgMl: 1,
      dosesPerVial: 20,
      doseMl: 0.25,
      overSyringe: false,
    });
  });

  it("uses U-100 units so a 100-unit syringe still draws 10 units for 500 mcg at 5 mg/mL", () => {
    const result = formulateDraw({
      syringe: 100,
      peptides: [{ vialMg: 10, doseMg: 0.5 }],
      waterMl: 2,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.units).toBe(10);
    expect(result.concentrationMgMl).toBe(5);
    expect(result.dosesPerVial).toBe(20);
    expect(result.doseMl).toBe(0.1);
  });

  it("draws 5 units from 5 mg in 1 ml at 250 mcg on a 50-unit syringe", () => {
    const result = formulateDraw({
      syringe: 50,
      peptides: [{ vialMg: 5, doseMg: 0.25 }],
      waterMl: 1,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.units).toBe(5);
    expect(result.doseMl).toBe(0.05);
  });

  it("treats two peptides as one blend", () => {
    const result = formulateDraw({
      syringe: 50,
      peptides: [
        { vialMg: 5, doseMg: 0.25 },
        { vialMg: 5, doseMg: 0.25 },
      ],
      waterMl: 2,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.units).toBe(10);
    expect(result.concentrationMgMl).toBe(5);
    expect(result.dosesPerVial).toBe(20);
  });

  it("flags a draw that past the syringe", () => {
    const result = formulateDraw({
      syringe: 30,
      peptides: [{ vialMg: 5, doseMg: 0.5 }],
      waterMl: 5,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.units).toBe(50);
    expect(result.overSyringe).toBe(true);
  });

  it("asks for inputs when water or dose is missing", () => {
    expect(
      formulateDraw({
        syringe: 30,
        peptides: [{ vialMg: 5, doseMg: 0 }],
        waterMl: 5,
      }).kind,
    ).toBe("need-inputs");
  });
});

describe("formulateReverse", () => {
  it("finds 20 ml of water for a 100-unit 250 mcg draw from 5 mg", () => {
    const result = formulateReverse({ vialMg: 5, doseMg: 0.25, units: 100 });
    expect(result).toEqual({ kind: "ok", waterMl: 20, waterIu: 2000 });
  });

  it("finds 5 ml of water for a 25-unit 250 mcg draw from 5 mg", () => {
    const result = formulateReverse({ vialMg: 5, doseMg: 0.25, units: 25 });
    expect(result).toEqual({ kind: "ok", waterMl: 5, waterIu: 500 });
  });
});

describe("unit conversion", () => {
  it("treats 100 IU as 1 ml", () => {
    expect(convertWater(2, "ml", "IU")).toBe(200);
    expect(convertWater(200, "IU", "ml")).toBe(2);
  });

  it("treats 1000 mcg as 1 mg", () => {
    expect(convertDose(250, "mcg", "mg")).toBe(0.25);
    expect(convertDose(0.25, "mg", "mcg")).toBe(250);
  });

  it("converts a mcg vial amount into mg", () => {
    expect(vialAmountToMg({ unit: "mcg", amount: 2500 })).toBe(2.5);
    expect(vialAmountToMg({ unit: "mg", amount: 5 })).toBe(5);
    expect(vialAmountToMg({ unit: "IU", amount: 10 })).toBeUndefined();
  });
});

describe("display helpers", () => {
  it("prints whole units without a decimal", () => {
    expect(formatUnits(25)).toBe("25");
    expect(formatUnits(10.04)).toBe("10");
    expect(formatUnits(2.5)).toBe("2.5");
  });

  it("ticks a 30-unit syringe by fives", () => {
    expect(syringeTicks(30)).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(syringeTicks(100)[0]).toBe(0);
    expect(syringeTicks(100).at(-1)).toBe(100);
  });

  it("marks every two units on the barrel", () => {
    expect(syringeUnitMarks(30)).toEqual([
      0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30,
    ]);
    expect(syringeUnitMarks(50)).toHaveLength(26);
    expect(syringeUnitMarks(100).at(-1)).toBe(100);
  });
});
