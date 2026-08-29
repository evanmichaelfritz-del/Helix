import { describe, expect, it } from "vitest";
import { parseSettings, toPublicUser } from "./context.js";
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
      parseSettings({ theme: "light", faceId: false, reduceEffects: true, weightUnit: "kg" }),
    ).toEqual({
      theme: "light",
      faceId: false,
      reduceEffects: true,
      weightUnit: "kg",
    });
  });

  it("does not collapse a jsonb object to defaults", () => {
    expect(parseSettings({ theme: "dark", reduceEffects: true })).toEqual({
      theme: "dark",
      faceId: false,
      reduceEffects: true,
      weightUnit: "kg",
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
