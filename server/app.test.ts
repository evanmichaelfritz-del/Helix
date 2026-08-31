import { describe, expect, it } from "vitest";
import { recoveryTone, remainingInjections, runwayTone, todayHero } from "../shared/health.js";
import { looksLikeGarminActivitiesCsv, parseImportFile } from "../shared/import/index.js";
import { parseHelixHelper } from "../shared/import/helix.js";
import { HELIX_EXPORT_KIND } from "../shared/types.js";
import { doseSheetMode } from "../shared/dose-sheet.js";
import { createApp } from "./app.js";
import { createSqliteDb, migrate, type Database } from "./db.js";
import { linkOrCreateOAuthUser } from "./oauth-user.js";
import { POSTGRES_SCHEMA, schemaFor } from "./schema.js";
import { webauthnOrigins } from "./origin.js";
import { activeDoseSql } from "./dialect.js";
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

const HELIX_PEPTIDES = ["Tesamorelin", "Ipamorelin", "BPC-157", "CJC-1295"] as const;

function helixHelperRecords() {
  const peptides = HELIX_PEPTIDES.map((name) => ({ name, unit: "mcg" as const, lastAmount: 250 }));
  const vials = HELIX_PEPTIDES.map((name) => ({
    peptideName: name,
    label: `${name} vial`,
    totalAmount: 2500,
    remainingAmount: 2000,
    dose: 250,
  }));
  const doses = Array.from({ length: 69 }, (_, i) => {
    const month = 1 + Math.floor(i / 28);
    const day = 1 + (i % 28);
    return {
      peptideName: HELIX_PEPTIDES[i % 4],
      amount: 250,
      unit: "mcg" as const,
      loggedOn: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    };
  });
  const weighIns = Array.from({ length: 9 }, (_, i) => ({
    loggedOn: `2026-01-${String(i + 1).padStart(2, "0")}`,
    kg: 82 + i * 0.1,
  }));
  return {
    source: "helix" as const,
    healthDays: [
      { loggedOn: "2026-01-01", whoopRecovery: 70, sleepHours: 7.2 },
      { loggedOn: "2026-01-02", whoopRecovery: 55 },
    ],
    workouts: [
      { loggedOn: "2026-01-01", name: "Zone 2", durationMin: 45 },
      { loggedOn: "2026-01-02", name: "Lift" },
    ],
    weighIns,
    peptides,
    vials,
    doses,
  };
}

function wrapDb(
  inner: Database,
  interceptRun?: (sql: string, run: Database["run"]) => ReturnType<Database["run"]>,
): { db: Database; sqls: string[] } {
  const sqls: string[] = [];
  const wrap = (db: Database): Database => ({
    dialect: db.dialect,
    all: async (sql, params) => {
      sqls.push(sql);
      return db.all(sql, params);
    },
    get: async (sql, params) => {
      sqls.push(sql);
      return db.get(sql, params);
    },
    run: async (sql, params) => {
      sqls.push(sql);
      if (interceptRun) return interceptRun(sql, (nextSql, nextParams) => db.run(nextSql, nextParams ?? params));
      return db.run(sql, params);
    },
    exec: async (sql) => {
      sqls.push(sql);
      return db.exec(sql);
    },
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    batch: async (statements) => {
      for (const statement of statements) sqls.push(statement.sql);
      if (!interceptRun) return db.batch(statements);
      return inner.transaction(async () => {
        for (const statement of statements) {
          await interceptRun(statement.sql, (sql, params) =>
            inner.run(sql, params ?? statement.params ?? []),
          );
        }
        return [];
      });
    },
  });
  return { db: wrap(inner), sqls };
}

describe("import records batch", () => {
  it("imports 69 doses + 9 weigh-ins + 4 peptides + 4 vials without per-dose selects", async () => {
    const raw = await createSqliteDb(":memory:");
    await migrate(raw);
    const { db, sqls } = wrapDb(raw);
    const app = createApp(db);
    const cookie = await signup(app);
    sqls.length = 0;
    const payload = helixHelperRecords();
    const res = await app.request("/api/import/records", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      healthDays: 2,
      workouts: 2,
      weighIns: 9,
      peptides: 4,
      vials: 4,
      doses: 69,
      warnings: [],
    });
    expect(sqls.filter((sql) => /^\s*SELECT\b/i.test(sql) && /\bFROM doses\b/i.test(sql))).toHaveLength(1);
    expect(sqls.some((sql) => /peptide_id = \? AND logged_on = \?/.test(sql))).toBe(false);
    const doseInserts = sqls.filter((sql) => /INSERT INTO doses/i.test(sql));
    expect(doseInserts).toHaveLength(1);
    expect(doseInserts[0]).toMatch(/UNION ALL/);
    expect(doseInserts[0]).toMatch(/\bd\.undone\b/);
    expect(doseInserts[0]).not.toMatch(/AND undone =/);
    const vialInserts = sqls.filter((sql) => /INSERT INTO vials/i.test(sql));
    expect(vialInserts).toHaveLength(1);
    expect(vialInserts[0]).toMatch(/WHERE NOT EXISTS \(\s*SELECT 1 FROM vials v/s);
    expect(await raw.all("SELECT id FROM doses")).toHaveLength(69);
    expect(await raw.all("SELECT id FROM peptides")).toHaveLength(4);
    expect(await raw.all("SELECT id FROM vials")).toHaveLength(4);
    expect(await raw.all("SELECT id FROM weigh_ins")).toHaveLength(9);
  });

  it("second import skips duplicate peptides and same-day doses", async () => {
    const db = await createSqliteDb(":memory:");
    await migrate(db);
    const app = createApp(db);
    const cookie = await signup(app);
    const headers = { Cookie: cookie, "Content-Type": "application/json" };
    const payload = helixHelperRecords();
    const first = await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    const second = await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(200);
    const body = (await second.json()) as {
      peptides: number;
      vials: number;
      doses: number;
      weighIns: number;
      workouts: number;
      healthDays: number;
      warnings: string[];
    };
    expect(body.peptides).toBe(0);
    expect(body.doses).toBe(0);
    expect(body.workouts).toBe(0);
    expect(body.weighIns).toBe(9);
    expect(body.healthDays).toBe(2);
    expect(body.vials).toBe(0);
    expect(body.warnings).toEqual([
      ...HELIX_PEPTIDES.map((name) => `Skipped peptide already in Helix: ${name}`),
      ...HELIX_PEPTIDES.map((name) => `Skipped vial already in Helix: ${name}`),
    ]);
    expect(await db.all("SELECT id FROM peptides")).toHaveLength(4);
    expect(await db.all("SELECT id FROM doses")).toHaveLength(69);
    expect(await db.all("SELECT id FROM vials")).toHaveLength(4);
  });

  it("does not insert a third vial set when peptides already have vials", async () => {
    const db = await createSqliteDb(":memory:");
    await migrate(db);
    const app = createApp(db);
    const cookie = await signup(app);
    const headers = { Cookie: cookie, "Content-Type": "application/json" };
    const payload = helixHelperRecords();
    const first = await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    const peptidesRes = await app.request("/api/peptides", { headers });
    const peptides = ((await peptidesRes.json()) as { peptides: Array<{ id: string }> }).peptides;
    expect(peptides).toHaveLength(4);
    for (const peptide of peptides) {
      const created = await app.request("/api/vials", {
        method: "POST",
        headers,
        body: JSON.stringify({ peptideId: peptide.id, totalAmount: 2500, dose: 250 }),
      });
      expect(created.status).toBe(201);
    }
    expect(await db.all("SELECT id FROM vials")).toHaveLength(8);
    const retry = await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    expect(retry.status).toBe(200);
    const body = (await retry.json()) as { vials: number; warnings: string[] };
    expect(body.vials).toBe(0);
    expect(body.warnings).toEqual(
      expect.arrayContaining(HELIX_PEPTIDES.map((name) => `Skipped vial already in Helix: ${name}`)),
    );
    expect(await db.all("SELECT id FROM vials")).toHaveLength(8);
  });

  it("rolls back weigh-ins when a later write fails", async () => {
    const raw = await createSqliteDb(":memory:");
    await migrate(raw);
    const { db } = wrapDb(raw, async (sql, run) => {
      if (/INSERT INTO doses/i.test(sql)) throw new Error("injected failure after weigh-ins");
      return run(sql);
    });
    const app = createApp(db);
    const cookie = await signup(app);
    const res = await app.request("/api/import/records", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(helixHelperRecords()),
    });
    expect(res.status).toBe(500);
    expect(await raw.all("SELECT id FROM weigh_ins")).toEqual([]);
    expect(await raw.all("SELECT id FROM peptides")).toEqual([]);
    expect(await raw.all("SELECT id FROM vials")).toEqual([]);
    expect(await raw.all("SELECT id FROM doses")).toEqual([]);
    expect(await raw.all("SELECT id FROM health_days")).toEqual([]);
    expect(await raw.all("SELECT id FROM workouts")).toEqual([]);
  });

  it("skips vials and doses for unknown peptides", async () => {
    const app = await testApp();
    const cookie = await signup(app);
    const res = await app.request("/api/import/records", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "helix",
        healthDays: [],
        workouts: [],
        weighIns: [],
        peptides: [],
        vials: [
          {
            peptideName: "Mystery",
            totalAmount: 1000,
            remainingAmount: 1000,
            dose: 250,
          },
        ],
        doses: [{ peptideName: "Mystery", amount: 250, unit: "mcg", loggedOn: "2026-01-01" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      healthDays: 0,
      workouts: 0,
      weighIns: 0,
      peptides: 0,
      vials: 0,
      doses: 0,
      warnings: ["Skipped vial for unknown peptide: Mystery", "Skipped dose for unknown peptide: Mystery"],
    });
  });

  it("401s unauthenticated import without touching records", async () => {
    const app = await testApp();
    const res = await app.request("/api/import/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "helix", healthDays: [], workouts: [], weighIns: [] }),
    });
    expect(res.status).toBe(401);
  });

  it("batches writes in one transaction without COPY or a second function", () => {
    const text = readFileSync("server/routes/import.ts", "utf8");
    const db = readFileSync("server/db.ts", "utf8");
    expect(text).toMatch(/db\.batch/);
    expect(text).toMatch(/INSERT INTO doses \([^)]+\)/);
    expect(text).toMatch(/UNION ALL/);
    expect(text).toMatch(/activeDoseSql\(db\.dialect, "d"\)/);
    expect(text).toMatch(/FROM vials v/);
    expect(text).not.toMatch(/\bCOPY\b/);
    expect(text).not.toMatch(/SELECT id FROM doses WHERE user_id = \? AND peptide_id/);
    expect(text).not.toMatch(/INSERT INTO vials[\s\S]*ON CONFLICT/);
    expect(db).toMatch(/sql\.transaction/);
    expect(db).not.toMatch(/\bnew Pool\b/);
    expect(db).not.toMatch(/\bnew Client\b/);
    expect(globSync("api/**/*.{ts,js}").filter((f) => !f.includes("/_"))).toEqual(["api/index.ts"]);
    expect(readFileSync("api/index.ts", "utf8")).toMatch(/maxDuration:\s*10/);
    expect(readFileSync("vercel.json", "utf8")).toMatch(/"maxDuration":\s*10/);
  });

  it("qualifies the active-dose predicate when an alias is in scope", () => {
    expect(activeDoseSql("postgres")).toBe("undone = FALSE");
    expect(activeDoseSql("sqlite")).toBe("undone = 0");
    expect(activeDoseSql("postgres", "d")).toBe("d.undone = FALSE");
    expect(activeDoseSql("sqlite", "d")).toBe("d.undone = 0");
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
      transaction: async (fn) => fn(db),
      batch: async () => [],
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
    const sqlite = schemaFor("sqlite").join("\n");
    const pg = schemaFor("postgres").join("\n");
    expect(sqlite).toMatch(/password_hash TEXT,/);
    expect(sqlite).not.toMatch(/password_hash TEXT NOT NULL/);
    expect(pg).toMatch(/password_hash text,/);
    expect(pg).not.toMatch(/password_hash text NOT NULL/);
    expect(pg).toMatch(/ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL/);
    expect(sqlite).toMatch(/email TEXT UNIQUE/);
    expect(sqlite).not.toMatch(/email TEXT NOT NULL/);
    expect(pg).toMatch(/email text UNIQUE/);
    expect(pg).not.toMatch(/email text NOT NULL UNIQUE/);
    expect(pg).toMatch(/ALTER TABLE users ALTER COLUMN email DROP NOT NULL/);
    expect(sqlite).toMatch(/CREATE TABLE IF NOT EXISTS identities/);
    expect(pg).toMatch(/CREATE TABLE IF NOT EXISTS identities/);
    expect(sqlite).toMatch(/webauthn_credentials/);
    expect(pg).toMatch(/webauthn_credentials/);
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
    expect(css).toMatch(/--glass-inset/);
    expect(css).toMatch(/--spring/);
    expect(css).toMatch(/\.is-pressing/);
    const main = readFileSync("src/main.tsx", "utf8");
    expect(main).toMatch(/bindHaptics/);
    expect(readFileSync("src/lib/haptics.ts", "utf8")).toMatch(/HAPTIC_TOGGLE_MS/);
    expect(css).toMatch(/--ring/);
    expect(css).toMatch(/--primary-fg/);
    expect(css).toMatch(/#1414181a/);
    expect(css).not.toMatch(/\.page\s*\{[^}]*padding:\s*88px 16px 168px/);
    expect(css).toMatch(/\.helix-main/);
  });

  it("keeps a designed boot screen on first paint and while session is pending", () => {
    const html = readFileSync("index.html", "utf8");
    const app = readFileSync("src/App.tsx", "utf8");
    const boot = readFileSync("src/components/BootScreen.tsx", "utf8");
    const css = readFileSync("src/styles.css", "utf8");
    expect(html).toMatch(/class="boot"/);
    expect(html).toMatch(/href="\/src\/styles\.css"/);
    expect(app).toMatch(/<BootScreen\s*\/>/);
    expect(app).not.toMatch(/<p className="muted">Helix<\/p>/);
    expect(boot).toMatch(/aria-label="Loading Helix"/);
    expect(boot).toMatch(/calibrating/);
    expect(css).toMatch(/\.boot-helix/);
    expect(css).toMatch(/--boot-accent/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("shows peptide color dots on Calendar and opens the day for names", () => {
    const cal = readFileSync("src/pages/Calendar.tsx", "utf8");
    const css = readFileSync("src/styles.css", "utf8");
    expect(cal).toMatch(/dosesByDay/);
    expect(cal).toMatch(/cal-dots/);
    expect(cal).toMatch(/row\.name/);
    expect(cal).toMatch(/No peptides logged/);
    expect(cal).toMatch(/setOpenOn/);
    expect(css).toMatch(/\.cal-dots i/);
    expect(css).not.toMatch(/\.cal \.dot \{ box-shadow: inset 0 -3px 0 var\(--accent\)/);
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
    expect(today).toMatch(/Import Whoop, Garmin, or Apple Health/);
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
    expect(vitals).toMatch(/function WeightLine/);
    expect(vitals).toMatch(/from \{formatWeight\(start\.kg/);
    expect(vitals).toMatch(/Drag the line to read a day/);
    expect(shell).toMatch(/helix-main/);
    expect(shell).toMatch(/vial-runway/);
    expect(shell).toMatch(/peptide-swatch/);
    expect(today).not.toMatch(/sleepPerf/);
    expect(vitals).not.toMatch(/sleepPerf/);
    expect(you).not.toMatch(/sleepPerf/);
  });
});

describe("auth page lock", () => {
  it("locks login chrome copy and order", () => {
    const text = readFileSync("src/pages/Auth.tsx", "utf8");
    expect(text).toContain("Sign in with Face ID");
    expect(text).toContain("Sign in with passkey");
    expect(text).toContain("Continue with Google");
    expect(text).toContain("Continue with X");
    expect(text).toMatch(/className="auth-or">or</);
    expect(text).toContain("Forgot password?");
    expect(text).toContain("Reset your password");
    expect(text).toContain("Send reset link");
    expect(text).toContain("Back to log in");
    expect(text).toContain("If that email has a Helix password, we sent a link");
    expect(text).toContain("Save a passkey for next time");
    expect(text).toContain("Save Face ID for next time");
    expect(text).toContain("isUserVerifyingPlatformAuthenticatorAvailable");
    const google = text.indexOf("Continue with Google");
    const x = text.indexOf("Continue with X");
    const or = text.indexOf(">or<");
    const forgot = text.indexOf("Forgot password?");
    expect(google).toBeGreaterThan(0);
    expect(x).toBeGreaterThan(google);
    expect(or).toBeGreaterThan(x);
    expect(forgot).toBeGreaterThan(or);
    expect(text).not.toMatch(/Apple/);
    expect(text).not.toMatch(/WebAuthn/);
    expect(text).not.toMatch(/Twitter/);
  });

  it("keeps the You Face ID overlay as a client lock", () => {
    const chrome = readFileSync("src/lib/chrome.ts", "utf8");
    const app = readFileSync("src/App.tsx", "utf8");
    const you = readFileSync("src/pages/Account.tsx", "utf8");
    expect(chrome).toContain("registerFaceId");
    expect(chrome).toContain("unlockFaceId");
    expect(chrome).toContain("helix:faceId:");
    expect(app).toContain("LockScreen");
    expect(app).toContain("unlockFaceId");
    expect(you).toContain("registerFaceId");
    expect(you).toContain("<strong>Face ID</strong>");
    expect(you).toContain("Unlock this device with Face ID");
    expect(you).toContain("Register this device");
    expect(you).toContain("Not available on this device");
    expect(you).toContain('user.email ?? user.displayName ?? "Signed in with X"');
    expect(you).not.toContain("passkeyOptions");
    expect(app).toMatch(/client[\s\S]*\.me\(\)/);
    expect(app).toContain("setUser(r.user)");
  });

  it("does not require OAuth-only accounts to set a password on Auth or You", () => {
    const auth = readFileSync("src/pages/Auth.tsx", "utf8");
    const you = readFileSync("src/pages/Account.tsx", "utf8");
    expect(you).not.toMatch(/[Pp]assword/);
    expect(auth).not.toMatch(/Set a password|Create a password|Add a password|Choose a password/);
  });
});

describe("auth backend", () => {
  it("returns the same generic forgot payload and does not enumerate", async () => {
    const db = await createSqliteDb(":memory:");
    await migrate(db);
    const app = createApp(db);
    const cookie = await signup(app);
    const missing = await app.request("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com" }),
    });
    const existing = await app.request("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ email: "evan@example.com" }),
    });
    expect(missing.status).toBe(200);
    expect(existing.status).toBe(200);
    expect(await missing.json()).toEqual({ ok: true });
    expect(await existing.json()).toEqual({ ok: true });
    const tokens = await db.all("SELECT id FROM password_resets");
    expect(tokens).toEqual([]);
  });

  it("does not store a reset token when mailer env is set but send does not exist", async () => {
    const prevFrom = process.env.MAIL_FROM;
    const prevKey = process.env.RESEND_API_KEY;
    process.env.MAIL_FROM = "helix@example.com";
    process.env.RESEND_API_KEY = "re_test";
    try {
      const db = await createSqliteDb(":memory:");
      await migrate(db);
      const app = createApp(db);
      await signup(app);
      const res = await app.request("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "evan@example.com" }),
      });
      expect(res.status).toBe(200);
      expect(await db.all("SELECT id FROM password_resets")).toEqual([]);
    } finally {
      if (prevFrom === undefined) delete process.env.MAIL_FROM;
      else process.env.MAIL_FROM = prevFrom;
      if (prevKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevKey;
    }
  });

  it("rejects empty and synthetic oauth emails on signup, login, and forgot", async () => {
    const app = await testApp();
    const signupBad = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x-9@oauth.invalid", password: "password12" }),
    });
    const loginBad = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x-9@oauth.invalid", password: "password12" }),
    });
    const forgotBad = await app.request("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x-9@oauth.invalid" }),
    });
    expect(signupBad.status).toBe(400);
    expect(loginBad.status).toBe(400);
    expect(forgotBad.status).toBe(400);
  });

  it("401s OAuth-only users with the same password error and does not throw", async () => {
    const db = await createSqliteDb(":memory:");
    await migrate(db);
    const app = createApp(db);
    await db.run(
      "INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["u1", "oauth@example.com", null, null, "{}", new Date().toISOString()],
    );
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "oauth@example.com", password: "password12" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Email or password is wrong." });
  });

  it("lets an OAuth-only user use a session without setting a password", async () => {
    const db = await createSqliteDb(":memory:");
    await migrate(db);
    const app = createApp(db);
    const linked = await linkOrCreateOAuthUser(db, {
      provider: "google",
      providerUserId: "g-you",
      email: "oauth-you@example.com",
      emailVerified: true,
      displayName: null,
    });
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    expect(linked.user.password_hash).toBeNull();
    await db.run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [
      "sess-oauth",
      linked.user.id,
      new Date(Date.now() + 86400000).toISOString(),
    ]);
    const headers = { Cookie: "helix_session=sess-oauth", "Content-Type": "application/json" };
    const me = await app.request("/api/me", { headers });
    expect(me.status).toBe(200);
    const patch = await app.request("/api/me", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ settings: { faceId: true } }),
    });
    expect(patch.status).toBe(200);
    const body = (await patch.json()) as { user: { settings: { faceId: boolean } } };
    expect(body.user.settings.faceId).toBe(true);
  });

  it("fail-closes Google and X start when env is missing", async () => {
    const app = await testApp();
    const google = await app.request("/api/auth/google");
    const x = await app.request("/api/auth/x");
    expect(google.status).toBe(302);
    expect(x.status).toBe(302);
    expect(new URL(google.headers.get("location") ?? "").searchParams.get("auth_error")).toBe(
      "Google sign-in isn't configured.",
    );
    expect(new URL(x.headers.get("location") ?? "").searchParams.get("auth_error")).toBe(
      "X sign-in isn't configured.",
    );
  });

  it("starts Google authorize when env is set", async () => {
    const prevId = process.env.GOOGLE_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_CLIENT_SECRET;
    const prevOrigin = process.env.APP_ORIGIN;
    process.env.GOOGLE_CLIENT_ID = "id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.APP_ORIGIN = "https://helix-green-one.vercel.app";
    try {
      const app = await testApp();
      const res = await app.request("/api/auth/google");
      expect(res.status).toBe(302);
      const loc = res.headers.get("location") ?? "";
      expect(loc).toMatch(/accounts\.google\.com/);
      expect(loc).toContain("helix-green-one.vercel.app%2Fapi%2Fauth%2Fgoogle%2Fcallback");
    } finally {
      if (prevId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = prevId;
      if (prevSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = prevSecret;
      if (prevOrigin === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = prevOrigin;
    }
  });

  it("omits localhost origins when the WebAuthn RP ID is prod", () => {
    const prev = process.env.WEBAUTHN_RP_ID;
    process.env.WEBAUTHN_RP_ID = "helix-green-one.vercel.app";
    try {
      const origins = webauthnOrigins();
      expect(origins).toEqual(["https://helix-green-one.vercel.app"]);
    } finally {
      if (prev === undefined) delete process.env.WEBAUTHN_RP_ID;
      else process.env.WEBAUTHN_RP_ID = prev;
    }
  });

  it("rebuilds sqlite users inside a transaction", () => {
    const text = readFileSync("server/db.ts", "utf8");
    expect(text).toMatch(/await db.exec\("BEGIN"\)/);
    expect(text).toMatch(/await db.exec\("COMMIT"\)/);
    expect(text).toMatch(/ROLLBACK/);
  });

  it("pins arctic exactly and keeps UserPublic.email nullable", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: { arctic: string } };
    expect(pkg.dependencies.arctic).toBe("3.7.0");
    expect(readFileSync("shared/types.ts", "utf8")).toMatch(/email: string \| null/);
    const webauthn = readFileSync("server/routes/auth-webauthn.ts", "utf8");
    expect(webauthn).toContain("parseRegistrationResponse(rawResponse)");
    expect(webauthn).toContain("parseAuthenticationResponse(rawResponse)");
    const verifyBlock = webauthn.slice(webauthn.indexOf("verifyRegistrationResponse"));
    expect(verifyBlock).not.toMatch(/response:\s*rawResponse\s+as /);
  });
});
