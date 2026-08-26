import { Hono } from "hono";
import { requireUser } from "../auth.js";
import type { Env, HealthDayRow, WeighInRow, WorkoutRow } from "../context.js";
import { mapHealthDay, mapWeighIn, mapWorkout } from "./mappers.js";
import { parseOn } from "./today.js";

export const healthRoutes = new Hono<Env>();

healthRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const db = c.get("db");
  const from = parseOn(c.req.query("from"));
  const to = parseOn(c.req.query("to"));
  let sql = "SELECT * FROM health_days WHERE user_id = ?";
  const params: string[] = [user.id];
  if (from) {
    sql += " AND logged_on >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND logged_on <= ?";
    params.push(to);
  }
  sql += " ORDER BY logged_on ASC";
  const days = await db.all<HealthDayRow>(sql, params);
  const weighIns = await db.all<WeighInRow>(
    "SELECT * FROM weigh_ins WHERE user_id = ? ORDER BY logged_on ASC",
    [user.id],
  );
  const workouts = await db.all<WorkoutRow>(
    "SELECT * FROM workouts WHERE user_id = ? ORDER BY logged_on DESC, created_at DESC LIMIT 40",
    [user.id],
  );
  return c.json({
    days: days.map(mapHealthDay),
    weighIns: weighIns.map(mapWeighIn),
    workouts: workouts.map(mapWorkout),
  });
});
