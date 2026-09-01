import { describe, expect, it } from "vitest";
import { HAPTIC_TAP_MS, HAPTIC_TOGGLE_MS, haptic, isAppleTouch, motionReduced } from "./haptics.ts";

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

  it("no-ops when html.reduce-effects or prefers-reduced-motion", () => {
    const calls: number[][] = [];
    const html = { classList: { contains: (name: string) => name === "reduce-effects" } } as unknown as HTMLElement;
    expect(motionReduced(html, null)).toBe(true);
    expect(
      haptic(
        "tap",
        (pattern) => {
          calls.push(pattern);
          return true;
        },
        true,
      ),
    ).toBe(false);
    expect(calls).toEqual([]);
    const quiet = { classList: { contains: () => false } } as unknown as HTMLElement;
    expect(motionReduced(quiet, () => ({ matches: true }) as MediaQueryList)).toBe(true);
    expect(motionReduced(quiet, () => ({ matches: false }) as MediaQueryList)).toBe(false);
  });

  it("detects iPhone and iPad user agents", () => {
    expect(isAppleTouch("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "iPhone", 5)).toBe(true);
    expect(isAppleTouch("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", "iPad", 5)).toBe(true);
    expect(isAppleTouch("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 0)).toBe(false);
    expect(isAppleTouch("Mozilla/5.0 (Linux; Android 14)", "Linux armv8l", 5)).toBe(false);
  });
});
