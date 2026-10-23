import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createSqliteDb, migrate } from "./db.js";
import { AUTH_RATE_LIMIT, clientIp } from "./rate-limit.js";
import { schemaFor } from "./schema.js";

async function testApp() {
  const db = await createSqliteDb(":memory:");
  await migrate(db);
  return createApp(db);
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { "content-type": "application/json", ...extra };
}

function login(app: ReturnType<typeof createApp>, extra: Record<string, string> = {}) {
  return app.request("/api/auth/login", {
    method: "POST",
    headers: headers(extra),
    body: JSON.stringify({ email: "nobody@example.com", password: "password12" }),
  });
}

function passkeyOptions(app: ReturnType<typeof createApp>, extra: Record<string, string> = {}) {
  return app.request("/api/auth/passkey/options", {
    method: "POST",
    headers: headers(extra),
    body: JSON.stringify({ kind: "authenticate" }),
  });
}

async function withClock(start: number, fn: (advance: (ms: number) => void) => Promise<void>) {
  let now = start;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
  try {
    await fn((ms) => {
      now += ms;
    });
  } finally {
    spy.mockRestore();
  }
}

const windowStart = Math.ceil(1_700_000_000_000 / AUTH_RATE_LIMIT.windowMs) * AUTH_RATE_LIMIT.windowMs;

describe("clientIp", () => {
  function read(headers: Record<string, string | undefined>) {
    return clientIp((name) => headers[name.toLowerCase()]);
  }

  it("uses the first x-forwarded-for hop and ignores later hops and other headers", () => {
    expect(read({ "x-forwarded-for": "203.0.113.10, 198.51.100.20" })).toBe("203.0.113.10");
    expect(read({ "x-forwarded-for": " 010.0.0.8 , 198.51.100.20", "x-real-ip": "198.51.100.77" })).toBe("10.0.0.8");
    expect(read({ "x-forwarded-for": "2001:DB8::1" })).toBe("2001:db8::1");
    expect(read({ "x-forwarded-for": "nope, 203.0.113.10", "x-real-ip": "198.51.100.5" })).toBe("198.51.100.5");
    expect(read({ "x-real-ip": "198.51.100.4" })).toBe("198.51.100.4");
    expect(read({ "x-client-ip": "203.0.113.10", "cf-connecting-ip": "198.51.100.8" })).toBe("unknown");
    expect(read({})).toBe("unknown");
  });
});

describe("auth rate limit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the counter table in both schemas", () => {
    expect(schemaFor("sqlite").join("\n")).toMatch(/CREATE TABLE IF NOT EXISTS auth_rate_limits/);
    expect(schemaFor("postgres").join("\n")).toMatch(/window_start bigint NOT NULL/);
  });

  it("allows auth POSTs under the per-IP limit without changing their results", async () => {
    const app = await testApp();
    await withClock(windowStart, async () => {
      const signup = await app.request("/api/auth/signup", {
        method: "POST",
        headers: headers({ "x-forwarded-for": "203.0.113.1" }),
        body: JSON.stringify({ email: "evan@example.com", password: "password12" }),
      });
      expect(signup.status).toBe(201);
      const badLogin = await login(app, { "x-forwarded-for": "203.0.113.1" });
      expect(badLogin.status).toBe(401);
      expect(await badLogin.json()).toEqual({ error: "Email or password is wrong." });
      const options = await passkeyOptions(app, { "x-forwarded-for": "203.0.113.1" });
      expect(options.status).toBe(200);
      for (let i = 0; i < AUTH_RATE_LIMIT.limit - 3; i++) {
        expect((await login(app, { "x-forwarded-for": "203.0.113.1" })).status).toBe(401);
      }
    });
  });

  it("returns 429 with Retry-After over the limit and allows again when the window resets", async () => {
    const app = await testApp();
    const ip = { "x-forwarded-for": "203.0.113.50" };
    await withClock(windowStart, async (advance) => {
      for (let i = 0; i < AUTH_RATE_LIMIT.limit; i++) {
        expect((await login(app, ip)).status).toBe(401);
      }
      const blocked = await passkeyOptions(app, ip);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBe(String(AUTH_RATE_LIMIT.windowMs / 1000));
      expect(await blocked.json()).toEqual({ error: AUTH_RATE_LIMIT.error });
      expect(blocked.headers.get("set-cookie")).toBeNull();

      advance(45_000);
      const stillBlocked = await login(app, ip);
      expect(stillBlocked.status).toBe(429);
      expect(stillBlocked.headers.get("retry-after")).toBe("15");

      const google = await app.request("/api/auth/google", { headers: ip });
      expect(google.status).toBe(302);

      advance(15_000);
      expect((await login(app, ip)).status).toBe(401);
      expect((await passkeyOptions(app, ip)).status).toBe(200);
    });
  });

  it("counts only the x-forwarded-for first hop, then x-real-ip", async () => {
    const app = await testApp();
    const first = { "x-forwarded-for": "203.0.113.10, 198.51.100.20", "x-real-ip": "198.51.100.77" };
    await withClock(windowStart, async () => {
      for (let i = 0; i < AUTH_RATE_LIMIT.limit; i++) {
        expect((await login(app, first)).status).toBe(401);
      }
      expect((await login(app, { "x-forwarded-for": "203.0.113.10, 203.0.113.99" })).status).toBe(429);
      expect((await login(app, { "x-forwarded-for": "198.51.100.20" })).status).toBe(401);
      expect((await login(app, { "x-real-ip": "198.51.100.77" })).status).toBe(401);
      expect((await login(app, { "x-client-ip": "203.0.113.10", "cf-connecting-ip": "203.0.113.10" })).status).toBe(401);
      for (let i = 0; i < AUTH_RATE_LIMIT.limit - 1; i++) {
        expect((await login(app, { "x-client-ip": "1.2.3.4" })).status).toBe(401);
      }
      expect((await login(app)).status).toBe(429);
    });
  });
});
