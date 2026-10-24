import { Hono } from "hono";
import { validate as zValidator } from "../validate.js";
import { z } from "zod";
import {
  createSession,
  destroySession,
  hashPassword,
  hashToken,
  LOGIN_DUMMY_PASSWORD_HASH,
  newId,
  requireUser,
  tokenDigestEqual,
  verifyPassword,
} from "../auth.js";
import { toPublicUser, type Env, type UserRow } from "../context.js";
import { insertIdentity } from "../oauth-user.js";
import { mailerConfigured } from "../origin.js";
import { DEFAULT_SETTINGS } from "../../shared/types.js";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(320)
  .refine((value) => value.length > 0 && !value.endsWith("@oauth.invalid"));
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
    // Same hash and the same two writes either way. ON CONFLICT does nothing when the email
    // exists; the identity insert is keyed to this attempt's id, which is only present if the user insert won.
    const passwordHash = await hashPassword(password);
    const userId = newId();
    const createdAt = new Date().toISOString();
    await db.batch([
      {
        sql: `INSERT INTO users (id, email, password_hash, display_name, settings, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(email) DO NOTHING`,
        params: [userId, email, passwordHash, null, JSON.stringify(DEFAULT_SETTINGS), createdAt],
      },
      {
        sql: `INSERT INTO identities (id, user_id, provider, provider_user_id, created_at)
              SELECT ?, ?, ?, ?, ?
              WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`,
        params: [newId(), userId, "password", userId, createdAt, userId],
      },
    ]);
    return c.json({ ok: true }, 201);
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
    const passwordHash = user?.password_hash || LOGIN_DUMMY_PASSWORD_HASH;
    const matches = await verifyPassword(password, passwordHash);
    if (!user || !user.password_hash || !matches) {
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
      const sent = await sendPasswordReset();
      if (sent) {
        const token = newId().replaceAll("-", "") + newId().replaceAll("-", "");
        const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await db.run("INSERT INTO password_resets (id, user_id, expires_at) VALUES (?, ?, ?)", [
          hashToken(token),
          user.id,
          expires,
        ]);
      }
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
    const digest = hashToken(token);
    const passwordHash = await hashPassword(password);
    const claimed = await db.get<{ id: string; user_id: string }>(
      "DELETE FROM password_resets WHERE id = ? AND expires_at > ? RETURNING id, user_id",
      [digest, new Date().toISOString()],
    );
    if (!claimed || !tokenDigestEqual(claimed.id, digest)) {
      return c.json({ error: "That reset link is invalid or expired." }, 400);
    }
    // The token is already consumed. If this batch fails, the password stays unchanged
    // and the link cannot be retried. That is acceptable while sendPasswordReset returns false.
    await db.batch([
      {
        sql: "UPDATE users SET password_hash = ? WHERE id = ?",
        params: [passwordHash, claimed.user_id],
      },
      { sql: "DELETE FROM sessions WHERE user_id = ?", params: [claimed.user_id] },
      { sql: "DELETE FROM password_resets WHERE user_id = ?", params: [claimed.user_id] },
    ]);
    const user = await db.get<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = ?`, [claimed.user_id]);
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

async function sendPasswordReset(): Promise<boolean> {
  return false;
}
