import { describe, expect, it } from "vitest";
import { hashToken, migrateAuthTokens } from "./auth.js";
import { createApp } from "./app.js";
import { createSqliteDb, migrate } from "./db.js";

const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function testApp() {
  const db = await createSqliteDb(":memory:");
  await migrate(db);
  return { app: createApp(db), db };
}

function cookieOf(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

function rawToken(cookie: string): string {
  return cookie.slice("helix_session=".length);
}

describe("session and reset tokens", () => {
  it("stores a hash of the session token, not the raw cookie", async () => {
    const { app, db } = await testApp();
    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.21" },
      body: JSON.stringify({ email: "evan@example.com", password: "password12" }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await db.all("SELECT id FROM sessions")).toEqual([]);
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.21" },
      body: JSON.stringify({ email: "evan@example.com", password: "password12" }),
    });
    expect(login.status).toBe(200);
    const cookie = cookieOf(login);
    const raw = rawToken(cookie);
    const stored = await db.get<{ id: string }>("SELECT id FROM sessions");
    expect(stored?.id).toBe(hashToken(raw));
    expect(stored?.id).not.toBe(raw);
    expect(stored?.id.startsWith("sha256:")).toBe(true);
    const me = await app.request("/api/me", { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
  });

  it("revokes every existing session when the password is reset", async () => {
    const { app, db } = await testApp();
    const ip = { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.22" };
    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: ip,
      body: JSON.stringify({ email: "evan@example.com", password: "password12" }),
    });
    expect(signup.status).toBe(201);
    const firstLogin = await app.request("/api/auth/login", {
      method: "POST",
      headers: ip,
      body: JSON.stringify({ email: "evan@example.com", password: "password12" }),
    });
    const secondLogin = await app.request("/api/auth/login", {
      method: "POST",
      headers: ip,
      body: JSON.stringify({ email: "evan@example.com", password: "password12" }),
    });
    const first = cookieOf(firstLogin);
    const second = cookieOf(secondLogin);
    expect((await app.request("/api/me", { headers: { Cookie: first } })).status).toBe(200);
    expect((await app.request("/api/me", { headers: { Cookie: second } })).status).toBe(200);

    const token = "reset-token-raw-value";
    const user = await db.get<{ id: string }>("SELECT id FROM users");
    expect(user?.id).toBeTruthy();
    await db.run("INSERT INTO password_resets (id, user_id, expires_at) VALUES (?, ?, ?)", [
      hashToken(token),
      user?.id ?? "",
      future,
    ]);
    await db.run("INSERT INTO password_resets (id, user_id, expires_at) VALUES (?, ?, ?)", [
      hashToken("other-reset-token-value"),
      user?.id ?? "",
      future,
    ]);
    const storedReset = await db.get<{ id: string }>("SELECT id FROM password_resets");
    expect(storedReset?.id).toBe(hashToken(token));
    expect(storedReset?.id).not.toBe(token);

    const reset = await app.request("/api/auth/reset", {
      method: "POST",
      headers: ip,
      body: JSON.stringify({ token, password: "new-password" }),
    });
    expect(reset.status).toBe(200);
    const fresh = cookieOf(reset);
    expect((await app.request("/api/me", { headers: { Cookie: first } })).status).toBe(401);
    expect((await app.request("/api/me", { headers: { Cookie: second } })).status).toBe(401);
    expect((await app.request("/api/me", { headers: { Cookie: fresh } })).status).toBe(200);
    const sessions = await db.all<{ id: string }>("SELECT id FROM sessions");
    expect(sessions).toEqual([{ id: hashToken(rawToken(fresh)) }]);
    expect(await db.all("SELECT id FROM password_resets")).toEqual([]);
    const again = await app.request("/api/auth/login", {
      method: "POST",
      headers: ip,
      body: JSON.stringify({ email: "evan@example.com", password: "new-password" }),
    });
    expect(again.status).toBe(200);
  });

  it("stops accepting a legacy raw reset token and hashes a legacy session in place", async () => {
    const db = await createSqliteDb(":memory:");
    await migrate(db);
    const created = new Date().toISOString();
    await db.run(
      "INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["user-1", "evan@example.com", "hash", null, "{}", created],
    );
    await db.run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [
      "legacy-session-token",
      "user-1",
      future,
    ]);
    await db.run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [
      "legacy-session-token-2",
      "user-1",
      future,
    ]);
    await db.run("INSERT INTO password_resets (id, user_id, expires_at) VALUES (?, ?, ?)", [
      "legacy-reset-token",
      "user-1",
      future,
    ]);
    await migrateAuthTokens(db);

    const sessions = await db.all<{ id: string }>("SELECT id FROM sessions");
    expect(sessions.map((row) => row.id).sort()).toEqual(
      [hashToken("legacy-session-token"), hashToken("legacy-session-token-2")].sort(),
    );
    const session = sessions.find((row) => row.id === hashToken("legacy-session-token"));
    expect(await db.all("SELECT id FROM password_resets")).toEqual([]);

    const app = createApp(db);
    const rawCookie = await app.request("/api/me", { headers: { Cookie: "helix_session=legacy-session-token" } });
    expect(rawCookie.status).toBe(200);
    const storedAsCookie = await app.request("/api/me", {
      headers: { Cookie: `helix_session=${session?.id}` },
    });
    expect(storedAsCookie.status).toBe(401);
    const reset = await app.request("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.23" },
      body: JSON.stringify({ token: "legacy-reset-token", password: "password12" }),
    });
    expect(reset.status).toBe(400);
    expect(await reset.json()).toEqual({ error: "That reset link is invalid or expired." });
  });
});
