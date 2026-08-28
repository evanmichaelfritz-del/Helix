import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import type { Peptide } from "@shared/types.ts";
import { remainingInjections, runwayTone, isPeptideScheduledToday } from "@shared/health.ts";
import { scheduleSummary } from "@shared/schedule.ts";
import { todayLocal } from "@shared/types.ts";
import { client } from "../lib/api.ts";
import { useAppState } from "../lib/state.tsx";
import { PeptideSwatch, VialRunway } from "../components/Shell.tsx";
import { ChevronDown, PeptideScheduleEditor } from "../components/PeptideScheduleEditor.tsx";

export function ProtocolLayout() {
  return (
    <>
      <h1>Protocol</h1>
      <nav className="subnav">
        <NavLink to="/protocol" end>
          Next
        </NavLink>
        <NavLink to="/protocol/peptides">Library</NavLink>
        <NavLink to="/protocol/vials">Vials</NavLink>
        <NavLink to="/protocol/log">Log</NavLink>
      </nav>
      <Outlet />
    </>
  );
}

export function ProtocolHome() {
  const { bump, openSheet, peptides, vials, doses } = useAppState();
  const on = todayLocal();
  const dosesToday = doses.filter((d) => d.loggedOn === on);

  if (peptides.length === 0) {
    return (
      <article className="card today-hero">
        <p className="kicker">Next dose</p>
        <button className="import-empty" type="button" onClick={() => openSheet({ kind: "add-peptide" })}>
          Add a peptide
        </button>
      </article>
    );
  }

  const logged = new Set(dosesToday.filter((d) => !d.undone).map((d) => d.peptideId));
  const scheduled = peptides.filter((p) => isPeptideScheduledToday(p.schedule, on));
  const pool = scheduled.length > 0 ? scheduled : peptides;
  const due = pool.find((p) => !logged.has(p.id));
  const peptide = due ?? pool[0];
  const vial = vials.find((v) => v.peptideId === peptide.id) ?? null;
  const remaining = vial ? remainingInjections(vial) : null;
  const loggedDose = dosesToday.find((d) => d.peptideId === peptide.id && !d.undone);
  const amount = loggedDose?.amount ?? peptide.lastAmount ?? vial?.dose ?? 0;
  const status = due ? "Due today" : "Logged";

  async function undoLogged() {
    if (!loggedDose) return;
    await client.undoDose(loggedDose.id);
    bump();
  }

  return (
    <article className="card protocol-hero">
      <p className="kicker">Next dose</p>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 12 }}>
        <PeptideSwatch color={peptide.color} />
        <div>
          <div className="hero-value" style={{ fontSize: 40, margin: 0 }}>
            {amount} <span style={{ fontSize: 18 }}>{peptide.unit}</span>
          </div>
          <p className="hero-label">
            {peptide.name} · {status}
          </p>
        </div>
      </div>
      {vial ? (
        <div style={{ marginTop: 16 }}>
          <p className="muted">{vial.label || "Current vial"}</p>
          <VialRunway remaining={remaining} tone={remaining == null ? null : runwayTone(remaining)} />
        </div>
      ) : (
        <button className="btn ghost" style={{ marginTop: 16 }} type="button" onClick={() => openSheet({ kind: "add-vial", peptideId: peptide.id })}>
          Add a vial
        </button>
      )}
      {loggedDose ? (
        <div className="row-btns" style={{ marginTop: 16 }}>
          <button className="btn" type="button" onClick={() => void undoLogged()}>
            Undo
          </button>
        </div>
      ) : (
        <button
          className="btn"
          style={{ marginTop: 16 }}
          type="button"
          onClick={() => openSheet({ kind: "log-dose", peptideId: peptide.id })}
        >
          Log dose
        </button>
      )}
    </article>
  );
}

export function PeptidesPage() {
  const { openSheet, peptides } = useAppState();
  return (
    <>
      <div className="list">
        {peptides.map((p: Peptide) => (
          <div className="card list-row" key={p.id}>
            <PeptideSwatch color={p.color} />
            <div className="meta">
              <strong>{p.name}</strong>
              <div className="muted">
                {p.unit}
                {p.lastAmount != null ? ` · last ${p.lastAmount}` : ""}
              </div>
            </div>
          </div>
        ))}
      </div>
      <button className="btn" style={{ marginTop: 16 }} type="button" onClick={() => openSheet({ kind: "add-peptide" })}>
        Add a peptide
      </button>
    </>
  );
}

export function VialsPage() {
  const { openSheet, peptides, vials, setPeptides } = useAppState();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const rows = peptides
    .map((peptide) => {
      const vial = vials.find((v) => v.peptideId === peptide.id);
      if (!vial) return null;
      return { peptide, vial };
    })
    .filter((row): row is { peptide: Peptide; vial: (typeof vials)[number] } => row != null);

  async function saveSchedule(peptide: Peptide, schedule: Peptide["schedule"]) {
    setSaving(peptide.id);
    try {
      const { peptide: updated } = await client.updatePeptide(peptide.id, { schedule });
      setPeptides(peptides.map((p) => (p.id === updated.id ? updated : p)));
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <div className="list">
        {rows.map(({ peptide, vial }) => {
          const open = expanded === peptide.id;
          return (
            <div className="card vial-schedule-row" key={peptide.id}>
              <div className="list-row">
                <PeptideSwatch color={peptide.color} />
                <div className="meta" style={{ flex: 1, minWidth: 0 }}>
                  <strong>{peptide.name}</strong>
                  <div className="muted">{scheduleSummary(peptide.schedule)}</div>
                  <div className="muted">{vial.label || `${vial.remainingAmount} remaining`}</div>
                </div>
                <VialRunway remaining={vial.remainingInjections} tone={vial.runwayTone} />
                <button
                  type="button"
                  className="expand-btn"
                  aria-expanded={open}
                  aria-label={`${open ? "Hide" : "Show"} schedule for ${peptide.name}`}
                  onClick={() => setExpanded(open ? null : peptide.id)}
                >
                  <ChevronDown open={open} />
                </button>
              </div>
              {open ? (
                <div className="schedule-panel">
                  <PeptideScheduleEditor
                    schedule={peptide.schedule}
                    disabled={saving === peptide.id}
                    onChange={(schedule) => void saveSchedule(peptide, schedule)}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <button className="btn" style={{ marginTop: 16 }} type="button" onClick={() => openSheet({ kind: "add-vial" })}>
        Add vial
      </button>
    </>
  );
}

export function DoseLogPage() {
  const { peptides, doses } = useAppState();
  return (
    <div className="list">
      {doses.length === 0 ? <p className="muted">No doses yet.</p> : null}
      {doses.map((d) => {
        const p = peptides.find((x) => x.id === d.peptideId);
        return (
          <div className="card list-row" key={d.id}>
            {p ? <PeptideSwatch color={p.color} /> : null}
            <div className="meta">
              <strong>
                {d.amount} {d.unit} {p?.name ?? ""}
              </strong>
              <div className="muted">{d.loggedOn}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
