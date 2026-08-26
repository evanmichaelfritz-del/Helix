import { Hono } from "hono";
import { remainingInjections, runwayTone, supportingLines, todayHero } from "../../shared/health.js";
import { parseLocalDate, type LocalDate, type TodayPayload } from "../../shared/types.js";
import { requireUser } from "../auth.js";
import type { DoseRow, Env, HealthDayRow, PeptideRow, VialRow, WeighInRow, WorkoutRow } from "../context.js";
import { activeDoseSql } from "../dialect.js";
import { mapHealthDay, mapPeptide, mapVial, mapWeighIn, mapWorkout } from "./mappers.js";

export const todayRoutes = new Hono<Env>();

todayRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const on = parseOn(c.req.query("on") ?? c.req.header("X-Local-Date"));
  if (!on) return c.json({ error: "Pass on=YYYY-MM-DD" }, 400);
  const payload = await loadToday({ db: c.get("db"), userId: user.id, on });
  return c.json(payload);
});

export function parseOn(raw: string | undefined): LocalDate | undefined {
  if (!raw) return undefined;
  return parseLocalDate(raw);
}

export async function loadToday(opts: {
  db: Env["Variables"]["db"];
  userId: string;
  on: LocalDate;
}): Promise<TodayPayload> {
  const { db, userId, on } = opts;

  const healthDay = await db.get<HealthDayRow>(
    "SELECT * FROM health_days WHERE user_id = ? AND logged_on = ?",
    [userId, on],
  );

  const weighIns = await db.all<WeighInRow>(
    "SELECT * FROM weigh_ins WHERE user_id = ? AND logged_on <= ? ORDER BY logged_on ASC",
    [userId, on],
  );

  const workouts = await db.all<WorkoutRow>(
    "SELECT * FROM workouts WHERE user_id = ? AND logged_on = ? ORDER BY created_at ASC",
    [userId, on],
  );

  const peptides = await db.all<PeptideRow>(
    "SELECT * FROM peptides WHERE user_id = ? ORDER BY created_at ASC",
    [userId],
  );
  const vials = await db.all<VialRow>(
    "SELECT * FROM vials WHERE user_id = ? ORDER BY created_at DESC",
    [userId],
  );
  const dosesToday = await db.all<DoseRow>(
    `SELECT * FROM doses WHERE user_id = ? AND logged_on = ? AND ${activeDoseSql(db.dialect)}`,
    [userId, on],
  );

  const day = healthDay ? mapHealthDay(healthDay) : null;
  const mappedWeighIns = weighIns.map(mapWeighIn);
  const hero = todayHero(day);
  return {
    on,
    day,
    weighIns: mappedWeighIns,
    hero,
    supporting: supportingLines(day, mappedWeighIns, hero),
    protocol: nextProtocol({ peptides, vials, dosesToday }),
    workouts: workouts.map(mapWorkout),
  };
}

function nextProtocol(opts: {
  peptides: PeptideRow[];
  vials: VialRow[];
  dosesToday: DoseRow[];
}): TodayPayload["protocol"] {
  const { peptides, vials, dosesToday } = opts;
  if (peptides.length === 0) return { kind: "empty" };
  const logged = new Set(dosesToday.map((d) => d.peptide_id));
  const due = peptides.find((p) => !logged.has(p.id));
  const row = due ?? peptides[0];
  const peptide = mapPeptide(row);
  const vialRow = vials.find((v) => v.peptide_id === row.id) ?? null;
  const vial = vialRow ? mapVial(vialRow) : null;
  const remaining = vial ? remainingInjections(vial) : null;
  const loggedDose = dosesToday.find((d) => d.peptide_id === row.id);
  const amount = loggedDose?.amount ?? peptide.lastAmount ?? vial?.dose ?? 0;
  return {
    kind: "dose",
    peptide,
    vial,
    remainingInjections: remaining,
    runwayTone: remaining == null ? null : runwayTone(remaining),
    status: due ? "due" : "logged",
    amount,
    unit: peptide.unit,
  };
}
