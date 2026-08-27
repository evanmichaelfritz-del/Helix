import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createSession, destroySession, hashPassword, newId, requireUser, verifyPassword } from "../auth.js";
import { toPublicUser, type Env, type UserRow } from "../context.js";
import { insertIdentity } from "../oauth-user.js";
import { mailerConfigured } from "../origin.js";
import { DEFAULT_SETTINGS } from "../../shared/types.js";

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const passwordSchema = z.string().min(8).max(200);
const USER_COLS = "id, email, password_hash, display_name, settings, created_at";

export const authRoutes = new Hono<Env>();

authRoutes.post(
  "/signup",
  zValidator(
    "json",
    z.object({
      email: emailSchema,
      password: passwordSchema,
    }),
  ),
  async (c) => {
    const { email, password } = c.req.valid("json");
    const db = c.get("db");
    const existing = await db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]);
    if (existing) return c.json({ error: "An account with that email already exists." }, 409);
    const user: UserRow = {
      id: newId(),
      email,
      password_hash: await hashPassword(password),
      display_name: null,
      settings: JSON.stringify(DEFAULT_SETTINGS),
      created_at: new Date().toISOString(),
    };
    await db.run(
      "INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [user.id, user.email, user.password_hash, user.display_name, user.settings, user.created_at],
    );
    await insertIdentity(db, user.id, "password", user.id);
    await createSession(c, user.id);
    return c.json({ user: toPublicUser(user) }, 201);
  },
);

authRoutes.post(
  "/login",
  zValidator(
    "json",
    z.object({
      email: emailSchema,
      password: z.string().min(1).max(200),
    }),
  ),
  async (c) => {
    const { email, password } = c.req.valid("json");
    const db = c.get("db");
    const user = await db.get<UserRow>(`SELECT ${USER_COLS} FROM users WHERE email = ?`, [email]);
    if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
      return c.json({ error: "Email or password is wrong." }, 401);
    }
    await createSession(c, user.id);
    return c.json({ user: toPublicUser(user) });
  },
);

authRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", (c) => {
  const user = requireUser(c);
  return c.json({ user: toPublicUser(user) });
});

authRoutes.post(
  "/forgot",
  zValidator("json", z.object({ email: emailSchema })),
  async (c) => {
    const { email } = c.req.valid("json");
    const db = c.get("db");
    const user = await db.get<UserRow>(`SELECT ${USER_COLS} FROM users WHERE email = ?`, [email]);
    if (user?.password_hash && mailerConfigured()) {
      const token = newId().replaceAll("-", "") + newId().replaceAll("-", "");
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await db.run("INSERT INTO password_resets (id, user_id, expires_at) VALUES (?, ?, ?)", [
        token,
        user.id,
        expires,
      ]);
      // Fail-closed: a mailer env is required before any send path is added.
    }
    return c.json({ ok: true });
  },
);

authRoutes.post(
  "/reset",
  zValidator(
    "json",
    z.object({
      token: z.string().min(8).max(200),
      password: passwordSchema,
    }),
  ),
  async (c) => {
    const { token, password } = c.req.valid("json");
    const db = c.get("db");
    const row = await db.get<{ id: string; user_id: string }>(
      "SELECT id, user_id FROM password_resets WHERE id = ? AND expires_at > ?",
      [token, new Date().toISOString()],
    );
    if (!row) return c.json({ error: "That reset link is invalid or expired." }, 400);
    const hash = await hashPassword(password);
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, row.user_id]);
    await db.run("DELETE FROM password_resets WHERE id = ?", [row.id]);
    const user = await db.get<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = ?`, [row.user_id]);
    if (!user) return c.json({ error: "That reset link is invalid or expired." }, 400);
    const passwordIdentity = await db.get<{ id: string }>(
      "SELECT id FROM identities WHERE user_id = ? AND provider = ?",
      [user.id, "password"],
    );
    if (!passwordIdentity) await insertIdentity(db, user.id, "password", user.id);
    await createSession(c, user.id);
    return c.json({ user: toPublicUser(user) });
  },
);
