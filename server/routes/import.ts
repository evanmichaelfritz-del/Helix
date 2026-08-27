import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { newId, requireUser } from "../auth.js";
import type { Env, HealthDayRow, PeptideRow } from "../context.js";
import type { Database, SqlValue } from "../db.js";
import { parseLocalDate, PEPTIDE_COLORS, PEPTIDE_UNITS } from "../../shared/types.js";
import { activeDoseSql, undoneParam } from "../dialect.js";

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

type RecordsBody = z.infer<typeof recordsSchema>;

const SQLITE_SAFE_VARS = 900;

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function multiInsert(
  tx: Database,
  table: string,
  columns: string[],
  rows: SqlValue[][],
): Promise<void> {
  if (rows.length === 0) return;
  const maxRows = Math.max(1, Math.floor(SQLITE_SAFE_VARS / columns.length));
  const colSql = columns.join(", ");
  const one = `(${columns.map(() => "?").join(", ")})`;
  for (const part of chunk(rows, maxRows)) {
    await tx.run(
      `INSERT INTO ${table} (${colSql}) VALUES ${part.map(() => one).join(", ")}`,
      part.flat(),
    );
  }
}

async function bulkUpdateHealthDays(
  tx: Database,
  rows: Array<{
    id: string;
    whoop_recovery: SqlValue;
    garmin_body_battery: SqlValue;
    sleep_hours: SqlValue;
    strain: SqlValue;
    steps: SqlValue;
    source: string;
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  const maxRows = Math.max(1, Math.floor(SQLITE_SAFE_VARS / 13));
  for (const part of chunk(rows, maxRows)) {
    const params: SqlValue[] = [];
    const caseSql = (values: SqlValue[]) => {
      const bits: string[] = [];
      for (let i = 0; i < part.length; i++) {
        bits.push("WHEN ? THEN ?");
        params.push(part[i].id, values[i]);
      }
      return `CASE id ${bits.join(" ")} END`;
    };
    const whoop = caseSql(part.map((row) => row.whoop_recovery));
    const garmin = caseSql(part.map((row) => row.garmin_body_battery));
    const sleep = caseSql(part.map((row) => row.sleep_hours));
    const strain = caseSql(part.map((row) => row.strain));
    const steps = caseSql(part.map((row) => row.steps));
    const source = caseSql(part.map((row) => row.source));
    params.push(...part.map((row) => row.id));
    await tx.run(
      `UPDATE health_days SET
        whoop_recovery = ${whoop},
        garmin_body_battery = ${garmin},
        sleep_hours = ${sleep},
        strain = ${strain},
        steps = ${steps},
        source = ${source}
       WHERE id IN (${part.map(() => "?").join(", ")})`,
      params,
    );
  }
}

async function bulkUpdateWeighIns(
  tx: Database,
  rows: Array<{ id: string; kg: number }>,
): Promise<void> {
  if (rows.length === 0) return;
  const maxRows = Math.max(1, Math.floor(SQLITE_SAFE_VARS / 3));
  for (const part of chunk(rows, maxRows)) {
    const params: SqlValue[] = [];
    const bits: string[] = [];
    for (const row of part) {
      bits.push("WHEN ? THEN ?");
      params.push(row.id, row.kg);
    }
    params.push(...part.map((row) => row.id));
    await tx.run(
      `UPDATE weigh_ins SET kg = CASE id ${bits.join(" ")} END WHERE id IN (${part.map(() => "?").join(", ")})`,
      params,
    );
  }
}

export const importRoutes = new Hono<Env>();

importRoutes.post("/records", zValidator("json", recordsSchema), async (c) => {
  const user = requireUser(c);
  const body = c.req.valid("json");
  const db = c.get("db");
  const result = await importRecords(db, user.id, body);
  return c.json(result);
});

async function importRecords(
  db: Database,
  userId: string,
  body: RecordsBody,
): Promise<{
  healthDays: number;
  workouts: number;
  weighIns: number;
  peptides: number;
  vials: number;
  doses: number;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const now = new Date().toISOString();
  const incomingPeptides = body.peptides ?? [];
  const incomingVials = body.vials ?? [];
  const incomingDoses = body.doses ?? [];

  const existingPeptides = await db.all<PeptideRow>(
    "SELECT * FROM peptides WHERE user_id = ?",
    [userId],
  );
  const existingDoses =
    incomingDoses.length > 0
      ? await db.all<{ peptide_id: string; logged_on: string }>(
          `SELECT peptide_id, logged_on FROM doses WHERE user_id = ? AND ${activeDoseSql(db.dialect)}`,
          [userId],
        )
      : [];
  const existingWeighIns =
    body.weighIns.length > 0
      ? await db.all<{ id: string; logged_on: string }>(
          "SELECT id, logged_on FROM weigh_ins WHERE user_id = ?",
          [userId],
        )
      : [];
  const existingHealthDays =
    body.healthDays.length > 0
      ? await db.all<HealthDayRow>("SELECT * FROM health_days WHERE user_id = ?", [userId])
      : [];
  const existingWorkouts =
    body.workouts.length > 0
      ? await db.all<{ logged_on: string; name: string }>(
          "SELECT logged_on, name FROM workouts WHERE user_id = ?",
          [userId],
        )
      : [];

  const peptideIds = new Map<string, string>();
  for (const p of existingPeptides) peptideIds.set(p.name.toLowerCase(), p.id);
  const doseKeys = new Set(existingDoses.map((d) => `${d.peptide_id}\0${d.logged_on}`));
  const weighByDay = new Map(existingWeighIns.map((w) => [w.logged_on, w.id]));
  const healthByDay = new Map(existingHealthDays.map((d) => [d.logged_on, d]));
  const workoutKeys = new Set(existingWorkouts.map((w) => `${w.logged_on}\0${w.name}`));

  const peptideInserts: SqlValue[][] = [];
  let colorIdx = existingPeptides.length;
  let peptides = 0;
  for (const p of incomingPeptides) {
    const key = p.name.toLowerCase();
    if (peptideIds.has(key)) {
      warnings.push(`Skipped peptide already in Helix: ${p.name}`);
      continue;
    }
    const id = newId();
    peptideIds.set(key, id);
    peptideInserts.push([
      id,
      userId,
      p.name,
      p.unit,
      p.color ?? PEPTIDE_COLORS[colorIdx % PEPTIDE_COLORS.length],
      p.lastAmount ?? null,
      now,
    ]);
    colorIdx += 1;
    peptides += 1;
  }

  const healthUpdates: Array<{
    id: string;
    whoop_recovery: SqlValue;
    garmin_body_battery: SqlValue;
    sleep_hours: SqlValue;
    strain: SqlValue;
    steps: SqlValue;
    source: string;
  }> = [];
  const healthInserts: SqlValue[][] = [];
  const pendingHealth = new Map<
    string,
    { kind: "update"; row: (typeof healthUpdates)[number] } | { kind: "insert"; row: SqlValue[] }
  >();
  let healthDays = 0;
  for (const day of body.healthDays) {
    if (!parseLocalDate(day.loggedOn)) continue;
    healthDays += 1;
    const pending = pendingHealth.get(day.loggedOn);
    const existing = healthByDay.get(day.loggedOn);
    if (pending?.kind === "update") {
      pending.row.whoop_recovery = day.whoopRecovery ?? pending.row.whoop_recovery;
      pending.row.garmin_body_battery = day.garminBodyBattery ?? pending.row.garmin_body_battery;
      pending.row.sleep_hours = day.sleepHours ?? pending.row.sleep_hours;
      pending.row.strain = day.strain ?? pending.row.strain;
      pending.row.steps = day.steps ?? pending.row.steps;
      pending.row.source = body.source;
      continue;
    }
    if (pending?.kind === "insert") {
      const row = pending.row;
      row[3] = day.whoopRecovery ?? row[3];
      row[4] = day.garminBodyBattery ?? row[4];
      row[5] = day.sleepHours ?? row[5];
      row[6] = day.strain ?? row[6];
      row[7] = day.steps ?? row[7];
      row[8] = body.source;
      continue;
    }
    if (existing) {
      const update = {
        id: existing.id,
        whoop_recovery: day.whoopRecovery ?? existing.whoop_recovery,
        garmin_body_battery: day.garminBodyBattery ?? existing.garmin_body_battery,
        sleep_hours: day.sleepHours ?? existing.sleep_hours,
        strain: day.strain ?? existing.strain,
        steps: day.steps ?? existing.steps,
        source: body.source,
      };
      healthUpdates.push(update);
      pendingHealth.set(day.loggedOn, { kind: "update", row: update });
    } else {
      const id = newId();
      const row: SqlValue[] = [
        id,
        userId,
        day.loggedOn,
        day.whoopRecovery ?? null,
        day.garminBodyBattery ?? null,
        day.sleepHours ?? null,
        day.strain ?? null,
        day.steps ?? null,
        body.source,
      ];
      healthInserts.push(row);
      pendingHealth.set(day.loggedOn, { kind: "insert", row });
      healthByDay.set(day.loggedOn, {
        id,
        user_id: userId,
        logged_on: day.loggedOn,
        whoop_recovery: day.whoopRecovery ?? null,
        garmin_body_battery: day.garminBodyBattery ?? null,
        sleep_hours: day.sleepHours ?? null,
        strain: day.strain ?? null,
        steps: day.steps ?? null,
        source: body.source,
      });
    }
  }

  const workoutInserts: SqlValue[][] = [];
  let workouts = 0;
  for (const w of body.workouts) {
    const key = `${w.loggedOn}\0${w.name}`;
    if (workoutKeys.has(key)) continue;
    workoutKeys.add(key);
    workoutInserts.push([
      newId(),
      userId,
      w.loggedOn,
      w.name,
      w.durationMin ?? null,
      w.strain ?? null,
      body.source,
      now,
    ]);
    workouts += 1;
  }

  const weighUpdates: Array<{ id: string; kg: number }> = [];
  const weighInserts: SqlValue[][] = [];
  const pendingWeigh = new Map<string, { kind: "update"; row: { id: string; kg: number } } | { kind: "insert"; row: SqlValue[] }>();
  let weighIns = 0;
  for (const w of body.weighIns) {
    weighIns += 1;
    const pending = pendingWeigh.get(w.loggedOn);
    if (pending?.kind === "update") {
      pending.row.kg = w.kg;
      continue;
    }
    if (pending?.kind === "insert") {
      pending.row[2] = w.kg;
      continue;
    }
    const existingId = weighByDay.get(w.loggedOn);
    if (existingId) {
      const row = { id: existingId, kg: w.kg };
      weighUpdates.push(row);
      pendingWeigh.set(w.loggedOn, { kind: "update", row });
    } else {
      const id = newId();
      const row: SqlValue[] = [id, userId, w.kg, w.loggedOn, now];
      weighInserts.push(row);
      pendingWeigh.set(w.loggedOn, { kind: "insert", row });
      weighByDay.set(w.loggedOn, id);
    }
  }

  const vialInserts: SqlValue[][] = [];
  let vials = 0;
  for (const v of incomingVials) {
    const peptideId = peptideIds.get(v.peptideName.toLowerCase());
    if (!peptideId) {
      warnings.push(`Skipped vial for unknown peptide: ${v.peptideName}`);
      continue;
    }
    vialInserts.push([
      newId(),
      userId,
      peptideId,
      v.label ?? null,
      v.totalAmount,
      v.remainingAmount,
      v.dose,
      v.openedOn ?? null,
      now,
    ]);
    vials += 1;
  }

  const doseInserts: SqlValue[][] = [];
  let doses = 0;
  for (const d of incomingDoses) {
    const peptideId = peptideIds.get(d.peptideName.toLowerCase());
    if (!peptideId) {
      warnings.push(`Skipped dose for unknown peptide: ${d.peptideName}`);
      continue;
    }
    const key = `${peptideId}\0${d.loggedOn}`;
    if (doseKeys.has(key)) continue;
    doseKeys.add(key);
    doseInserts.push([
      newId(),
      userId,
      peptideId,
      null,
      d.amount,
      d.unit,
      d.loggedOn,
      d.loggedAt ?? now,
      undoneParam(db.dialect, false),
    ]);
    doses += 1;
  }

  await db.transaction(async (tx) => {
    await bulkUpdateHealthDays(tx, healthUpdates);
    await multiInsert(
      tx,
      "health_days",
      [
        "id",
        "user_id",
        "logged_on",
        "whoop_recovery",
        "garmin_body_battery",
        "sleep_hours",
        "strain",
        "steps",
        "source",
      ],
      healthInserts,
    );
    await multiInsert(
      tx,
      "workouts",
      ["id", "user_id", "logged_on", "name", "duration_min", "strain", "source", "created_at"],
      workoutInserts,
    );
    await bulkUpdateWeighIns(tx, weighUpdates);
    await multiInsert(tx, "weigh_ins", ["id", "user_id", "kg", "logged_on", "created_at"], weighInserts);
    await multiInsert(
      tx,
      "peptides",
      ["id", "user_id", "name", "unit", "color", "last_amount", "created_at"],
      peptideInserts,
    );
    await multiInsert(
      tx,
      "vials",
      [
        "id",
        "user_id",
        "peptide_id",
        "label",
        "total_amount",
        "remaining_amount",
        "dose",
        "opened_on",
        "created_at",
      ],
      vialInserts,
    );
    await multiInsert(
      tx,
      "doses",
      [
        "id",
        "user_id",
        "peptide_id",
        "vial_id",
        "amount",
        "unit",
        "logged_on",
        "logged_at",
        "undone",
      ],
      doseInserts,
    );
  });

  return {
    healthDays,
    workouts,
    weighIns,
    peptides,
    vials,
    doses,
    warnings,
  };
}
