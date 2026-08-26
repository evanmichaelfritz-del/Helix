import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireUser } from "../auth.ts";
import { parseSettings, toPublicUser, type Env } from "../context.ts";
import { DEFAULT_SETTINGS } from "../../shared/types.ts";

export const meRoutes = new Hono<Env>();

meRoutes.get("/", (c) => {
  const user = requireUser(c);
  return c.json({ user: toPublicUser(user) });
});

meRoutes.patch(
  "/",
  zValidator(
    "json",
    z.object({
      displayName: z.string().trim().max(80).nullable().optional(),
      settings: z
        .object({
          theme: z.enum(["system", "light", "dark"]).optional(),
          faceId: z.boolean().optional(),
          reduceEffects: z.boolean().optional(),
          weightUnit: z.enum(["kg", "lb"]).optional(),
        })
        .optional(),
    }),
  ),
  async (c) => {
    const user = requireUser(c);
    const body = c.req.valid("json");
    const current = parseSettings(user.settings);
    const settings = body.settings
      ? {
          ...DEFAULT_SETTINGS,
          ...current,
          ...body.settings,
        }
      : current;
    const displayName = body.displayName === undefined ? user.display_name : body.displayName;
    const db = c.get("db");
    await db.run("UPDATE users SET display_name = ?, settings = ? WHERE id = ?", [
      displayName,
      JSON.stringify(settings),
      user.id,
    ]);
    const next = await db.get<typeof user>(
      "SELECT id, email, password_hash, display_name, settings, created_at FROM users WHERE id = ?",
      [user.id],
    );
    if (!next) return c.json({ error: "missing user" }, 500);
    c.set("user", next);
    return c.json({ user: toPublicUser(next) });
  },
);
