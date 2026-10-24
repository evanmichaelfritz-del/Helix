import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { ZodError } from "zod";
import { parseHelixHelper } from "../shared/import/helix.js";
import { parseImportFile } from "../shared/import/index.js";
import { WHOOP_IMPORT_CAP } from "../shared/import/whoop.js";
import { HELIX_EXPORT_KIND } from "../shared/types.js";
import { API_BODY_MAX_BYTES, createApp } from "./app.js";
import { createSqliteDb, migrate } from "./db.js";
import { peptidePatchSchema } from "./routes/catalog.js";
import { IMPORT_BODY_MAX_BYTES, recordsSchema } from "./routes/import.js";
import { formatZodError } from "./validate.js";

async function testApp() {
  const db = await createSqliteDb(":memory:");
  await migrate(db);
  return { app: createApp(db), db };
}

async function signup(app: ReturnType<typeof createApp>) {
  const headers = { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.50" };
  const res = await app.request("/api/auth/signup", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "evan@example.com", password: "password12" }),
  });
  expect(res.status).toBe(201);
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "evan@example.com", password: "password12" }),
  });
  expect(login.status).toBe(200);
  return (login.headers.get("set-cookie") ?? "").split(";")[0];
}

function addUtcDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

describe("import body limit and schema bounds", () => {
  it("rejects an import larger than 1000000 bytes with 413", async () => {
    const { app } = await testApp();
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
    const { app } = await testApp();
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
    const { app } = await testApp();
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
    const { app } = await testApp();
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
    const longNameBody = await longName.json();
    expect(longNameBody).toEqual({
      error: "vials.0.peptideName: String must contain at most 80 character(s)",
    });

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
            openedOn: "2023-02-29",
          },
        ],
      }),
    });
    expect(badOpened.status).toBe(400);
    expect(await badOpened.json()).toEqual({ error: "vials.0.openedOn: Invalid date" });

    const impossible = await app.request("/api/import/records", {
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
            openedOn: "2024-13-45",
          },
        ],
      }),
    });
    expect(impossible.status).toBe(400);
    expect(await impossible.json()).toEqual({ error: "vials.0.openedOn: Invalid date" });
    expect(
      recordsSchema.safeParse({
        source: "helix",
        healthDays: [],
        workouts: [],
        weighIns: [],
        vials: [
          {
            peptideName: "MOTS-C",
            totalAmount: 10,
            remainingAmount: 10,
            dose: 1,
            openedOn: "2024-02-29",
          },
        ],
      }).success,
    ).toBe(true);

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
    const loggedAtBody = (await badLoggedAt.json()) as { error?: unknown };
    expect(typeof loggedAtBody.error).toBe("string");
    expect(String(loggedAtBody.error).startsWith("doses.0.loggedAt:")).toBe(true);

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
    expect(await tooManyDays.json()).toEqual({
      error: "healthDays: Array must contain at most 400 element(s)",
    });
  });

  it("rejects 333000 empty health days in one issue, well under a second", async () => {
    const { app } = await testApp();
    const cookie = await signup(app);
    const healthDays = `[${new Array(333_000).fill("{}").join(",")}]`;
    const body = `{"source":"whoop","healthDays":${healthDays},"workouts":[],"weighIns":[]}`;
    expect(Buffer.byteLength(body)).toBeLessThan(IMPORT_BODY_MAX_BYTES);

    const parsedStarted = performance.now();
    const parsed = recordsSchema.safeParse(JSON.parse(body));
    const parsedMs = performance.now() - parsedStarted;
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toHaveLength(1);
    expect(parsed.error.issues[0]?.path).toEqual(["healthDays"]);
    expect(parsed.error.issues[0]?.message).toBe("Array must contain at most 400 element(s)");
    expect(parsedMs).toBeLessThan(500);

    const httpStarted = performance.now();
    const res = await app.request("/api/import/records", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body,
    });
    const httpMs = performance.now() - httpStarted;
    expect(res.status).toBe(400);
    expect(httpMs).toBeLessThan(500);
    expect(await res.json()).toEqual({
      error: "healthDays: Array must contain at most 400 element(s)",
    });
  });

  it("normalises offset datetimes and still imports when one helper date is unusable", async () => {
    const { app, db } = await testApp();
    const cookie = await signup(app);
    const parsed = parseHelixHelper(
      JSON.stringify({
        kind: HELIX_EXPORT_KIND,
        peptides: [
          { name: "MOTS-C", unit: "mcg" },
          { name: "Retatrutide", unit: "mg" },
        ],
        vials: [
          {
            peptideName: "MOTS-C",
            totalAmount: 10000,
            remainingAmount: 8500,
            dose: 500,
            openedOn: "2026-08-26T23:00:00-05:00",
          },
          {
            peptideName: "Retatrutide",
            totalAmount: 10,
            remainingAmount: 8,
            dose: 2,
            openedOn: "2023-02-29",
          },
        ],
        doses: [
          {
            peptideName: "MOTS-C",
            amount: 500,
            unit: "mcg",
            loggedOn: "2026-08-30",
            loggedAt: "2026-08-30T12:00:00+05:30",
          },
          {
            peptideName: "Retatrutide",
            amount: 2,
            unit: "mg",
            loggedOn: "2026-08-31",
            loggedAt: "yesterday",
          },
        ],
      }),
    );
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.records.vials.map((vial) => vial.openedOn)).toEqual(["2026-08-26", null]);
    expect(parsed.records.doses.map((dose) => dose.loggedAt)).toEqual(["2026-08-30T06:30:00.000Z", undefined]);

    const res = await app.request("/api/import/records", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(parsed.records),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ peptides: 2, vials: 2, doses: 2 });
    const vials = await db.all<{ peptide_id: string; opened_on: string | null }>(
      "SELECT peptide_id, opened_on FROM vials ORDER BY opened_on IS NULL, opened_on",
    );
    expect(vials.map((row) => row.opened_on)).toEqual(["2026-08-26", null]);
    const logged = await db.get<{ logged_at: string }>(
      "SELECT logged_at FROM doses WHERE logged_on = ?",
      ["2026-08-30"],
    );
    expect(logged?.logged_at).toBe("2026-08-30T06:30:00.000Z");
  });

  it("returns a string zod error that api.ts can show on Account and Vitals", async () => {
    const { app } = await testApp();
    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.77" },
      body: JSON.stringify({ email: "evan@example.com", password: "short" }),
    });
    expect(res.status).toBe(400);
    const data: unknown = await res.json();
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : res.statusText;
    expect(message).toBe("password: String must contain at least 8 character(s)");
    expect(message).not.toBe("Bad Request");
  });

  it("rejects out-of-range offsets and year-9999 overflow, and keeps the written openedOn day", async () => {
    const { app, db } = await testApp();
    const cookie = await signup(app);
    const headers = { Cookie: cookie, "Content-Type": "application/json" };
    const base = {
      source: "helix",
      healthDays: [],
      workouts: [],
      weighIns: [],
      peptides: [{ name: "MOTS-C", unit: "mcg" }],
    };

    for (const loggedAt of ["2026-08-30T12:00:00+99:99", "2026-08-30T12:00:00+24:00", "9999-12-31T23:30:00-04:00"]) {
      const res = await app.request("/api/import/records", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...base,
          doses: [{ peptideName: "MOTS-C", amount: 1, unit: "mcg", loggedOn: "2026-08-30", loggedAt }],
        }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "doses.0.loggedAt: Invalid datetime" });
    }

    const overflowOpened = await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...base,
        vials: [
          {
            peptideName: "MOTS-C",
            totalAmount: 10,
            remainingAmount: 10,
            dose: 1,
            openedOn: "9999-12-31T23:30:00-04:00",
          },
        ],
      }),
    });
    expect(overflowOpened.status).toBe(400);
    expect(await overflowOpened.json()).toEqual({ error: "vials.0.openedOn: Invalid date" });

    const parsed = parseHelixHelper(
      JSON.stringify({
        kind: HELIX_EXPORT_KIND,
        peptides: [
          { name: "MOTS-C", unit: "mcg" },
          { name: "Retatrutide", unit: "mg" },
        ],
        vials: [
          {
            peptideName: "MOTS-C",
            totalAmount: 10,
            remainingAmount: 10,
            dose: 1,
            openedOn: "2024-03-10T23:30:00-04:00",
          },
          {
            peptideName: "Retatrutide",
            totalAmount: 10,
            remainingAmount: 8,
            dose: 2,
            openedOn: "2024-03-10T00:00:00+14:00",
          },
        ],
        doses: [
          {
            peptideName: "MOTS-C",
            amount: 1,
            unit: "mcg",
            loggedOn: "2026-08-30",
            loggedAt: "2026-08-30T12:00:00+23:59",
          },
        ],
      }),
    );
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.records.vials.map((vial) => vial.openedOn)).toEqual(["2024-03-10", "2024-03-10"]);
    expect(parsed.records.doses[0]?.loggedAt).toBe("2026-08-29T12:01:00.000Z");

    const saved = await app.request("/api/import/records", {
      method: "POST",
      headers,
      body: JSON.stringify(parsed.records),
    });
    expect(saved.status).toBe(200);
    const opened = await db.all<{ opened_on: string | null }>("SELECT opened_on FROM vials ORDER BY opened_on");
    expect(opened.map((row) => row.opened_on)).toEqual(["2024-03-10", "2024-03-10"]);
    const logged = await db.get<{ logged_at: string }>("SELECT logged_at FROM doses");
    expect(logged?.logged_at).toBe("2026-08-29T12:01:00.000Z");
  });

  it("truncates a zod enum message that echoes a huge received value", async () => {
    const { app } = await testApp();
    const cookie = await signup(app);
    const received = "x".repeat(2_000);
    const res = await app.request("/api/peptides", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "MOTS-C", unit: received }),
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text.length).toBeLessThan(300);
    expect(text.includes(received.slice(0, 400))).toBe(false);
    const data = JSON.parse(text) as { error?: string };
    expect(data.error?.startsWith("unit: Invalid enum value. Expected 'mcg' | 'mg' | 'IU' | 'mL', received '")).toBe(
      true,
    );
    expect(data.error?.endsWith("…")).toBe(true);
    expect((data.error ?? "").length).toBeLessThan(220);
  });

  it("drops a trailing lone high surrogate when clipping a zod message", () => {
    const message = `${"a".repeat(198)}\uD800${"b".repeat(40)}`;
    const error = new ZodError([{ code: "custom", path: ["unit"], message }]);
    expect(formatZodError(error)).toBe(`unit: ${"a".repeat(198)}…`);
    expect(formatZodError(error).includes("\uD800")).toBe(false);
  });

  it("accepts real peptide schedules and rejects a bad day before storing it", async () => {
    const { app } = await testApp();
    const cookie = await signup(app);
    const headers = { Cookie: cookie, "Content-Type": "application/json" };
    const created = await app.request("/api/peptides", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "MOTS-C", unit: "mcg" }),
    });
    expect(created.status).toBe(201);
    const { peptide } = (await created.json()) as { peptide: { id: string; schedule: { days: number[] } } };

    const accepted: Array<{ days: number[]; stored: number[] }> = [
      { days: [], stored: [0, 1, 2, 3, 4, 5, 6] },
      { days: [0], stored: [0] },
      { days: [1, 3, 5], stored: [1, 3, 5] },
      { days: [0, 1, 2, 3, 4, 5, 6], stored: [0, 1, 2, 3, 4, 5, 6] },
      { days: [0, 0, 1], stored: [0, 1] },
    ];
    for (const schedule of accepted) {
      const res = await app.request(`/api/peptides/${peptide.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ schedule: { days: schedule.days, morning: true, evening: false } }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { peptide: { schedule: { days: number[] } } };
      expect(body.peptide.schedule.days).toEqual(schedule.stored);
    }

    for (const days of [[7], [-1], [1.5], ["a"], [0, 1, 2, 3, 4, 5, 6, 0]]) {
      const res = await app.request(`/api/peptides/${peptide.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ schedule: { days, morning: true, evening: false } }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: unknown };
      expect(typeof body.error).toBe("string");
      expect(String(body.error).startsWith("schedule.days")).toBe(true);
    }
  });

  it("rejects 2.2 million schedule days in one check, without parsing each element", async () => {
    const days = new Array(2_200_000).fill(0);
    const cpu = process.cpuUsage();
    const started = performance.now();
    const parsed = await peptidePatchSchema.safeParseAsync({
      schedule: { days, morning: true, evening: false },
    });
    const elapsed = performance.now() - started;
    const used = process.cpuUsage(cpu);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(formatZodError(parsed.error)).toBe("schedule.days: Array must contain at most 7 element(s)");
    expect(parsed.error.issues).toHaveLength(1);
    expect(elapsed).toBeLessThan(500);
    expect((used.user + used.system) / 1000).toBeLessThan(500);
  });

  it("rejects a 4.4MB peptide patch and a 70KB weigh-in before parsing", async () => {
    const { app } = await testApp();
    const cookie = await signup(app);
    const headers = { Cookie: cookie, "Content-Type": "application/json" };
    const created = await app.request("/api/peptides", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "MOTS-C", unit: "mcg" }),
    });
    expect(created.status).toBe(201);
    const { peptide } = (await created.json()) as { peptide: { id: string } };

    const started = performance.now();
    const huge = await app.request(`/api/peptides/${peptide.id}`, {
      method: "PATCH",
      headers,
      body: "x".repeat(4_400_000),
    });
    const elapsed = performance.now() - started;
    expect(huge.status).toBe(413);
    expect(elapsed).toBeLessThan(500);
    expect(await huge.json()).toEqual({ error: "Request is too large." });

    const weighIn = await app.request("/api/weigh-ins", {
      method: "POST",
      headers,
      body: "y".repeat(70 * 1024),
    });
    expect(weighIn.status).toBe(413);
    const weighBody = (await weighIn.json()) as { error?: unknown };
    expect(weighBody).toEqual({ error: "Request is too large." });
    expect(typeof weighBody.error).toBe("string");
  });

  it("still accepts a 999999 byte import while the 64KB cap covers other routes", async () => {
    const { app } = await testApp();
    const cookie = await signup(app);
    const core = JSON.stringify({ source: "whoop", healthDays: [], workouts: [], weighIns: [] });
    const body = core + " ".repeat(IMPORT_BODY_MAX_BYTES - 1 - Buffer.byteLength(core));
    expect(Buffer.byteLength(body)).toBe(999_999);
    expect(Buffer.byteLength(body)).toBeGreaterThan(API_BODY_MAX_BYTES);

    const res = await app.request("/api/import/records", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ healthDays: 0, workouts: 0, weighIns: 0 });
  });

  it("lets overlapping first requests share one migrate", async () => {
    const db = await createSqliteDb(":memory:");
    const app = createApp(db);
    const [a, b] = await Promise.all([app.request("/api/healthz"), app.request("/api/healthz")]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const tables = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    expect(tables.some((table) => table.name === "users")).toBe(true);
  });
});
