import { describe, expect, it } from "vitest";
import { canLogDoseOn, doseSheetMode, resolveDoseLoggedOn } from "./dose-sheet.js";

describe("doseSheetMode", () => {
  it("is undo when already logged, save otherwise", () => {
    expect(doseSheetMode(undefined).kind).toBe("save");
    const mode = doseSheetMode({ id: "d1", amount: 250, unit: "mcg" });
    expect(mode.kind).toBe("undo");
    if (mode.kind === "undo") expect(mode.doseId).toBe("d1");
  });
});

describe("catch-up log dose", () => {
  it("opens the sheet with a past loggedOn instead of today", () => {
    expect(resolveDoseLoggedOn("2026-09-08", "2026-09-10")).toBe("2026-09-08");
    expect(resolveDoseLoggedOn("2026-09-10", "2026-09-10")).toBe("2026-09-10");
  });

  it("hides the Log dose CTA on future days", () => {
    expect(canLogDoseOn("2026-09-11", "2026-09-10")).toBe(false);
    expect(canLogDoseOn("2026-09-10", "2026-09-10")).toBe(true);
    expect(canLogDoseOn("2026-09-08", "2026-09-10")).toBe(true);
  });

  it("defaults omitted loggedOn to today so Today and FAB stay unchanged", () => {
    expect(resolveDoseLoggedOn(undefined, "2026-09-10")).toBe("2026-09-10");
  });
});
