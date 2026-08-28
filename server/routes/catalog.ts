import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { PEPTIDE_COLORS, PEPTIDE_UNITS } from "../../shared/types.js";
import { DEFAULT_PEPTIDE_SCHEDULE, parsePeptideSchedule, serializePeptideSchedule } from "../../shared/schedule.js";
import { remainingInjections, runwayTone } from "../../shared/health.js";
import { newId, requireUser } from "../auth.js";
import type { Env, PeptideRow, VialRow } from "../context.js";
import { mapPeptide, mapVial } from "./mappers.js";

export const peptideRoutes = new Hono<Env>();

peptideRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const db = c.get("db");
  const rows = await db.all<PeptideRow>(
    "SELECT * FROM peptides WHERE user_id = ? ORDER BY created_at ASC",
    [user.id],
  );
  return c.json({ peptides: rows.map(mapPeptide) });
});

peptideRoutes.post(
  "/",
  zValidator(
    "json",
    z.object({
      name: z.string().trim().min(1).max(80),
      unit: z.enum(PEPTIDE_UNITS),
      color: z.string().min(4).max(16).optional(),
    }),
  ),
  async (c) => {
    const user = requireUser(c);
    const body = c.req.valid("json");
    const db = c.get("db");
    const count = await db.get<{ n: number | bigint }>(
      "SELECT COUNT(*) as n FROM peptides WHERE user_id = ?",
      [user.id],
    );
    const color = body.color ?? PEPTIDE_COLORS[Number(count?.n ?? 0) % PEPTIDE_COLORS.length];
    const row: PeptideRow = {
      id: newId(),
      user_id: user.id,
      name: body.name,
      unit: body.unit,
      color,
      last_amount: null,
      schedule: serializePeptideSchedule(DEFAULT_PEPTIDE_SCHEDULE),
      created_at: new Date().toISOString(),
    };
    await db.run(
      "INSERT INTO peptides (id, user_id, name, unit, color, last_amount, schedule, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [row.id, row.user_id, row.name, row.unit, row.color, row.last_amount, row.schedule, row.created_at],
    );
    return c.json({ peptide: mapPeptide(row) }, 201);
  },
);

peptideRoutes.patch(
  "/:id",
  zValidator(
    "json",
    z.object({
      name: z.string().trim().min(1).max(80).optional(),
      unit: z.enum(PEPTIDE_UNITS).optional(),
      color: z.string().min(4).max(16).optional(),
      schedule: z
        .object({
          days: z.array(z.number().int().min(0).max(6)),
          morning: z.boolean(),
          evening: z.boolean(),
        })
        .optional(),
    }),
  ),
  async (c) => {
    const user = requireUser(c);
    const id = c.req.param("id");
    const db = c.get("db");
    const row = await db.get<PeptideRow>("SELECT * FROM peptides WHERE id = ? AND user_id = ?", [
      id,
      user.id,
    ]);
    if (!row) return c.json({ error: "Peptide not found." }, 404);
    const body = c.req.valid("json");
    const next = {
      ...row,
      name: body.name ?? row.name,
      unit: body.unit ?? row.unit,
      color: body.color ?? row.color,
      schedule: body.schedule ? serializePeptideSchedule(parsePeptideSchedule(body.schedule)) : row.schedule,
    };
    await db.run("UPDATE peptides SET name = ?, unit = ?, color = ?, schedule = ? WHERE id = ?", [
      next.name,
      next.unit,
      next.color,
      next.schedule,
      id,
    ]);
    return c.json({ peptide: mapPeptide(next) });
  },
);

peptideRoutes.delete("/:id", async (c) => {
  const user = requireUser(c);
  const db = c.get("db");
  await db.run("DELETE FROM peptides WHERE id = ? AND user_id = ?", [c.req.param("id"), user.id]);
  return c.json({ ok: true });
});

export const vialRoutes = new Hono<Env>();

vialRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const db = c.get("db");
  const rows = await db.all<VialRow>(
    "SELECT * FROM vials WHERE user_id = ? ORDER BY created_at DESC",
    [user.id],
  );
  return c.json({
    vials: rows.map((row) => {
      const vial = mapVial(row);
      const remaining = remainingInjections(vial);
      return { ...vial, remainingInjections: remaining, runwayTone: runwayTone(remaining) };
    }),
  });
});

vialRoutes.post(
  "/",
  zValidator(
    "json",
    z.object({
      peptideId: z.string().min(1),
      label: z.string().trim().max(80).nullable().optional(),
      totalAmount: z.number().positive(),
      remainingAmount: z.number().min(0).optional(),
      dose: z.number().positive(),
      openedOn: z.string().nullable().optional(),
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
    const remaining = body.remainingAmount ?? body.totalAmount;
    const row: VialRow = {
      id: newId(),
      user_id: user.id,
      peptide_id: body.peptideId,
      label: body.label ?? null,
      total_amount: body.totalAmount,
      remaining_amount: remaining,
      dose: body.dose,
      opened_on: body.openedOn ?? null,
      created_at: new Date().toISOString(),
    };
    await db.run(
      "INSERT INTO vials (id, user_id, peptide_id, label, total_amount, remaining_amount, dose, opened_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        row.id,
        row.user_id,
        row.peptide_id,
        row.label,
        row.total_amount,
        row.remaining_amount,
        row.dose,
        row.opened_on,
        row.created_at,
      ],
    );
    const vial = mapVial(row);
    const left = remainingInjections(vial);
    return c.json({ vial: { ...vial, remainingInjections: left, runwayTone: runwayTone(left) } }, 201);
  },
);
