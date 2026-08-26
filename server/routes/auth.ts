import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createSession, destroySession, hashPassword, newId, requireUser, verifyPassword } from "../auth.ts";
import { toPublicUser, type Env, type UserRow } from "../context.ts";
import { DEFAULT_SETTINGS } from "../../shared/types.ts";

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const passwordSchema = z.string().min(8).max(200);

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
    const user = await db.get<UserRow>(
      "SELECT id, email, password_hash, display_name, settings, created_at FROM users WHERE email = ?",
      [email],
    );
    if (!user || !(await verifyPassword(password, user.password_hash))) {
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
