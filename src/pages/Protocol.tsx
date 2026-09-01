import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import type { Peptide } from "@shared/types.ts";
import { scheduleSummary } from "@shared/schedule.ts";
import { client } from "../lib/api.ts";
import { useAppState } from "../lib/state.tsx";
import { PeptideSwatch, VialRunway } from "../components/Shell.tsx";
import { ChevronDown, PeptideScheduleEditor } from "../components/PeptideScheduleEditor.tsx";

export function ProtocolLayout() {
  return (
    <>
      <h1>Protocol</h1>
      <nav className="subnav">
        <NavLink to="/protocol/vials">Vials</NavLink>
        <NavLink to="/protocol/peptides">Library</NavLink>
        <NavLink to="/protocol/calc">Calculator</NavLink>
        <NavLink to="/protocol/log">Log</NavLink>
      </nav>
      <Outlet />
    </>
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

function remainingLine(vial: { label: string | null; remainingInjections: number }): string {
  const left = `${vial.remainingInjections} remaining`;
  return vial.label ? `${vial.label} · ${left}` : left;
}

export function VialsPage() {
  const { openSheet, peptides, vials, setPeptides, setVials, bump } = useAppState();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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

  async function removeVial(id: string) {
    setSaving(id);
    try {
      await client.deleteVial(id);
      setVials(vials.filter((v) => v.id !== id));
      setExpanded(null);
      setConfirmDelete(null);
      bump();
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
                  <div className="muted">{remainingLine(vial)}</div>
                </div>
                <VialRunway remaining={vial.remainingInjections} tone={vial.runwayTone} />
                <button
                  type="button"
                  className="expand-btn"
                  aria-expanded={open}
                  aria-label={`${open ? "Hide" : "Show"} schedule for ${peptide.name}`}
                  onClick={() => {
                    setExpanded(open ? null : peptide.id);
                    setConfirmDelete(null);
                  }}
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
                  {confirmDelete === vial.id ? (
                    <button
                      type="button"
                      className="btn"
                      style={{ marginTop: 14 }}
                      disabled={saving === vial.id}
                      onClick={() => void removeVial(vial.id)}
                    >
                      Delete this vial
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ marginTop: 14 }}
                      disabled={saving === vial.id}
                      onClick={() => setConfirmDelete(vial.id)}
                    >
                      Delete vial
                    </button>
                  )}
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
