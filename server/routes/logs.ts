import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { PEPTIDE_UNITS } from "../../shared/types.js";
import { newId, requireUser } from "../auth.js";
import type { DoseRow, Env, PeptideRow, VialRow, WeighInRow, WorkoutRow } from "../context.js";
import { activeDoseSql, isUndone, undoneParam } from "../dialect.js";
import { mapDose, mapWeighIn, mapWorkout } from "./mappers.js";
import { parseOn } from "./today.js";

export const doseRoutes = new Hono<Env>();

doseRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const db = c.get("db");
  const on = parseOn(c.req.query("on"));
  const from = parseOn(c.req.query("from"));
  const to = parseOn(c.req.query("to"));
  const dialect = db.dialect;
  let sql = `SELECT * FROM doses WHERE user_id = ? AND ${activeDoseSql(dialect)}`;
  const params: Array<string> = [user.id];
  if (on) {
    sql += " AND logged_on = ?";
    params.push(on);
  } else {
    if (from) {
      sql += " AND logged_on >= ?";
      params.push(from);
    }
    if (to) {
      sql += " AND logged_on <= ?";
      params.push(to);
    }
  }
  sql += " ORDER BY logged_at DESC";
  const rows = await db.all<DoseRow>(sql, params);
  return c.json({ doses: rows.map(mapDose) });
});

doseRoutes.post(
  "/",
  zValidator(
    "json",
    z.object({
      peptideId: z.string().min(1),
      amount: z.number().positive(),
      unit: z.enum(PEPTIDE_UNITS).optional(),
      vialId: z.string().min(1).nullable().optional(),
      loggedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  ),
  async (c) => {
    const user = requireUser(c);
    const body = c.req.valid("json");
    const db = c.get("db");
    const peptide = await db.get<PeptideRow>(
      "SELECT * FROM peptides WHERE id = ? AND user_id = ?",
      [body.peptideId, user.id],
    );
    if (!peptide) return c.json({ error: "Peptide not found." }, 404);
    const existing = await db.get<DoseRow>(
      `SELECT * FROM doses WHERE user_id = ? AND peptide_id = ? AND logged_on = ? AND ${activeDoseSql(db.dialect)}`,
      [user.id, body.peptideId, body.loggedOn],
    );
    if (existing) {
      return c.json({ error: "Already logged for today. Undo first to log again." }, 409);
    }
    let vial: VialRow | undefined;
    if (body.vialId) {
      vial = await db.get<VialRow>("SELECT * FROM vials WHERE id = ? AND user_id = ?", [
        body.vialId,
        user.id,
      ]);
    } else {
      vial = await db.get<VialRow>(
        "SELECT * FROM vials WHERE user_id = ? AND peptide_id = ? ORDER BY created_at DESC LIMIT 1",
        [user.id, body.peptideId],
      );
    }
    const now = new Date().toISOString();
    const row: DoseRow = {
      id: newId(),
      user_id: user.id,
      peptide_id: body.peptideId,
      vial_id: vial?.id ?? null,
      amount: body.amount,
      unit: body.unit ?? peptide.unit,
      logged_on: body.loggedOn,
      logged_at: now,
      undone: undoneParam(db.dialect, false),
    };
    try {
      await db.run(
        "INSERT INTO doses (id, user_id, peptide_id, vial_id, amount, unit, logged_on, logged_at, undone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          row.id,
          row.user_id,
          row.peptide_id,
          row.vial_id,
          row.amount,
          row.unit,
          row.logged_on,
          row.logged_at,
          undoneParam(db.dialect, false),
        ],
      );
    } catch {
      return c.json({ error: "Already logged for today. Undo first to log again." }, 409);
    }
    await db.run("UPDATE peptides SET last_amount = ? WHERE id = ?", [body.amount, peptide.id]);
    if (vial) {
      const nextRemaining = Math.max(0, Number(vial.remaining_amount) - body.amount);
      await db.run("UPDATE vials SET remaining_amount = ? WHERE id = ?", [nextRemaining, vial.id]);
    }
    return c.json({ dose: mapDose(row) }, 201);
  },
);

doseRoutes.post("/:id/undo", async (c) => {
  const user = requireUser(c);
  const db = c.get("db");
  const row = await db.get<DoseRow>("SELECT * FROM doses WHERE id = ? AND user_id = ?", [
    c.req.param("id"),
    user.id,
  ]);
  if (!row) return c.json({ error: "Dose not found." }, 404);
  if (isUndone(row.undone)) return c.json({ dose: mapDose(row) });
  await db.run("UPDATE doses SET undone = ? WHERE id = ?", [undoneParam(db.dialect, true), row.id]);
  if (row.vial_id) {
    const vial = await db.get<VialRow>("SELECT * FROM vials WHERE id = ? AND user_id = ?", [
      row.vial_id,
      user.id,
    ]);
    if (vial) {
      await db.run("UPDATE vials SET remaining_amount = ? WHERE id = ?", [
        Number(vial.remaining_amount) + Number(row.amount),
        vial.id,
      ]);
    }
  }
  return c.json({ dose: mapDose({ ...row, undone: undoneParam(db.dialect, true) }) });
});

export const weighInRoutes = new Hono<Env>();

weighInRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const db = c.get("db");
  const rows = await db.all<WeighInRow>(
    "SELECT * FROM weigh_ins WHERE user_id = ? ORDER BY logged_on DESC",
    [user.id],
  );
  return c.json({ weighIns: rows.map(mapWeighIn) });
});

weighInRoutes.post(
  "/",
  zValidator(
    "json",
    z.object({
      kg: z.number().positive().max(400),
      loggedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  ),
  async (c) => {
    const user = requireUser(c);
    const body = c.req.valid("json");
    const db = c.get("db");
    const existing = await db.get<WeighInRow>(
      "SELECT * FROM weigh_ins WHERE user_id = ? AND logged_on = ?",
      [user.id, body.loggedOn],
    );
    const now = new Date().toISOString();
    if (existing) {
      await db.run("UPDATE weigh_ins SET kg = ? WHERE id = ?", [body.kg, existing.id]);
      return c.json({ weighIn: mapWeighIn({ ...existing, kg: body.kg }) });
    }
    const row: WeighInRow = {
      id: newId(),
      user_id: user.id,
      kg: body.kg,
      logged_on: body.loggedOn,
      created_at: now,
    };
    await db.run(
      "INSERT INTO weigh_ins (id, user_id, kg, logged_on, created_at) VALUES (?, ?, ?, ?, ?)",
      [row.id, row.user_id, row.kg, row.logged_on, row.created_at],
    );
    return c.json({ weighIn: mapWeighIn(row) }, 201);
  },
);

export const workoutRoutes = new Hono<Env>();

workoutRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const db = c.get("db");
  const on = parseOn(c.req.query("on"));
  const from = parseOn(c.req.query("from"));
  const to = parseOn(c.req.query("to"));
  let sql = "SELECT * FROM workouts WHERE user_id = ?";
  const params: string[] = [user.id];
  if (on) {
    sql += " AND logged_on = ?";
    params.push(on);
  } else {
    if (from) {
      sql += " AND logged_on >= ?";
      params.push(from);
    }
    if (to) {
      sql += " AND logged_on <= ?";
      params.push(to);
    }
  }
  sql += " ORDER BY logged_on DESC, created_at DESC";
  const rows = await db.all<WorkoutRow>(sql, params);
  return c.json({ workouts: rows.map(mapWorkout) });
});
