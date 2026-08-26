import { describe, expect, it } from "vitest";
import { recoveryTone, remainingInjections, runwayTone, todayHero } from "../shared/health.ts";
import { looksLikeGarminActivitiesCsv, parseImportFile } from "../shared/import/index.ts";
import { parseHelixHelper } from "../shared/import/helix.ts";
import { HELIX_EXPORT_KIND } from "../shared/types.ts";
import { createApp } from "./app.ts";
import { createSqliteDb, migrate } from "./db.ts";
import { globSync, readFileSync } from "node:fs";

async function testApp() {
  const db = await createSqliteDb(":memory:");
  await migrate(db);
  return createApp(db);
}

async function signup(app: ReturnType<typeof createApp>, email = "evan@example.com") {
  const res = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password12" }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(res.status).toBe(201);
  return cookie.split(";")[0];
}

describe("today hero matching", () => {
  it("uses logged_on === today, never the first inserted day", async () => {
    const app = await testApp();
    const cookie = await signup(app);
    const headers = { Cookie: cookie, "Content-Type": "application/json", "X-Local-Date": "2026-08-26" };

    await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "whoop",
        healthDays: [
          { loggedOn: "2026-08-25", whoopRecovery: 90 },
          { loggedOn: "2026-08-26", whoopRecovery: 40 },
        ],
        workouts: [],
        weighIns: [],
      }),
    });

    const today = await app.request("/api/today?on=2026-08-26", { headers });
    const body = (await today.json()) as { hero: { kind: string; recovery?: number; tone?: string } };
    expect(body.hero.kind).toBe("whoop");
    expect(body.hero.recovery).toBe(40);
    expect(body.hero.tone).toBe("amber");
  });
});

describe("doses", () => {
  it("blocks double-log and undo restores the slot", async () => {
    const app = await testApp();
    const cookie = await signup(app);
    const headers = { Cookie: cookie, "Content-Type": "application/json" };
    const created = await app.request("/api/peptides", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Tesamorelin", unit: "mcg" }),
    });
    const peptide = ((await created.json()) as { peptide: { id: string } }).peptide;
    await app.request("/api/vials", {
      method: "POST",
      headers,
      body: JSON.stringify({ peptideId: peptide.id, totalAmount: 2500, dose: 250 }),
    });

    const first = await app.request("/api/doses", {
      method: "POST",
      headers,
      body: JSON.stringify({ peptideId: peptide.id, amount: 250, loggedOn: "2026-08-26" }),
    });
    expect(first.status).toBe(201);
    const dose = ((await first.json()) as { dose: { id: string } }).dose;

    const second = await app.request("/api/doses", {
      method: "POST",
      headers,
      body: JSON.stringify({ peptideId: peptide.id, amount: 250, loggedOn: "2026-08-26" }),
    });
    expect(second.status).toBe(409);

    await app.request(`/api/doses/${dose.id}/undo`, { method: "POST", headers });
    const third = await app.request("/api/doses", {
      method: "POST",
      headers,
      body: JSON.stringify({ peptideId: peptide.id, amount: 250, loggedOn: "2026-08-26" }),
    });
    expect(third.status).toBe(201);

    const vials = await app.request("/api/vials", { headers });
    const list = (await vials.json()) as { vials: Array<{ remainingAmount: number; remainingInjections: number }> };
    expect(list.vials[0].remainingInjections).toBe(9);
  });
});

describe("runway", () => {
  it("counts injections at vial.dose and colors last/empty red", () => {
    expect(remainingInjections({ remainingAmount: 750, dose: 250 })).toBe(3);
    expect(runwayTone(3)).toBe("amber");
    expect(runwayTone(1)).toBe("red");
    expect(runwayTone(0)).toBe("red");
    expect(runwayTone(8)).toBe("ok");
    expect(recoveryTone(67)).toBe("green");
    expect(recoveryTone(34)).toBe("amber");
    expect(recoveryTone(33)).toBe("red");
    expect(todayHero(null).kind).toBe("empty");
  });
});

describe("import parsers", () => {
  it("rejects Garmin Activities CSV", async () => {
    const csv = "Activity Type,Date,Title,Distance,Calories\nRunning,2026-08-01,Morning,5.2,400\n";
    expect(looksLikeGarminActivitiesCsv({ name: "Activities.csv", text: csv })).toBe(true);
    const parsed = await parseImportFile({
      name: "Activities.csv",
      type: "text/csv",
      buffer: new TextEncoder().encode(csv).buffer,
    });
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") {
      expect(parsed.error).toMatch(/JSON dailies zip/);
    }
  });

  it("reads Garmin JSON dailies", async () => {
    const parsed = await parseImportFile({
      name: "dailies.json",
      type: "application/json",
      buffer: new TextEncoder().encode(
        JSON.stringify([{ calendarDate: "2026-08-26", bodyBatteryMostRecentValue: 72, steps: 8122 }]),
      ).buffer,
    });
    expect(parsed.kind).toBe("ok");
    if (parsed.kind === "ok") {
      expect(parsed.records.source).toBe("garmin");
      expect(parsed.records.healthDays[0]?.garminBodyBattery).toBe(72);
    }
  });

  it("reads helix helper JSON and rejects token paste", () => {
    const ok = parseHelixHelper(
      JSON.stringify({
        kind: HELIX_EXPORT_KIND,
        version: 1,
        exportedAt: "2026-08-26T00:00:00Z",
        peptides: [{ name: "BPC-157", unit: "mcg", lastAmount: 250 }],
      }),
    );
    expect(ok.kind).toBe("ok");
    const bad = parseHelixHelper(JSON.stringify({ accessToken: "abc", kind: HELIX_EXPORT_KIND }));
    expect(bad.kind).toBe("error");
  });
});

describe("no grok.me RPC client", () => {
  it("never fetches helix-peptides.grok.me", () => {
    const files = globSync("{api,src,shared}/**/*.{ts,tsx}").filter((f) => !f.endsWith(".test.ts"));
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/fetch\s*\([^)]*helix-peptides\.grok\.me/.test(text)) hits.push(file);
      if (/from\s+["']@tanstack\/start["']/.test(text)) hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});
