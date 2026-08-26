import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { newId, requireUser } from "../auth.ts";
import type { Env, HealthDayRow, PeptideRow } from "../context.ts";
import { parseLocalDate, PEPTIDE_COLORS, PEPTIDE_UNITS } from "../../shared/types.ts";
import { activeDoseSql, undoneParam } from "../dialect.ts";

const daySchema = z.object({
  loggedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  whoopRecovery: z.number().min(0).max(100).nullable().optional(),
  garminBodyBattery: z.number().min(0).max(100).nullable().optional(),
  sleepHours: z.number().min(0).max(24).nullable().optional(),
  strain: z.number().min(0).max(40).nullable().optional(),
  steps: z.number().min(0).max(200000).nullable().optional(),
});

const recordsSchema = z.object({
  source: z.enum(["whoop", "garmin", "apple", "helix"]),
  healthDays: z.array(daySchema).max(400),
  workouts: z
    .array(
      z.object({
        loggedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        name: z.string().min(1).max(120),
        durationMin: z.number().min(0).max(1440).nullable().optional(),
        strain: z.number().min(0).max(40).nullable().optional(),
      }),
    )
    .max(400),
  weighIns: z
    .array(
      z.object({
        loggedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        kg: z.number().positive().max(400),
      }),
    )
    .max(400),
  peptides: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        unit: z.enum(PEPTIDE_UNITS),
        color: z.string().max(16).optional(),
        lastAmount: z.number().nullable().optional(),
      }),
    )
    .max(50)
    .optional(),
  vials: z
    .array(
      z.object({
        peptideName: z.string().min(1),
        label: z.string().max(80).nullable().optional(),
        totalAmount: z.number().positive(),
        remainingAmount: z.number().min(0),
        dose: z.number().positive(),
        openedOn: z.string().nullable().optional(),
      }),
    )
    .max(50)
    .optional(),
  doses: z
    .array(
      z.object({
        peptideName: z.string().min(1),
        amount: z.number().positive(),
        unit: z.enum(PEPTIDE_UNITS),
        loggedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        loggedAt: z.string().optional(),
      }),
    )
    .max(400)
    .optional(),
});

export const importRoutes = new Hono<Env>();

importRoutes.post("/records", zValidator("json", recordsSchema), async (c) => {
  const user = requireUser(c);
  const body = c.req.valid("json");
  const db = c.get("db");
  const warnings: string[] = [];
  let healthDays = 0;
  let workouts = 0;
  let weighIns = 0;
  let peptides = 0;
  let vials = 0;
  let doses = 0;

  for (const day of body.healthDays) {
    if (!parseLocalDate(day.loggedOn)) continue;
    const existing = await db.get<HealthDayRow>(
      "SELECT * FROM health_days WHERE user_id = ? AND logged_on = ?",
      [user.id, day.loggedOn],
    );
    if (existing) {
      await db.run(
        `UPDATE health_days SET
          whoop_recovery = COALESCE(?, whoop_recovery),
          garmin_body_battery = COALESCE(?, garmin_body_battery),
          sleep_hours = COALESCE(?, sleep_hours),
          strain = COALESCE(?, strain),
          steps = COALESCE(?, steps),
          source = ?
         WHERE id = ?`,
        [
          day.whoopRecovery ?? null,
          day.garminBodyBattery ?? null,
          day.sleepHours ?? null,
          day.strain ?? null,
          day.steps ?? null,
          body.source,
          existing.id,
        ],
      );
    } else {
      await db.run(
        `INSERT INTO health_days
          (id, user_id, logged_on, whoop_recovery, garmin_body_battery, sleep_hours, strain, steps, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          user.id,
          day.loggedOn,
          day.whoopRecovery ?? null,
          day.garminBodyBattery ?? null,
          day.sleepHours ?? null,
          day.strain ?? null,
          day.steps ?? null,
          body.source,
        ],
      );
    }
    healthDays += 1;
  }

  for (const w of body.workouts) {
    const dup = await db.get<{ id: string }>(
      "SELECT id FROM workouts WHERE user_id = ? AND logged_on = ? AND name = ?",
      [user.id, w.loggedOn, w.name],
    );
    if (dup) continue;
    await db.run(
      "INSERT INTO workouts (id, user_id, logged_on, name, duration_min, strain, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        newId(),
        user.id,
        w.loggedOn,
        w.name,
        w.durationMin ?? null,
        w.strain ?? null,
        body.source,
        new Date().toISOString(),
      ],
    );
    workouts += 1;
  }

  for (const w of body.weighIns) {
    const existing = await db.get<{ id: string }>(
      "SELECT id FROM weigh_ins WHERE user_id = ? AND logged_on = ?",
      [user.id, w.loggedOn],
    );
    if (existing) {
      await db.run("UPDATE weigh_ins SET kg = ? WHERE id = ?", [w.kg, existing.id]);
    } else {
      await db.run(
        "INSERT INTO weigh_ins (id, user_id, kg, logged_on, created_at) VALUES (?, ?, ?, ?, ?)",
        [newId(), user.id, w.kg, w.loggedOn, new Date().toISOString()],
      );
    }
    weighIns += 1;
  }

  const peptideIds = new Map<string, string>();
  const existingPeptides = await db.all<PeptideRow>(
    "SELECT * FROM peptides WHERE user_id = ?",
    [user.id],
  );
  for (const p of existingPeptides) peptideIds.set(p.name.toLowerCase(), p.id);

  const incomingPeptides = body.peptides ?? [];
  let colorIdx = existingPeptides.length;
  for (const p of incomingPeptides) {
    const key = p.name.toLowerCase();
    if (peptideIds.has(key)) {
      warnings.push(`Skipped peptide already in Helix: ${p.name}`);
      continue;
    }
    const id = newId();
    await db.run(
      "INSERT INTO peptides (id, user_id, name, unit, color, last_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        user.id,
        p.name,
        p.unit,
        p.color ?? PEPTIDE_COLORS[colorIdx % PEPTIDE_COLORS.length],
        p.lastAmount ?? null,
        new Date().toISOString(),
      ],
    );
    peptideIds.set(key, id);
    colorIdx += 1;
    peptides += 1;
  }

  for (const v of body.vials ?? []) {
    const peptideId = peptideIds.get(v.peptideName.toLowerCase());
    if (!peptideId) {
      warnings.push(`Skipped vial for unknown peptide: ${v.peptideName}`);
      continue;
    }
    await db.run(
      "INSERT INTO vials (id, user_id, peptide_id, label, total_amount, remaining_amount, dose, opened_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        newId(),
        user.id,
        peptideId,
        v.label ?? null,
        v.totalAmount,
        v.remainingAmount,
        v.dose,
        v.openedOn ?? null,
        new Date().toISOString(),
      ],
    );
    vials += 1;
  }

  for (const d of body.doses ?? []) {
    const peptideId = peptideIds.get(d.peptideName.toLowerCase());
    if (!peptideId) {
      warnings.push(`Skipped dose for unknown peptide: ${d.peptideName}`);
      continue;
    }
    const exists = await db.get<{ id: string }>(
      `SELECT id FROM doses WHERE user_id = ? AND peptide_id = ? AND logged_on = ? AND ${activeDoseSql(db.dialect)}`,
      [user.id, peptideId, d.loggedOn],
    );
    if (exists) continue;
    await db.run(
      "INSERT INTO doses (id, user_id, peptide_id, vial_id, amount, unit, logged_on, logged_at, undone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        newId(),
        user.id,
        peptideId,
        null,
        d.amount,
        d.unit,
        d.loggedOn,
        d.loggedAt ?? new Date().toISOString(),
        undoneParam(db.dialect, false),
      ],
    );
    doses += 1;
  }

  return c.json({
    healthDays,
    workouts,
    weighIns,
    peptides,
    vials,
    doses,
    warnings,
  });
});
