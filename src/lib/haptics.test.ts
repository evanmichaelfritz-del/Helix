import { describe, expect, it } from "vitest";
import { HAPTIC_TAP_MS, HAPTIC_TOGGLE_MS, haptic } from "./haptics.ts";

describe("haptic", () => {
  it("sends a short pulse for a tap", () => {
    const calls: number[][] = [];
    const ok = haptic("tap", (pattern) => {
      calls.push(pattern);
      return true;
    });
    expect(ok).toBe(true);
    expect(calls).toEqual([[HAPTIC_TAP_MS]]);
  });

  it("sends a two-tick pattern for a toggle", () => {
    const calls: number[][] = [];
    haptic("toggle", (pattern) => {
      calls.push(pattern);
      return true;
    });
    expect(calls).toEqual([[...HAPTIC_TOGGLE_MS]]);
  });

  it("no-ops when vibrate is missing", () => {
    expect(haptic("tap", null)).toBe(false);
  });

  it("no-ops when vibrate throws", () => {
    expect(
      haptic("tap", () => {
        throw new Error("blocked");
      }),
    ).toBe(false);
  });
});
