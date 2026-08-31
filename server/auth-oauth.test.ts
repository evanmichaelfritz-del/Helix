import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { decodeIdToken, googleValidate, xValidate } = vi.hoisted(() => ({
  decodeIdToken: vi.fn(),
  googleValidate: vi.fn(),
  xValidate: vi.fn(),
}));

vi.mock("arctic", () => ({
  Google: class {
    createAuthorizationURL() {
      return new URL("https://accounts.google.com/o/oauth2/v2/auth");
    }
    validateAuthorizationCode() {
      return googleValidate();
    }
  },
  Twitter: class {
    createAuthorizationURL() {
      return new URL("https://twitter.com/i/oauth2/authorize");
    }
    validateAuthorizationCode() {
      return xValidate();
    }
  },
  generateState: () => "state-value",
  generateCodeVerifier: () => "verifier-value",
  decodeIdToken,
}));

import { createApp } from "./app.js";
import { createSqliteDb, migrate } from "./db.js";
import { OAUTH_COOKIE, packOAuthCookie, unpackOAuthCookie } from "./routes/auth-oauth.js";

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "X_CLIENT_ID",
  "X_CLIENT_SECRET",
  "APP_ORIGIN",
] as const;

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

async function testApp() {
  const db = await createSqliteDb(":memory:");
  await migrate(db);
  return { app: createApp(db), db };
}

async function signup(app: ReturnType<typeof createApp>, email = "evan@example.com") {
  const res = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password12" }),
  });
  expect(res.status).toBe(201);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

function oauthCookie(provider: "google" | "x", state = "state-value", verifier = "verifier-value") {
  return `${OAUTH_COOKIE}=${packOAuthCookie(provider, state, verifier)}`;
}

function authError(res: Response): string | null {
  const loc = res.headers.get("location");
  if (!loc) return null;
  return new URL(loc).searchParams.get("auth_error");
}

describe("oauth http callbacks", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.GOOGLE_CLIENT_ID = "google-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-secret";
    process.env.X_CLIENT_ID = "x-id";
    process.env.X_CLIENT_SECRET = "x-secret";
    process.env.APP_ORIGIN = "http://localhost:5173";
    decodeIdToken.mockReset();
    googleValidate.mockReset();
    xValidate.mockReset();
    googleValidate.mockResolvedValue({
      idToken: () => "id.token",
      accessToken: () => "g-access",
    });
    xValidate.mockResolvedValue({
      accessToken: () => "x-access",
    });
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const prev = savedEnv[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  });

  it("packs state that contains dots without splitting fields", () => {
    const packed = packOAuthCookie("google", "a.b.c", "ver.ifier");
    expect(unpackOAuthCookie(packed)).toEqual({
      provider: "google",
      state: "a.b.c",
      verifier: "ver.ifier",
    });
  });

  it("fail-closes on a missing oauth cookie", async () => {
    const { app } = await testApp();
    const res = await app.request("/api/auth/google/callback?code=abc&state=state-value");
    expect(res.status).toBe(302);
    expect(authError(res)).toBe("Sign-in expired. Try again.");
  });

  it("fail-closes on a state mismatch", async () => {
    const { app } = await testApp();
    const res = await app.request("/api/auth/google/callback?code=abc&state=state-value", {
      headers: { Cookie: oauthCookie("google", "other-state") },
    });
    expect(res.status).toBe(302);
    expect(authError(res)).toBe("Sign-in expired. Try again.");
    expect(googleValidate).not.toHaveBeenCalled();
  });

  it("links Google when the caller is already logged in", async () => {
    const { app, db } = await testApp();
    const session = await signup(app);
    decodeIdToken.mockReturnValue({
      sub: "g-link",
      email: "evan@example.com",
      email_verified: true,
    });
    const res = await app.request("/api/auth/google/callback?code=abc&state=state-value", {
      headers: { Cookie: `${session}; ${oauthCookie("google")}` },
    });
    expect(res.status).toBe(302);
    expect(authError(res)).toBeNull();
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("unlocked")).toBe("1");
    const row = await db.get<{ user_id: string; provider_user_id: string }>(
      "SELECT user_id, provider_user_id FROM identities WHERE provider = ?",
      ["google"],
    );
    expect(row?.provider_user_id).toBe("g-link");
    const user = await db.get<{ email: string }>("SELECT email FROM users WHERE id = ?", [row?.user_id ?? ""]);
    expect(user?.email).toBe("evan@example.com");
  });

  it("fail-closes anonymous Google when the email is taken", async () => {
    const { app, db } = await testApp();
    await signup(app);
    decodeIdToken.mockReturnValue({
      sub: "g-takeover",
      email: "evan@example.com",
      email_verified: true,
    });
    const res = await app.request("/api/auth/google/callback?code=abc&state=state-value", {
      headers: { Cookie: oauthCookie("google") },
    });
    expect(res.status).toBe(302);
    expect(authError(res)).toBe("Could not finish sign-in.");
    const google = await db.all("SELECT id FROM identities WHERE provider = ?", ["google"]);
    expect(google).toEqual([]);
    const users = await db.all("SELECT id FROM users");
    expect(users).toHaveLength(1);
  });

  it("creates a new Google user when the email is free", async () => {
    const { app, db } = await testApp();
    decodeIdToken.mockReturnValue({
      sub: "g-new",
      email: "fresh@example.com",
      email_verified: true,
    });
    const res = await app.request("/api/auth/google/callback?code=abc&state=state-value", {
      headers: { Cookie: oauthCookie("google") },
    });
    expect(res.status).toBe(302);
    expect(authError(res)).toBeNull();
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.searchParams.get("new")).toBe("1");
    expect(loc.searchParams.get("unlocked")).toBe("1");
    const user = await db.get<{ email: string | null; password_hash: string | null }>(
      "SELECT email, password_hash FROM users WHERE email = ?",
      ["fresh@example.com"],
    );
    expect(user?.password_hash).toBeNull();
  });

  it("does not merge X or mint a synthetic email", async () => {
    const { app, db } = await testApp();
    await signup(app);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "x-9", name: "Evan", username: "evan" } }), { status: 200 }),
    );
    try {
      const res = await app.request("/api/auth/x/callback?code=abc&state=state-value", {
        headers: { Cookie: oauthCookie("x") },
      });
      expect(res.status).toBe(302);
      expect(authError(res)).toBeNull();
      const users = await db.all<{ id: string; email: string | null }>("SELECT id, email FROM users");
      expect(users).toHaveLength(2);
      const xUser = users.find((row) => row.email === null);
      expect(xUser).toBeTruthy();
      expect(JSON.stringify(users)).not.toMatch(/oauth\.invalid/);
      const ident = await db.get<{ provider_user_id: string }>(
        "SELECT provider_user_id FROM identities WHERE provider = ?",
        ["x"],
      );
      expect(ident?.provider_user_id).toBe("x-9");
    } finally {
      fetchMock.mockRestore();
    }
  });
});
