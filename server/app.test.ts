import { describe, expect, it } from "vitest";
import { recoveryTone, remainingInjections, runwayTone, todayHero } from "../shared/health.js";
import { looksLikeGarminActivitiesCsv, parseImportFile } from "../shared/import/index.js";
import { parseHelixHelper } from "../shared/import/helix.js";
import { HELIX_EXPORT_KIND } from "../shared/types.js";
import { doseSheetMode } from "../shared/dose-sheet.js";
import { createApp } from "./app.js";
import { createSqliteDb, migrate, type Database } from "./db.js";
import { POSTGRES_SCHEMA, schemaFor } from "./schema.js";
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

    await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "helix",
        healthDays: [],
        workouts: [
          { loggedOn: "2026-08-25", name: "Yesterday run" },
          { loggedOn: "2026-08-26", name: "Today bike" },
        ],
        weighIns: [
          { loggedOn: "2026-08-25", kg: 83 },
          { loggedOn: "2026-08-26", kg: 82.4 },
        ],
      }),
    });

    const today = await app.request("/api/today?on=2026-08-26", { headers });
    const body = (await today.json()) as {
      hero: { kind: string; recovery?: number; tone?: string };
      day: { loggedOn: string; whoopRecovery: number } | null;
      weighIns: Array<{ kg: number; loggedOn: string }>;
      supporting: { weightKg: number | null; weightDeltaKg: number | null };
      workouts: Array<{ name: string; loggedOn: string }>;
    };
    expect(body.hero.kind).toBe("whoop");
    expect(body.hero.recovery).toBe(40);
    expect(body.hero.tone).toBe("amber");
    expect(body.day?.loggedOn).toBe("2026-08-26");
    expect(body.day?.whoopRecovery).toBe(40);
    expect(body.supporting.weightKg).toBe(82.4);
    expect(body.supporting.weightDeltaKg).toBeCloseTo(-0.6);
    expect(body.workouts.map((w) => w.name)).toEqual(["Today bike"]);
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

describe("dose sheet mode", () => {
  it("is undo when already logged, save otherwise", () => {
    expect(doseSheetMode(undefined).kind).toBe("save");
    const mode = doseSheetMode({ id: "d1", amount: 250, unit: "mcg" });
    expect(mode.kind).toBe("undo");
    if (mode.kind === "undo") expect(mode.doseId).toBe("d1");
  });
});

describe("postgres schema", () => {
  it("uses a Postgres migrate path, not the SQLite statements", async () => {
    const statements: string[] = [];
    const db: Database = {
      dialect: "postgres",
      all: async () => [],
      get: async () => undefined,
      run: async () => ({ changes: 0 }),
      exec: async (sql) => {
        statements.push(sql);
      },
    };
    await migrate(db);
    expect(statements).toEqual(POSTGRES_SCHEMA);
    const blob = statements.join("\n");
    expect(blob).toMatch(/jsonb/);
    expect(blob).toMatch(/double precision/);
    expect(blob).toMatch(/timestamptz/);
    expect(blob).toMatch(/boolean NOT NULL DEFAULT FALSE/);
    expect(blob).toMatch(/WHERE NOT undone/);
    expect(blob).not.toMatch(/INTEGER NOT NULL DEFAULT 0/);
    expect(schemaFor("sqlite").join("\n")).toMatch(/INTEGER NOT NULL DEFAULT 0/);
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

describe("healthz", () => {
  it("returns { ok: true }", async () => {
    const app = await testApp();
    const res = await app.request("/api/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("vercel hobby function cap", () => {
  it("leaves only api/index.ts as a serverless function", () => {
    const files = globSync("api/**/*.{ts,js,mjs,cjs}").filter((file) => {
      const name = file.slice(file.lastIndexOf("/") + 1);
      return !name.startsWith("_") && !name.startsWith(".") && !name.endsWith(".d.ts");
    });
    expect(files).toEqual(["api/index.ts"]);
  });
});

describe("vercel node function signature", () => {
  it("exports named HTTP methods, not a default fetch handler", () => {
    const text = readFileSync("api/index.ts", "utf8");
    expect(text).not.toMatch(/export default handle\s*\(/);
    expect(text).not.toMatch(/export default\s+(async\s+)?function/);
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(text).toMatch(new RegExp(`export const ${method}\\s*=`));
    }
  });
});

describe("vercel node esm specifiers", () => {
  it("uses .js specifiers in the serverless graph so compiled output resolves", () => {
    const files = globSync("{api,server,shared}/**/*.ts");
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/from\s+["'][^"']+\.ts["']/.test(text) || /import\(\s*["'][^"']+\.ts["']\s*\)/.test(text)) {
        hits.push(file);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("no grok.me RPC client", () => {
  it("never fetches helix-peptides.grok.me", () => {
    const files = globSync("{api,server,src,shared}/**/*.{ts,tsx}").filter((f) => !f.endsWith(".test.ts"));
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/fetch\s*\([^)]*helix-peptides\.grok\.me/.test(text)) hits.push(file);
      if (/from\s+["']@tanstack\/start["']/.test(text)) hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});

describe("design scaffold locks", () => {
  it("boots helix-theme onto html.light and keeps dark as :root", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toMatch(/helix-theme/);
    expect(html).toMatch(/#1c1c1e/);
    expect(html).toMatch(/#e7e8ee/);
    expect(html).toMatch(/__HELIX_THEME_BOOTED/);
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/html\.light/);
    expect(css).not.toMatch(/\[data-theme="light"\]/);
    expect(css).toMatch(/--bg-elevated/);
    expect(css).toMatch(/--border-strong/);
    expect(css).toMatch(/--accent-fg/);
    expect(css).toMatch(/--glass-chrome-highlight/);
    expect(css).toMatch(/--ring/);
    expect(css).toMatch(/--primary-fg/);
    expect(css).toMatch(/#1414181a/);
    expect(css).not.toMatch(/\.page\s*\{[^}]*padding:\s*88px 16px 168px/);
    expect(css).toMatch(/\.helix-main/);
  });

  it("keeps the FAB visible at desktop widths", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).not.toMatch(/@media \(min-width:\s*768px\)\s*\{[^}]*\.fab[^{]*\{[^}]*display:\s*none/);
    expect(css).not.toMatch(/@media \(min-width:\s*768px\)\s*\{[^}]*\.fab-wrap[^{]*\{[^}]*display:\s*none/);
  });

  it("maps locked Today / You / Vitals copy onto this tree", () => {
    const today = readFileSync("src/pages/Today.tsx", "utf8");
    const you = readFileSync("src/pages/Account.tsx", "utf8");
    const vitals = readFileSync("src/pages/Vitals.tsx", "utf8");
    const shell = readFileSync("src/components/Shell.tsx", "utf8");
    expect(today).toMatch(/EMPTY_HERO_TITLE/);
    expect(readFileSync("shared/health.ts", "utf8")).toMatch(/No reading yet/);
    expect(today).toMatch(/\/health#sources/);
    expect(today).not.toMatch(/helix-peptides\.grok\.me/);
    expect(today).not.toMatch(/Import Whoop/);
    expect(today).toMatch(/supportingLines/);
    expect(today).toMatch(/pickTodayHero/);
    expect(today).toMatch(/Log dose/);
    expect(today).toMatch(/Log weight/);
    expect(today).not.toMatch(/openSheet\(\{ kind: "add-peptide" \}\)/);
    expect(you).toMatch(/Follow system/);
    expect(you).toMatch(/Continue on grok.me/);
    expect(you).toMatch(/ImportedCounts/);
    expect(vitals).toMatch(/data-helix-scroll/);
    expect(vitals).toMatch(/Garmin JSON dailies zip/);
    expect(vitals).toMatch(/Whoop CSV/);
    expect(vitals).toMatch(/Apple Health export/);
    expect(vitals).toMatch(/function Liveline/);
    expect(shell).toMatch(/helix-main/);
    expect(shell).toMatch(/vial-runway/);
    expect(shell).toMatch(/peptide-swatch/);
    expect(today).not.toMatch(/sleepPerf/);
    expect(vitals).not.toMatch(/sleepPerf/);
    expect(you).not.toMatch(/sleepPerf/);
  });
});
