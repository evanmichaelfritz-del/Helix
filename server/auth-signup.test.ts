import { afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { verifyPassword } from "./auth.js";
import { createApp } from "./app.js";
import { createSqliteDb, migrate } from "./db.js";

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
    expect(await db.all("SELECT id FROM sessions")).toEqual([]);
  });
});
