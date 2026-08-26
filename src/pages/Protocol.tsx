import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import type { Dose, Peptide, Vial } from "@shared/types.ts";
import { remainingInjections, runwayTone } from "@shared/health.ts";
import { todayLocal } from "@shared/types.ts";
import { client } from "../lib/api.ts";
import { useAppState } from "../lib/state.tsx";
import { PeptideSwatch, VialRunway } from "../components/Shell.tsx";

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
  const { gen, bump, openSheet, setPeptides, peptides } = useAppState();
  const [vials, setVials] = useState<Vial[]>([]);
  const [doses, setDoses] = useState<Dose[]>([]);
  const on = todayLocal();

  useEffect(() => {
    client.peptides().then((r) => setPeptides(r.peptides)).catch(() => undefined);
    client.vials().then((r) => setVials(r.vials)).catch(() => undefined);
    client.doses(on).then((r) => setDoses(r.doses)).catch(() => undefined);
  }, [gen, on, setPeptides]);

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

  const logged = new Set(doses.filter((d) => !d.undone).map((d) => d.peptideId));
  const due = peptides.find((p) => !logged.has(p.id));
  const peptide = due ?? peptides[0];
  const vial = vials.find((v) => v.peptideId === peptide.id) ?? null;
  const remaining = vial ? remainingInjections(vial) : null;
  const loggedDose = doses.find((d) => d.peptideId === peptide.id && !d.undone);
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
  const { gen, openSheet, setPeptides, peptides } = useAppState();
  useEffect(() => {
    client.peptides().then((r) => setPeptides(r.peptides)).catch(() => undefined);
  }, [gen, setPeptides]);
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
  const { gen, openSheet } = useAppState();
  const [vials, setVials] = useState<
    Array<Vial & { remainingInjections: number; runwayTone: "ok" | "amber" | "red" }>
  >([]);
  const { peptides, setPeptides } = useAppState();
  useEffect(() => {
    client.vials().then((r) => setVials(r.vials)).catch(() => undefined);
    client.peptides().then((r) => setPeptides(r.peptides)).catch(() => undefined);
  }, [gen, setPeptides]);
  return (
    <>
      <div className="list">
        {vials.map((v) => {
          const peptide = peptides.find((p) => p.id === v.peptideId);
          return (
            <div className="card list-row" key={v.id}>
              {peptide ? <PeptideSwatch color={peptide.color} /> : null}
              <div className="meta" style={{ flex: 1 }}>
                <strong>{peptide?.name ?? "Vial"}</strong>
                <div className="muted">{v.label || `${v.remainingAmount} remaining`}</div>
              </div>
              <VialRunway remaining={v.remainingInjections} tone={v.runwayTone} />
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
  const { gen } = useAppState();
  const [doses, setDoses] = useState<Dose[]>([]);
  const [peptides, setPeptides] = useState<Peptide[]>([]);
  useEffect(() => {
    client.doses().then((r) => setDoses(r.doses)).catch(() => undefined);
    client.peptides().then((r) => setPeptides(r.peptides)).catch(() => undefined);
  }, [gen]);
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

