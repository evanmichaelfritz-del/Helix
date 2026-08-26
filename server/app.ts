import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authRoutes } from "./routes/auth.ts";
import { peptideRoutes, vialRoutes } from "./routes/catalog.ts";
import type { Env } from "./context.ts";
import type { Database } from "./db.ts";
import { ensureMigrated } from "./db.ts";
import { healthRoutes } from "./routes/health.ts";
import { importRoutes } from "./routes/import.ts";
import { doseRoutes, weighInRoutes, workoutRoutes } from "./routes/logs.ts";
import { meRoutes } from "./routes/me.ts";
import { todayRoutes } from "./routes/today.ts";
import { loadUser } from "./auth.ts";

const PUBLIC = new Set(["/api/healthz", "/api/auth/signup", "/api/auth/login"]);

export function createApp(db: Database) {
  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: "Server error" }, 500);
  });

  app.use("/api/*", async (c, next) => {
    c.set("db", db);
    await ensureMigrated(db);
    await next();
  });

  app.use("/api/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (PUBLIC.has(path) || path === "/api/auth/logout") {
      c.set("user", await loadUser(c));
      await next();
      return;
    }
    const user = await loadUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    c.set("user", user);
    await next();
  });

  app.get("/api/healthz", (c) => c.json({ ok: true }));
  app.route("/api/auth", authRoutes);
  app.route("/api/me", meRoutes);
  app.route("/api/today", todayRoutes);
  app.route("/api/peptides", peptideRoutes);
  app.route("/api/vials", vialRoutes);
  app.route("/api/doses", doseRoutes);
  app.route("/api/weigh-ins", weighInRoutes);
  app.route("/api/workouts", workoutRoutes);
  app.route("/api/health", healthRoutes);
  app.route("/api/import", importRoutes);

  return app;
}
