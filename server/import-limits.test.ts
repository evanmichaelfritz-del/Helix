import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseImportFile } from "../shared/import/index.js";
import { WHOOP_IMPORT_CAP } from "../shared/import/whoop.js";
import { createApp } from "./app.js";
import { createSqliteDb, migrate } from "./db.js";
import { IMPORT_BODY_MAX_BYTES } from "./routes/import.js";

async function testApp() {
  const db = await createSqliteDb(":memory:");
  await migrate(db);
  return createApp(db);
}

async function signup(app: ReturnType<typeof createApp>) {
  const res = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.50" },
    body: JSON.stringify({ email: "evan@example.com", password: "password12" }),
  });
  expect(res.status).toBe(201);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

function addUtcDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

describe("import body limit and schema bounds", () => {
  it("rejects an import larger than 1000000 bytes with 413", async () => {
    const app = await testApp();
    const cookie = await signup(app);
    const res = await app.request("/api/import/records", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: "x".repeat(IMPORT_BODY_MAX_BYTES + 1),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Import is too large." });
  });

  it("still parses a body at exactly the limit", async () => {
    const app = await testApp();
    const cookie = await signup(app);
    const res = await app.request("/api/import/records", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: "x".repeat(IMPORT_BODY_MAX_BYTES),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Malformed JSON in request body" });
  });

  it("accepts a Whoop CSV zip at the 400-day cap and a bounded Helix payload", async () => {
    const app = await testApp();
    const cookie = await signup(app);
    const headers = { Cookie: cookie, "Content-Type": "application/json" };

    const dates = Array.from({ length: 450 }, (_, i) => addUtcDays("2025-06-02", i));
    const cycles = [
      "Recovery score %,Day Strain,Asleep duration (min),Cycle start time",
      ...dates.map(
        (loggedOn, i) =>
          `${40 + (i % 50)},${(i % 20) + 1}.2,${300 + (i % 120)},${loggedOn}T04:00:00.000Z`,
      ),
    ].join("\n");
    const workouts = [
      "Recovery score %,Day Strain,Activity name,Duration (min),Activity Strain,Cycle start time",
      ...dates.map(
        (loggedOn, i) => `${50},${8.1},Ride ${i},40,${(i % 10) + 1},${loggedOn}T15:00:00.000Z`,
      ),
    ].join("\n");
    const zip = new JSZip();
    zip.file("physiological_cycles.csv", cycles);
    zip.file("workouts.csv", workouts);
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const parsed = await parseImportFile({
      name: "whoop-export.zip",
      type: "application/zip",
      buffer,
    });
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.records.healthDays).toHaveLength(WHOOP_IMPORT_CAP);
    expect(parsed.records.workouts).toHaveLength(WHOOP_IMPORT_CAP);
    const whoopBody = JSON.stringify(parsed.records);
    expect(Buffer.byteLength(whoopBody)).toBeLessThan(IMPORT_BODY_MAX_BYTES);

    const imported = await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: whoopBody,
    });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({
      healthDays: WHOOP_IMPORT_CAP,
      workouts: WHOOP_IMPORT_CAP,
    });

    const name = "A".repeat(80);
    const helix = await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "helix",
        healthDays: [],
        workouts: [],
        weighIns: [],
        peptides: [{ name, unit: "mcg", lastAmount: 10000 }],
        vials: [
          {
            peptideName: name,
            totalAmount: 10000,
            remainingAmount: 8500,
            dose: 500,
            openedOn: "2026-08-26",
          },
        ],
        doses: [
          {
            peptideName: name,
            amount: 500,
            unit: "mcg",
            loggedOn: "2026-08-30",
            loggedAt: "2026-08-30T12:00:00.000Z",
          },
        ],
      }),
    });
    expect(helix.status).toBe(200);
    expect(await helix.json()).toMatchObject({ peptides: 1, vials: 1, doses: 1 });
  });

  it("rejects oversized names, bad dates, and amounts above the cap", async () => {
    const app = await testApp();
    const cookie = await signup(app);
    const headers = { Cookie: cookie, "Content-Type": "application/json" };
    const base = {
      source: "helix",
      healthDays: [],
      workouts: [],
      weighIns: [],
      peptides: [{ name: "MOTS-C", unit: "mcg", lastAmount: 500 }],
    };

    const longName = await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...base,
        vials: [
          {
            peptideName: "A".repeat(81),
            totalAmount: 10000,
            remainingAmount: 8500,
            dose: 500,
          },
        ],
      }),
    });
    expect(longName.status).toBe(400);

    const badOpened = await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...base,
        vials: [
          {
            peptideName: "MOTS-C",
            totalAmount: 10000,
            remainingAmount: 8500,
            dose: 500,
            openedOn: "2026-08-26T00:00:00.000Z",
          },
        ],
      }),
    });
    expect(badOpened.status).toBe(400);

    const badLoggedAt = await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...base,
        doses: [
          {
            peptideName: "MOTS-C",
            amount: 500,
            unit: "mcg",
            loggedOn: "2026-08-30",
            loggedAt: "2026-08-30",
          },
        ],
      }),
    });
    expect(badLoggedAt.status).toBe(400);

    const hugeAmount = await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...base,
        doses: [
          {
            peptideName: "MOTS-C",
            amount: 1_000_001,
            unit: "mcg",
            loggedOn: "2026-08-30",
          },
        ],
      }),
    });
    expect(hugeAmount.status).toBe(400);

    const tooManyDays = await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...base,
        healthDays: Array.from({ length: 401 }, (_, i) => ({
          loggedOn: addUtcDays("2024-01-01", i),
          whoopRecovery: 50,
        })),
      }),
    });
    expect(tooManyDays.status).toBe(400);
  });
});
