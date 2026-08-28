import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { newId, requireUser } from "../auth.js";
import type { Env, PeptideRow } from "../context.js";
import type { Database, SqlValue } from "../db.js";
import { parseLocalDate, PEPTIDE_COLORS, PEPTIDE_UNITS } from "../../shared/types.js";
import { DEFAULT_PEPTIDE_SCHEDULE, serializePeptideSchedule } from "../../shared/schedule.js";
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
type Statement = { sql: string; params: SqlValue[] };

const SQLITE_SAFE_VARS = 900;

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function valuesSql(rowCount: number, colCount: number): string {
  const one = `(${Array.from({ length: colCount }, () => "?").join(", ")})`;
  return Array.from({ length: rowCount }, () => one).join(", ");
}

function unionFrom(columns: string[], rows: SqlValue[][]): { sql: string; params: SqlValue[] } {
  const parts = rows.map((_, i) =>
    i === 0
      ? `SELECT ${columns.map((col) => `? AS ${col}`).join(", ")}`
      : `SELECT ${columns.map(() => "?").join(", ")}`,
  );
  return { sql: parts.join(" UNION ALL "), params: rows.flat() };
}

function pushValues(
  statements: Statement[],
  sqlHead: string,
  columnsPerRow: number,
  rows: SqlValue[][],
  sqlTail = "",
): void {
  if (rows.length === 0) return;
  const maxRows = Math.max(1, Math.floor(SQLITE_SAFE_VARS / columnsPerRow));
  for (const part of chunk(rows, maxRows)) {
    statements.push({
      sql: `${sqlHead} ${valuesSql(part.length, columnsPerRow)}${sqlTail}`,
      params: part.flat(),
    });
  }
}

function pushUnionInsert(
  statements: Statement[],
  sqlBefore: string,
  columns: string[],
  rows: SqlValue[][],
  sqlAfter: string,
): void {
  if (rows.length === 0) return;
  const maxRows = Math.max(1, Math.floor(SQLITE_SAFE_VARS / columns.length));
  for (const part of chunk(rows, maxRows)) {
    const from = unionFrom(columns, part);
    statements.push({ sql: `${sqlBefore}${from.sql}${sqlAfter}`, params: from.params });
  }
}

function batchRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
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
  const undone = undoneParam(db.dialect, false);
  const activeDose = activeDoseSql(db.dialect);
  const skipActiveDose = activeDoseSql(db.dialect, "d");

  const uniquePeptides: SqlValue[][] = [];
  const seenPeptide = new Set<string>();
  for (const p of incomingPeptides) {
    const key = p.name.toLowerCase();
    if (seenPeptide.has(key)) {
      warnings.push(`Skipped peptide already in Helix: ${p.name}`);
      continue;
    }
    seenPeptide.add(key);
    uniquePeptides.push([
      newId(),
      userId,
      p.name,
      p.unit,
      p.color ?? PEPTIDE_COLORS[uniquePeptides.length % PEPTIDE_COLORS.length],
      p.lastAmount ?? null,
      serializePeptideSchedule(DEFAULT_PEPTIDE_SCHEDULE),
      now,
    ]);
  }

  const healthByDay = new Map<
    string,
    {
      id: string;
      whoop_recovery: SqlValue;
      garmin_body_battery: SqlValue;
      sleep_hours: SqlValue;
      strain: SqlValue;
      steps: SqlValue;
      source: string;
    }
  >();
  let healthDays = 0;
  for (const day of body.healthDays) {
    if (!parseLocalDate(day.loggedOn)) continue;
    healthDays += 1;
    const prev = healthByDay.get(day.loggedOn);
    if (!prev) {
      healthByDay.set(day.loggedOn, {
        id: newId(),
        whoop_recovery: day.whoopRecovery ?? null,
        garmin_body_battery: day.garminBodyBattery ?? null,
        sleep_hours: day.sleepHours ?? null,
        strain: day.strain ?? null,
        steps: day.steps ?? null,
        source: body.source,
      });
    } else {
      prev.whoop_recovery = day.whoopRecovery ?? prev.whoop_recovery;
      prev.garmin_body_battery = day.garminBodyBattery ?? prev.garmin_body_battery;
      prev.sleep_hours = day.sleepHours ?? prev.sleep_hours;
      prev.strain = day.strain ?? prev.strain;
      prev.steps = day.steps ?? prev.steps;
      prev.source = body.source;
    }
  }
  const healthRows = [...healthByDay.entries()].map(([loggedOn, row]) => [
    row.id,
    userId,
    loggedOn,
    row.whoop_recovery,
    row.garmin_body_battery,
    row.sleep_hours,
    row.strain,
    row.steps,
    row.source,
  ]);

  const workoutRows: SqlValue[][] = [];
  const seenWorkout = new Set<string>();
  for (const w of body.workouts) {
    const key = `${w.loggedOn}\0${w.name}`;
    if (seenWorkout.has(key)) continue;
    seenWorkout.add(key);
    workoutRows.push([
      newId(),
      userId,
      w.loggedOn,
      w.name,
      w.durationMin ?? null,
      w.strain ?? null,
      body.source,
      now,
    ]);
  }

  const weighByDay = new Map<string, SqlValue[]>();
  let weighIns = 0;
  for (const w of body.weighIns) {
    weighIns += 1;
    weighByDay.set(w.loggedOn, [newId(), userId, w.kg, w.loggedOn, now]);
  }
  const weighRows = [...weighByDay.values()];

  const vialRows: SqlValue[][] = [];
  for (const v of incomingVials) {
    vialRows.push([
      newId(),
      userId,
      v.peptideName,
      v.label ?? null,
      v.totalAmount,
      v.remainingAmount,
      v.dose,
      v.openedOn ?? null,
      now,
    ]);
  }

  const doseRows: SqlValue[][] = [];
  const seenDose = new Set<string>();
  for (const d of incomingDoses) {
    const key = `${d.peptideName.toLowerCase()}\0${d.loggedOn}`;
    if (seenDose.has(key)) continue;
    seenDose.add(key);
    doseRows.push([
      newId(),
      userId,
      d.peptideName,
      d.amount,
      d.unit,
      d.loggedOn,
      d.loggedAt ?? now,
      undone,
    ]);
  }

  const statements: Statement[] = [
    { sql: "SELECT * FROM peptides WHERE user_id = ?", params: [userId] },
    {
      sql: `SELECT peptide_id, logged_on FROM doses WHERE user_id = ? AND ${activeDose}`,
      params: [userId],
    },
    { sql: "SELECT id, logged_on FROM weigh_ins WHERE user_id = ?", params: [userId] },
    { sql: "SELECT * FROM health_days WHERE user_id = ?", params: [userId] },
    { sql: "SELECT logged_on, name FROM workouts WHERE user_id = ?", params: [userId] },
    { sql: "SELECT peptide_id FROM vials WHERE user_id = ?", params: [userId] },
  ];

  pushValues(
    statements,
    `INSERT INTO health_days (id, user_id, logged_on, whoop_recovery, garmin_body_battery, sleep_hours, strain, steps, source) VALUES`,
    9,
    healthRows,
    ` ON CONFLICT (user_id, logged_on) DO UPDATE SET
        whoop_recovery = COALESCE(excluded.whoop_recovery, health_days.whoop_recovery),
        garmin_body_battery = COALESCE(excluded.garmin_body_battery, health_days.garmin_body_battery),
        sleep_hours = COALESCE(excluded.sleep_hours, health_days.sleep_hours),
        strain = COALESCE(excluded.strain, health_days.strain),
        steps = COALESCE(excluded.steps, health_days.steps),
        source = excluded.source`,
  );
  pushUnionInsert(
    statements,
    `INSERT INTO workouts (id, user_id, logged_on, name, duration_min, strain, source, created_at)
     SELECT id, user_id, logged_on, name, duration_min, strain, source, created_at FROM (`,
    ["id", "user_id", "logged_on", "name", "duration_min", "strain", "source", "created_at"],
    workoutRows,
    `) AS incoming
     WHERE NOT EXISTS (
       SELECT 1 FROM workouts w
       WHERE w.user_id = incoming.user_id AND w.logged_on = incoming.logged_on AND w.name = incoming.name
     )`,
  );
  pushValues(
    statements,
    `INSERT INTO weigh_ins (id, user_id, kg, logged_on, created_at) VALUES`,
    5,
    weighRows,
    ` ON CONFLICT (user_id, logged_on) DO UPDATE SET kg = excluded.kg`,
  );
  pushUnionInsert(
    statements,
    `INSERT INTO peptides (id, user_id, name, unit, color, last_amount, schedule, created_at)
     SELECT id, user_id, name, unit, color, last_amount, schedule, created_at FROM (`,
    ["id", "user_id", "name", "unit", "color", "last_amount", "schedule", "created_at"],
    uniquePeptides,
    `) AS incoming
     WHERE NOT EXISTS (
       SELECT 1 FROM peptides p
       WHERE p.user_id = incoming.user_id AND lower(p.name) = lower(incoming.name)
     )`,
  );
  pushUnionInsert(
    statements,
    `INSERT INTO vials (id, user_id, peptide_id, label, total_amount, remaining_amount, dose, opened_on, created_at)
     SELECT incoming.id, incoming.user_id, p.id, incoming.label, incoming.total_amount, incoming.remaining_amount, incoming.dose, incoming.opened_on, incoming.created_at
     FROM (`,
    [
      "id",
      "user_id",
      "peptide_name",
      "label",
      "total_amount",
      "remaining_amount",
      "dose",
      "opened_on",
      "created_at",
    ],
    vialRows,
    `) AS incoming
     INNER JOIN peptides p ON p.user_id = incoming.user_id AND lower(p.name) = lower(incoming.peptide_name)
     WHERE NOT EXISTS (
       SELECT 1 FROM vials v
       WHERE v.user_id = incoming.user_id AND v.peptide_id = p.id
     )`,
  );
  pushUnionInsert(
    statements,
    `INSERT INTO doses (id, user_id, peptide_id, vial_id, amount, unit, logged_on, logged_at, undone)
     SELECT incoming.id, incoming.user_id, p.id, NULL, incoming.amount, incoming.unit, incoming.logged_on, incoming.logged_at, incoming.undone
     FROM (`,
    ["id", "user_id", "peptide_name", "amount", "unit", "logged_on", "logged_at", "undone"],
    doseRows,
    `) AS incoming
     INNER JOIN peptides p ON p.user_id = incoming.user_id AND lower(p.name) = lower(incoming.peptide_name)
     WHERE NOT EXISTS (
       SELECT 1 FROM doses d
       WHERE d.user_id = incoming.user_id AND d.peptide_id = p.id AND d.logged_on = incoming.logged_on AND ${skipActiveDose}
     )`,
  );

  const results = await db.batch(statements);
  const existingPeptides = batchRows<PeptideRow>(results[0]);
  const existingDoses = batchRows<{ peptide_id: string; logged_on: string }>(results[1]);
  const existingWorkouts = batchRows<{ logged_on: string; name: string }>(results[4]);
  const existingVials = batchRows<{ peptide_id: string }>(results[5]);

  const existingPeptideNames = new Set(existingPeptides.map((p) => p.name.toLowerCase()));
  const peptideIdName = new Map(existingPeptides.map((p) => [p.id, p.name.toLowerCase()]));
  const existingDoseKeys = new Set(
    existingDoses.map((d) => `${peptideIdName.get(d.peptide_id) ?? d.peptide_id}\0${d.logged_on}`),
  );
  const existingWorkoutKeys = new Set(existingWorkouts.map((w) => `${w.logged_on}\0${w.name}`));
  const knownPeptides = new Set(existingPeptideNames);
  for (const row of uniquePeptides) knownPeptides.add(String(row[2]).toLowerCase());
  const peptidesWithVials = new Set(
    existingVials
      .map((v) => peptideIdName.get(v.peptide_id))
      .filter((name): name is string => Boolean(name)),
  );

  let peptides = 0;
  for (const row of uniquePeptides) {
    const name = String(row[2]);
    if (existingPeptideNames.has(name.toLowerCase())) {
      warnings.push(`Skipped peptide already in Helix: ${name}`);
    } else {
      peptides += 1;
    }
  }

  let workouts = 0;
  for (const row of workoutRows) {
    if (!existingWorkoutKeys.has(`${row[2]}\0${row[3]}`)) workouts += 1;
  }

  let vials = 0;
  for (const v of incomingVials) {
    const nameKey = v.peptideName.toLowerCase();
    if (!knownPeptides.has(nameKey)) {
      warnings.push(`Skipped vial for unknown peptide: ${v.peptideName}`);
      continue;
    }
    if (peptidesWithVials.has(nameKey)) {
      warnings.push(`Skipped vial already in Helix: ${v.peptideName}`);
      continue;
    }
    vials += 1;
  }

  let doses = 0;
  const countedDose = new Set<string>();
  for (const d of incomingDoses) {
    const nameKey = d.peptideName.toLowerCase();
    if (!knownPeptides.has(nameKey)) {
      warnings.push(`Skipped dose for unknown peptide: ${d.peptideName}`);
      continue;
    }
    const key = `${nameKey}\0${d.loggedOn}`;
    if (countedDose.has(key) || existingDoseKeys.has(key)) continue;
    countedDose.add(key);
    doses += 1;
  }

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
