import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import type { Dose, Peptide, Vial } from "@shared/types.ts";
import { remainingInjections, runwayTone } from "@shared/health.ts";
import { todayLocal } from "@shared/types.ts";
import { vialMath, type MixUnit, type SyringeCap } from "@shared/vial-math.ts";
import { client } from "../lib/api.ts";
import { useAppState } from "../lib/state.tsx";
import { PeptideSwatch, VialRunway } from "../components/Shell.tsx";
import { IconChevron } from "../components/icons.tsx";
import { MixReadout, MixUnitSelect, SyringeChips, SyringeRuler } from "../components/Syringe.tsx";

export function ProtocolLayout() {
  return (
    <>
      <h1>Protocol</h1>
      <nav className="subnav">
        <NavLink to="/protocol" end>
          Next
        </NavLink>
        <NavLink to="/protocol/vials">Vials</NavLink>
        <NavLink to="/calendar">Cal</NavLink>
        <NavLink to="/protocol/log">Log</NavLink>
        <NavLink to="/protocol/peptides">Library</NavLink>
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
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    client.peptides().then((r) => setPeptides(r.peptides)).catch(() => undefined);
  }, [gen, setPeptides]);
  return (
    <>
      <div className="list">
        {peptides.map((p: Peptide) => {
          const open = openId === p.id;
          const hasCopy = Boolean(p.bodyEffect || p.expectedResults);
          return (
            <div className="card peps-card" key={p.id}>
              <button
                type="button"
                className="list-row peps-toggle"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : p.id)}
              >
                <PeptideSwatch color={p.color} />
                <div className="meta">
                  <strong>{p.name}</strong>
                  <div className="muted">
                    {p.unit}
                    {p.lastAmount != null ? ` · last ${p.lastAmount}` : ""}
                  </div>
                </div>
                <IconChevron open={open} />
              </button>
              {open ? (
                <div className="peps-expand">
                  {p.bodyEffect ? <p className="peps-copy">{p.bodyEffect}</p> : null}
                  {p.expectedResults ? <p className="peps-copy">{p.expectedResults}</p> : null}
                  {hasCopy ? <p className="muted peps-disclaimer">Educational summary — not medical advice.</p> : <p className="muted">No description yet.</p>}
                  <button className="btn" type="button" onClick={() => openSheet({ kind: "start-vial", peptideId: p.id })}>
                    Start new vial
                  </button>
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

type ListedVial = Vial & { remainingInjections: number; runwayTone: "ok" | "amber" | "red" };

export function VialsPage() {
  const { gen, openSheet, peptides, setPeptides } = useAppState();
  const [tab, setTab] = useState<"log" | "play">("log");
  const [vials, setVials] = useState<ListedVial[]>([]);
  useEffect(() => {
    client.vials().then((r) => setVials(r.vials)).catch(() => undefined);
    client.peptides().then((r) => setPeptides(r.peptides)).catch(() => undefined);
  }, [gen, setPeptides]);
  return (
    <>
      <div className="tabs vial-tabs">
        <button type="button" className={tab === "log" ? "on" : undefined} onClick={() => setTab("log")}>
          Vial log
        </button>
        <button type="button" className={tab === "play" ? "on" : undefined} onClick={() => setTab("play")}>
          Syringe playground
        </button>
      </div>
      {tab === "play" ? (
        <Playground peptides={peptides} />
      ) : (
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
      )}
    </>
  );
}

function Playground({ peptides }: { peptides: Peptide[] }) {
  const [mg, setMg] = useState("30");
  const [bacMl, setBacMl] = useState("2");
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState<MixUnit>("mg");
  const [syringeUnits, setSyringeUnits] = useState<SyringeCap>(100);
  const color = peptides[0]?.color;
  const math = vialMath({
    mg: Number(mg),
    bacMl: Number(bacMl),
    dose: Number(dose),
    unit,
    syringeUnits,
  });
  return (
    <article className="card mix-card">
      <p className="muted">Try a mix before it hits the vial log. Numbers update the syringe live.</p>
      <SyringeChips value={syringeUnits} onChange={setSyringeUnits} />
      {math ? <SyringeRuler drawUnits={math.drawUnits} maxUnits={syringeUnits} color={color} /> : null}
      {math ? <MixReadout math={math} dose={Number(dose)} unit={unit} /> : null}
      <label className="field">
        <span>Vial (mg)</span>
        <input inputMode="decimal" value={mg} onChange={(e) => setMg(e.target.value)} />
      </label>
      <label className="field">
        <span>BAC (mL)</span>
        <input inputMode="decimal" value={bacMl} onChange={(e) => setBacMl(e.target.value)} />
      </label>
      <label className="field">
        <span>Dose</span>
        <input inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} />
      </label>
      <label className="field">
        <span>Unit</span>
        <MixUnitSelect value={unit} onChange={setUnit} />
      </label>
    </article>
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
