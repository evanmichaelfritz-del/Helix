import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authRoutes } from "./routes/auth.js";
import { peptideRoutes, vialRoutes } from "./routes/catalog.js";
import type { Env } from "./context.js";
import type { Database } from "./db.js";
import { ensureMigrated } from "./db.js";
import { healthRoutes } from "./routes/health.js";
import { importRoutes } from "./routes/import.js";
import { doseRoutes, weighInRoutes, workoutRoutes } from "./routes/logs.js";
import { meRoutes } from "./routes/me.js";
import { todayRoutes } from "./routes/today.js";
import { loadUser } from "./auth.js";

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
