import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { AppContext, UserRow } from "./context.js";
import { toPublicUser } from "./context.js";
import type { Database } from "./db.js";

const COOKIE = "helix_session";
const SESSION_DAYS = 30;
const STORED_TOKEN_PREFIX = "sha256:";

/** SHA-256 of a bearer token. The prefix keeps a hashed row distinct from a legacy raw token. */
export function hashToken(token: string): string {
  return STORED_TOKEN_PREFIX + createHash("sha256").update(token).digest("hex");
}

export function tokenDigestEqual(stored: string, computed: string): boolean {
  const left = Buffer.from(stored);
  const right = Buffer.from(computed);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Sessions are hashed in place so the cookie, which still holds the raw token, keeps working.
 * Outstanding password-reset tokens are deleted: they are short-lived, nothing emails them
 * (`sendPasswordReset` returns false), and a raw reset token must not stay usable.
 */
export async function migrateAuthTokens(db: Database): Promise<void> {
  const sessions = await db.all<{ id: string }>("SELECT id FROM sessions WHERE id NOT LIKE 'sha256:%'");
  // Same JS hash on SQLite and Neon. One SQL sha256() is not available on SQLite.
  if (sessions.length > 0) {
    await db.batch(
      sessions.map((row) => ({
        sql: "UPDATE sessions SET id = ? WHERE id = ?",
        params: [hashToken(row.id), row.id],
      })),
    );
  }
  await db.run("DELETE FROM password_resets WHERE id NOT LIKE 'sha256:%'");
}

export function newId(): string {
  return randomUUID();
}

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (process.env.VERCEL && (!secret || secret === "dev-only-change-me")) {
    throw new Error("SESSION_SECRET must be set to a random value on Vercel.");
  }
  return secret && secret.length > 0 ? secret : "dev-only-change-me";
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(c: AppContext, userId: string): Promise<void> {
  sessionSecret();
  const db = c.get("db");
  const id = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [
    hashToken(id),
    userId,
    expires,
  ]);
  setCookie(c, COOKIE, id, {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: Boolean(process.env.VERCEL),
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function loadUser(c: AppContext): Promise<UserRow | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const db = c.get("db");
  const digest = hashToken(token);
  const row = await db.get<UserRow & { session_id: string }>(
    `SELECT s.id AS session_id, u.id, u.email, u.password_hash, u.display_name, u.settings, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
    [digest, new Date().toISOString()],
  );
  if (!row || !tokenDigestEqual(row.session_id, digest)) return null;
  return {
    id: row.id,
    email: row.email,
    password_hash: row.password_hash,
    display_name: row.display_name,
    settings: row.settings,
    created_at: row.created_at,
  };
}

export async function destroySession(c: AppContext): Promise<void> {
  const token = getCookie(c, COOKIE);
  const db = c.get("db");
  if (token) {
    await db.run("DELETE FROM sessions WHERE id = ?", [hashToken(token)]);
  }
  deleteCookie(c, COOKIE, { path: "/" });
}

export function requireUser(c: AppContext): UserRow {
  const user = c.get("user");
  if (!user) throw new HTTPException(401, { message: "unauthorized" });
  return user;
}

export function publicMe(c: AppContext) {
  const user = requireUser(c);
  return c.json({ user: toPublicUser(user) });
}
