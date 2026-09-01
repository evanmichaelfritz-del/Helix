import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import type { Peptide } from "@shared/types.ts";
import { scheduleSummary } from "@shared/schedule.ts";
import { client } from "../lib/api.ts";
import { useAppState } from "../lib/state.tsx";
import { PeptideSwatch, VialRunway } from "../components/Shell.tsx";
import { ChevronDown, PeptideScheduleEditor } from "../components/PeptideScheduleEditor.tsx";
import { SkeletonCards, useDelayedFlag } from "../components/Skeleton.tsx";

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
  const { openSheet, peptides, setPeptides, setVials, setDoses, vials, doses, bump, appDataReady } = useAppState();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const showSkeleton = useDelayedFlag(!appDataReady);

  async function removePeptide(peptide: Peptide) {
    setSaving(peptide.id);
    try {
      await client.deletePeptide(peptide.id);
      setPeptides(peptides.filter((p) => p.id !== peptide.id));
      setVials(vials.filter((v) => v.peptideId !== peptide.id));
      setDoses(doses.filter((d) => d.peptideId !== peptide.id));
      setExpanded(null);
      setConfirmDelete(null);
      bump();
    } finally {
      setSaving(null);
    }
  }

  if (!appDataReady) {
    return showSkeleton ? <SkeletonCards /> : null;
  }

  return (
    <>
      <div className="list">
        {peptides.map((p: Peptide) => {
          const open = expanded === p.id;
          const body = p.bodyEffect?.trim() || "";
          const notice = p.expectedResults?.trim() || "";
          const hasCopy = Boolean(body || notice);
          return (
            <div className="card vial-schedule-row" key={p.id}>
              <div className="list-row">
                <PeptideSwatch color={p.color} />
                <div className="meta" style={{ flex: 1, minWidth: 0 }}>
                  <strong>{p.name}</strong>
                  <div className="muted">
                    {p.unit}
                    {p.lastAmount != null ? ` · last ${p.lastAmount}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="expand-btn"
                  aria-expanded={open}
                  aria-label={`${open ? "Hide" : "Show"} details for ${p.name}`}
                  onClick={() => {
                    setExpanded(open ? null : p.id);
                    setConfirmDelete(null);
                  }}
                >
                  <ChevronDown open={open} />
                </button>
              </div>
              {open ? (
                <div className="schedule-panel">
                  <div className="schedule-editor">
                    <div className="schedule-block">
                      <span className="schedule-label">What it does</span>
                      <p className={body ? undefined : "muted"}>{body || "No description yet."}</p>
                    </div>
                    <div className="schedule-block">
                      <span className="schedule-label">What you may notice.</span>
                      <p className={notice ? undefined : "muted"}>{notice || "No description yet."}</p>
                    </div>
                    {hasCopy ? <p className="muted">Educational summary — not medical advice.</p> : null}
                  </div>
                  <p className="muted" style={{ marginTop: 14 }}>
                    This removes {p.name}, its vials, and its dose history.
                  </p>
                  {confirmDelete === p.id ? (
                    <button
                      type="button"
                      className="btn"
                      style={{ marginTop: 14 }}
                      disabled={saving === p.id}
                      onClick={() => void removePeptide(p)}
                    >
                      Delete this peptide
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ marginTop: 14 }}
                      disabled={saving === p.id}
                      onClick={() => setConfirmDelete(p.id)}
                    >
                      Delete peptide
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
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
  const { openSheet, peptides, vials, setPeptides, setVials, bump, appDataReady } = useAppState();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const showSkeleton = useDelayedFlag(!appDataReady);

  const rows = peptides
    .map((peptide) => {
      const vial = vials.find((v) => v.peptideId === peptide.id);
      if (!vial) return null;
      return { peptide, vial };
    })
    .filter((row): row is { peptide: Peptide; vial: (typeof vials)[number] } => row != null);

  if (!appDataReady) {
    return showSkeleton ? <SkeletonCards /> : null;
  }

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
  const { peptides, doses, appDataReady } = useAppState();
  const showSkeleton = useDelayedFlag(!appDataReady);
  if (!appDataReady) return showSkeleton ? <SkeletonCards /> : null;
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
