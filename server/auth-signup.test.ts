import { afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { LOGIN_DUMMY_PASSWORD_HASH, verifyPassword } from "./auth.js";
import { createApp } from "./app.js";
import { createSqliteDb, migrate, type Database, type SqlValue } from "./db.js";

const email = "evan@example.com";
const password = "password12";
const otherPassword = "different1";

async function testApp() {
  const db = await createSqliteDb(":memory:");
  await migrate(db);
  return { app: createApp(db), db };
}

function headers(ip: string): Record<string, string> {
  return { "Content-Type": "application/json", "x-forwarded-for": ip };
}

function headerMap(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function toPg(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

async function createPgliteDb(): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  await pg.waitReady;
  const db: Database = {
    dialect: "postgres",
    async all<T>(query: string, params: SqlValue[] = []) {
      const result = await pg.query<T>(toPg(query), params);
      return result.rows;
    },
    async get<T>(query: string, params: SqlValue[] = []) {
      const result = await pg.query<T>(toPg(query), params);
      return result.rows[0];
    },
    async run(query: string, params: SqlValue[] = []) {
      await pg.query(toPg(query), params);
      return { changes: 0 };
    },
    async exec(statement: string) {
      await pg.exec(statement);
    },
    async transaction() {
      throw new Error("unused");
    },
    async batch(statements) {
      if (statements.length === 0) return [];
      return pg.transaction(async (tx) => {
        const results: unknown[][] = [];
        for (const item of statements) {
          const result = await tx.query(toPg(item.sql), item.params ?? []);
          results.push(result.rows);
        }
        return results;
      });
    },
  };
  return db;
}

async function openDb(dialect: "sqlite" | "postgres"): Promise<Database> {
  const db = dialect === "sqlite" ? await createSqliteDb(":memory:") : await createPgliteDb();
  await migrate(db);
  return db;
}

const EMAIL_VARIANTS = [
  "evan@example.com",
  " Evan@Example.com ",
  "EVAN@EXAMPLE.COM",
  "  evan@example.com",
  "evan@example.com  ",
  "Evan@example.com",
  "evan@EXAMPLE.com",
  " eVaN@eXaMpLe.CoM ",
  "evan@example.com",
  "EVAN@example.com",
];

async function parallelSignups(
  app: ReturnType<typeof createApp>,
  variants: string[],
  passwordFor: (index: number) => string,
  ipPrefix: string,
) {
  const responses = await Promise.all(
    variants.map((address, index) =>
      app.request("/api/auth/signup", {
        method: "POST",
        headers: headers(`${ipPrefix}.${index + 1}`),
        body: JSON.stringify({ email: address, password: passwordFor(index) }),
      }),
    ),
  );
  const bodies = await Promise.all(responses.map(async (res) => ({ status: res.status, body: await res.json(), cookie: res.headers.get("set-cookie") })));
  return bodies;
}

describe("signup does not reveal an existing email", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the same response for a new email and an existing one, and leaves the account alone", async () => {
    const { app, db } = await testApp();
    const ip = headers("203.0.113.80");
    const hash = vi.spyOn(bcrypt, "hash");

    const createdStarted = performance.now();
    const created = await app.request("/api/auth/signup", {
      method: "POST",
      headers: ip,
      body: JSON.stringify({ email, password }),
    });
    const createdMs = performance.now() - createdStarted;

    const stored = await db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = ?", [
      email,
    ]);
    expect(stored?.password_hash).toBeTruthy();

    const existingStarted = performance.now();
    const existing = await app.request("/api/auth/signup", {
      method: "POST",
      headers: ip,
      body: JSON.stringify({ email, password: otherPassword }),
    });
    const existingMs = performance.now() - existingStarted;

    expect(created.status).toBe(201);
    expect(existing.status).toBe(created.status);
    expect(await created.json()).toEqual({ ok: true });
    expect(await existing.json()).toEqual({ ok: true });
    expect(headerMap(created)).toEqual(headerMap(existing));
    expect(created.headers.get("set-cookie")).toBeNull();
    expect(existing.headers.get("set-cookie")).toBeNull();

    expect(hash).toHaveBeenCalledTimes(2);
    expect(hash).toHaveBeenNthCalledWith(1, password, 10);
    expect(hash).toHaveBeenNthCalledWith(2, otherPassword, 10);
    expect(createdMs).toBeGreaterThan(15);
    expect(existingMs).toBeGreaterThan(15);
    expect(Math.abs(createdMs - existingMs)).toBeLessThan(500);

    const after = await db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = ?", [email]);
    expect(after?.password_hash).toBe(stored?.password_hash);
    expect(await verifyPassword(password, after?.password_hash ?? "")).toBe(true);
    expect(await verifyPassword(otherPassword, after?.password_hash ?? "")).toBe(false);
    expect(await db.all("SELECT id FROM users")).toHaveLength(1);
    expect(await db.all("SELECT id FROM sessions")).toEqual([]);

    const wrong = await app.request("/api/auth/login", {
      method: "POST",
      headers: ip,
      body: JSON.stringify({ email, password: otherPassword }),
    });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();

    const right = await app.request("/api/auth/login", {
      method: "POST",
      headers: ip,
      body: JSON.stringify({ email, password }),
    });
    expect(right.status).toBe(200);
    expect(right.headers.get("set-cookie")).toMatch(/helix_session=/);
    const sessions = await db.all("SELECT id FROM sessions");
    expect(sessions).toHaveLength(1);
  });

  it("does not set a password on an oauth account that already has the email", async () => {
    const { app, db } = await testApp();
    await db.run(
      "INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["oauth-user", email, null, null, "{}", new Date().toISOString()],
    );
    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: headers("203.0.113.81"),
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toBeNull();
    const row = await db.get<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id = ?", [
      "oauth-user",
    ]);
    expect(row?.password_hash).toBeNull();
    expect(await db.all("SELECT id FROM identities")).toEqual([]);
    expect(await db.all("SELECT id FROM sessions")).toEqual([]);
  });

  it.each(["sqlite", "postgres"] as const)(
    "keeps one user when %s signups of a new email race, including case and whitespace",
    async (dialect) => {
      const db = await openDb(dialect);
      const app = createApp(db);
      const bodies = await parallelSignups(app, EMAIL_VARIANTS, () => password, "203.0.113");
      expect(bodies.map((item) => item.status)).toEqual(EMAIL_VARIANTS.map(() => 201));
      expect(bodies.every((item) => JSON.stringify(item.body) === JSON.stringify({ ok: true }))).toBe(true);
      expect(bodies.every((item) => item.cookie === null)).toBe(true);

      const users = await db.all<{ id: string; email: string }>("SELECT id, email FROM users");
      expect(users).toEqual([{ id: users[0]?.id, email }]);
      const identities = await db.all<{ user_id: string; provider: string }>(
        "SELECT user_id, provider FROM identities",
      );
      expect(identities).toEqual([{ user_id: users[0]?.id, provider: "password" }]);
      expect(await db.all("SELECT id FROM sessions")).toEqual([]);
    },
  );

  it.each(["sqlite", "postgres"] as const)(
    "does not attach a second identity when %s signups race an existing email",
    async (dialect) => {
      const db = await openDb(dialect);
      const app = createApp(db);
      const first = await app.request("/api/auth/signup", {
        method: "POST",
        headers: headers("198.51.100.1"),
        body: JSON.stringify({ email, password }),
      });
      expect(first.status).toBe(201);
      const before = await db.get<{ id: string; password_hash: string }>(
        "SELECT id, password_hash FROM users WHERE email = ?",
        [email],
      );

      const bodies = await parallelSignups(
        app,
        EMAIL_VARIANTS,
        (index) => `otherpass${index}!`,
        "198.51.100",
      );
      expect(bodies.every((item) => item.status === 201)).toBe(true);
      expect(bodies.every((item) => JSON.stringify(item.body) === JSON.stringify({ ok: true }))).toBe(true);
      expect(bodies.every((item) => item.cookie === null)).toBe(true);

      const users = await db.all<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users");
      expect(users).toEqual([{ id: before?.id, password_hash: before?.password_hash }]);
      expect(await verifyPassword(password, users[0]?.password_hash ?? "")).toBe(true);
      const identities = await db.all<{ user_id: string }>("SELECT user_id FROM identities");
      expect(identities).toEqual([{ user_id: before?.id }]);
      expect(await db.all("SELECT id FROM sessions")).toEqual([]);
    },
  );

  it("rejects a weak password and a malformed email without looking at the account", async () => {
    const { app } = await testApp();
    await app.request("/api/auth/signup", {
      method: "POST",
      headers: headers("203.0.113.70"),
      body: JSON.stringify({ email, password }),
    });
    const shortExisting = await app.request("/api/auth/signup", {
      method: "POST",
      headers: headers("203.0.113.71"),
      body: JSON.stringify({ email, password: "short" }),
    });
    const shortNew = await app.request("/api/auth/signup", {
      method: "POST",
      headers: headers("203.0.113.72"),
      body: JSON.stringify({ email: "other@example.com", password: "short" }),
    });
    expect(shortExisting.status).toBe(400);
    expect(await shortExisting.json()).toEqual(await shortNew.json());

    const badExistingApp = await app.request("/api/auth/signup", {
      method: "POST",
      headers: headers("203.0.113.73"),
      body: JSON.stringify({ email: "not-an-email", password }),
    });
    const badAgain = await app.request("/api/auth/signup", {
      method: "POST",
      headers: headers("203.0.113.74"),
      body: JSON.stringify({ email: "also bad", password }),
    });
    expect(badExistingApp.status).toBe(400);
    expect(await badExistingApp.json()).toEqual(await badAgain.json());
  });

  it("runs bcrypt.compare for an unknown email, a null hash, and a wrong password", async () => {
    const { app, db } = await testApp();
    await db.run(
      "INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["oauth-user", "oauth@example.com", null, null, "{}", new Date().toISOString()],
    );
    await app.request("/api/auth/signup", {
      method: "POST",
      headers: headers("203.0.113.75"),
      body: JSON.stringify({ email, password }),
    });
    const compare = vi.spyOn(bcrypt, "compare");
    const cases = [
      { email: "missing@example.com", ip: "203.0.113.76" },
      { email: "oauth@example.com", ip: "203.0.113.77" },
      { email, ip: "203.0.113.78" },
    ];
    const timings: number[] = [];
    for (const item of cases) {
      const started = performance.now();
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: headers(item.ip),
        body: JSON.stringify({ email: item.email, password: otherPassword }),
      });
      timings.push(performance.now() - started);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Email or password is wrong." });
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(compare).toHaveBeenCalledTimes(3);
    expect(compare.mock.calls[0]?.[1]).toBe(LOGIN_DUMMY_PASSWORD_HASH);
    expect(compare.mock.calls[1]?.[1]).toBe(LOGIN_DUMMY_PASSWORD_HASH);
    expect(compare.mock.calls[2]?.[1]).not.toBe(LOGIN_DUMMY_PASSWORD_HASH);
    expect(Math.min(...timings)).toBeGreaterThan(15);
    expect(Math.max(...timings) - Math.min(...timings)).toBeLessThan(500);
  });
});
