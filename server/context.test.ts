import { describe, expect, it } from "vitest";
import { migratedWeightSettings, parseSettings, serializeSettings, toPublicUser } from "./context.js";
import { DEFAULT_SETTINGS } from "../shared/types.js";

describe("parseSettings", () => {
  it("reads a SQLite text payload", () => {
    expect(parseSettings(JSON.stringify({ theme: "dark", faceId: true, reduceEffects: true, weightUnit: "lb" }))).toEqual({
      theme: "dark",
      faceId: true,
      reduceEffects: true,
      weightUnit: "lb",
    });
  });

  it("reads a Neon jsonb object without JSON.parse-ing it", () => {
    expect(
      parseSettings({ theme: "light", faceId: false, reduceEffects: true, weightUnit: "lb" }),
    ).toEqual({
      theme: "light",
      faceId: false,
      reduceEffects: true,
      weightUnit: "lb",
    });
  });

  it("defaults missing weightUnit to lb", () => {
    expect(parseSettings({ theme: "dark", reduceEffects: true })).toEqual({
      theme: "dark",
      faceId: false,
      reduceEffects: true,
      weightUnit: "lb",
    });
  });

  it("migrates stored kg default to lb unless it was a choice", () => {
    expect(parseSettings({ weightUnit: "kg" })).toEqual({
      ...DEFAULT_SETTINGS,
      weightUnit: "lb",
    });
    expect(parseSettings({ weightUnit: "kg", weightUnitChosen: true })).toEqual({
      ...DEFAULT_SETTINGS,
      weightUnit: "kg",
    });
    expect(DEFAULT_SETTINGS.weightUnit).toBe("lb");
    expect(migratedWeightSettings({ weightUnit: "kg" })?.weightUnit).toBe("lb");
    expect(migratedWeightSettings({ weightUnit: "kg", weightUnitChosen: true })).toBeNull();
    expect(migratedWeightSettings({ weightUnit: "lb" })).toBeNull();
    expect(JSON.parse(serializeSettings({ ...DEFAULT_SETTINGS, weightUnit: "kg" }))).toMatchObject({
      weightUnit: "kg",
      weightUnitChosen: true,
    });
  });

  it("falls back on junk", () => {
    expect(parseSettings("not-json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(["dark"])).toEqual(DEFAULT_SETTINGS);
  });

  it("maps a user row whose settings already arrived as an object", () => {
    const user = toPublicUser({
      id: "u1",
      email: "evan@example.com",
      password_hash: "x",
      display_name: "Evan",
      settings: { theme: "dark", faceId: true, reduceEffects: false, weightUnit: "lb" },
      created_at: "2026-08-29T00:00:00.000Z",
    });
    expect(user.settings.theme).toBe("dark");
    expect(user.settings.faceId).toBe(true);
    expect(user.settings.weightUnit).toBe("lb");
  });
});
