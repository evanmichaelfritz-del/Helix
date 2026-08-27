import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authRoutes } from "./routes/auth.js";
import { oauthRoutes } from "./routes/auth-oauth.js";
import { webauthnRoutes } from "./routes/auth-webauthn.js";
import { peptideRoutes, vialRoutes } from "./routes/catalog.js";
import type { Env } from "./context.js";
import type { Database } from "./db.js";
import { ensureMigrated } from "./db.js";
import { ensureMixColumns } from "./schema.js";
import { healthRoutes } from "./routes/health.js";
import { importRoutes } from "./routes/import.js";
import { doseRoutes, weighInRoutes, workoutRoutes } from "./routes/logs.js";
import { meRoutes } from "./routes/me.js";
import { todayRoutes } from "./routes/today.js";
import { loadUser } from "./auth.js";

function isPublicApi(path: string): boolean {
  if (path === "/api/healthz") return true;
  if (
    path === "/api/auth/signup" ||
    path === "/api/auth/login" ||
    path === "/api/auth/logout" ||
    path === "/api/auth/forgot" ||
    path === "/api/auth/reset"
  ) {
    return true;
  }
  if (path === "/api/auth/google" || path.startsWith("/api/auth/google/")) return true;
  if (path === "/api/auth/x" || path.startsWith("/api/auth/x/")) return true;
  if (path === "/api/auth/passkey" || path.startsWith("/api/auth/passkey/")) return true;
  return false;
}

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
    await ensureMixColumns(db);
    await next();
  });

  app.use("/api/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (isPublicApi(path)) {
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
  app.route("/api/auth", oauthRoutes);
  app.route("/api/auth", webauthnRoutes);
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
