import { describe, expect, it } from "vitest";
import { LIVELINE_W, livelineIndexAt, livelinePoints, livelineViewX } from "./liveline.js";

describe("livelinePoints", () => {
  it("maps min to the bottom and max to the top", () => {
    const { min, max, pts } = livelinePoints([80, 82, 84]);
    expect(min).toBe(80);
    expect(max).toBe(84);
    expect(pts[0]?.y).toBeGreaterThan(pts[2]?.y ?? 0);
    expect(pts[0]?.x).toBe(4);
    expect(pts[2]?.x).toBe(LIVELINE_W - 4);
  });
});

describe("livelineIndexAt", () => {
  it("picks the nearest point and clamps the edges", () => {
    expect(livelineIndexAt(4, 5)).toBe(0);
    expect(livelineIndexAt(LIVELINE_W - 4, 5)).toBe(4);
    expect(livelineIndexAt(-20, 5)).toBe(0);
    expect(livelineIndexAt(LIVELINE_W + 40, 5)).toBe(4);
    expect(livelineIndexAt(LIVELINE_W / 2, 5)).toBe(2);
  });
});

describe("livelineViewX", () => {
  it("scales a pointer into the viewBox", () => {
    expect(livelineViewX(150, { left: 100, width: 200 })).toBe(80);
  });
});
