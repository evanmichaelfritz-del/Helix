import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { AppContext, UserRow } from "./context.js";
import { toPublicUser } from "./context.js";

const COOKIE = "helix_session";
const SESSION_DAYS = 30;

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
    id,
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
  const row = await db.get<UserRow>(
    `SELECT u.id, u.email, u.password_hash, u.display_name, u.settings, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
    [token, new Date().toISOString()],
  );
  return row ?? null;
}

export async function destroySession(c: AppContext): Promise<void> {
  const token = getCookie(c, COOKIE);
  const db = c.get("db");
  if (token) {
    await db.run("DELETE FROM sessions WHERE id = ?", [token]);
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
