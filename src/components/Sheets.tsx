import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { stepperDelta } from "@shared/health.ts";
import { doseSheetMode } from "@shared/dose-sheet.ts";
import { PEPTIDE_UNITS, todayLocal, type Dose, type Peptide, type PeptideUnit, type Vial } from "@shared/types.ts";
import { asMixUnit, compactNum, lastMixFor, vialMath, type MixUnit, type SyringeCap } from "@shared/vial-math.ts";
import { kgFromInput } from "../lib/format.ts";
import { ApiError, client } from "../lib/api.ts";
import { useAppState } from "../lib/state.tsx";
import { MixReadout, MixUnitSelect, SyringeChips, SyringeRuler } from "./Syringe.tsx";

export function Sheets() {
  const { sheet, closeSheet } = useAppState();
  if (!sheet) return null;
  return (
    <div className="sheet-backdrop" onClick={closeSheet} role="presentation">
      <div
        className="sheet card"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="handle" />
        {sheet.kind === "log-dose" ? <LogDoseSheet peptideId={sheet.peptideId} loggedOn={sheet.loggedOn} /> : null}
        {sheet.kind === "log-weight" ? <LogWeightSheet loggedOn={sheet.loggedOn} /> : null}
        {sheet.kind === "add-peptide" ? <AddPeptideSheet /> : null}
        {sheet.kind === "add-vial" ? <AddVialSheet peptideId={sheet.peptideId} /> : null}
        {sheet.kind === "start-vial" ? <StartVialSheet peptideId={sheet.peptideId} /> : null}
      </div>
    </div>
  );
}

function LogDoseSheet({ peptideId, loggedOn }: { peptideId?: string; loggedOn?: string }) {
  const { peptides, closeSheet, bump, showToast, openSheet } = useAppState();
  const on = loggedOn ?? todayLocal();
  const [dayDoses, setDayDoses] = useState<Dose[] | null>(null);
  const [vials, setVials] = useState<Vial[]>([]);
  const [amount, setAmount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .doses(on)
      .then((r) => {
        if (!cancelled) setDayDoses(r.doses.filter((d) => !d.undone));
      })
      .catch(() => {
        if (!cancelled) setDayDoses([]);
      });
    client.vials().then((r) => {
      if (!cancelled) setVials(r.vials);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [on]);

  const loggedIds = new Set((dayDoses ?? []).map((d) => d.peptideId));
  const peptide =
    (peptideId ? peptides.find((p) => p.id === peptideId) : undefined) ??
    peptides.find((p) => !loggedIds.has(p.id)) ??
    peptides[0];

  useEffect(() => {
    if (peptide) setAmount(peptide.lastAmount ?? 0);
  }, [peptide]);

  if (dayDoses == null) {
    return (
      <>
        <h2>Log dose</h2>
        <p className="muted">Loading…</p>
      </>
    );
  }

  if (!peptide) {
    return (
      <>
        <h2>Log dose</h2>
        <p className="muted">Add a peptide first.</p>
        <button className="btn" onClick={() => openSheet({ kind: "add-peptide" })}>
          Add a peptide
        </button>
      </>
    );
  }

  const logged = dayDoses.find((d) => d.peptideId === peptide.id);
  const mode = doseSheetMode(logged);
  const vial = vials.find((v) => v.peptideId === peptide.id);
  const mixUnit = asMixUnit(peptide.unit);
  const math =
    vial && vial.bacMl != null
      ? vialMath({
          mg: vial.totalAmount,
          bacMl: vial.bacMl,
          dose: amount > 0 ? amount : vial.dose,
          unit: mixUnit,
          syringeUnits: vial.syringeUnits,
        })
      : null;

  async function undo() {
    if (mode.kind !== "undo") return;
    setSaving(true);
    setError(null);
    try {
      await client.undoDose(mode.doseId);
      closeSheet();
      bump();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not undo.");
    } finally {
      setSaving(false);
    }
  }

  if (mode.kind === "undo") {
    return (
      <>
        <h2>Logged {peptide.name}</h2>
        <p className="unit">
          {mode.amount} {mode.unit}
        </p>
        {error ? <p className="error">{error}</p> : null}
        <div className="row-btns">
          <button className="btn" disabled={saving} onClick={() => void undo()}>
            {saving ? "Undoing…" : "Undo"}
          </button>
          <button className="btn ghost" type="button" onClick={closeSheet}>
            Close
          </button>
        </div>
      </>
    );
  }

  const delta = stepperDelta(peptide.unit);
  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { dose } = await client.logDose({
        peptideId: peptide.id,
        amount,
        loggedOn: on,
      });
      closeSheet();
      bump();
      showToast({
        message: `Logged ${amount} ${peptide.unit} ${peptide.name}`,
        undo: async () => {
          await client.undoDose(dose.id);
          bump();
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log dose.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h2>Log {peptide.name}</h2>
      {math ? <span className="draw-chip">{compactNum(math.drawUnits)} u</span> : null}
      <div className="stepper">
        <button type="button" onClick={() => setAmount((n) => Math.max(0, roundAmt(n - delta, peptide.unit)))} aria-label="Decrease">
          −
        </button>
        <input
          inputMode="decimal"
          value={String(amount)}
          onChange={(e) => setAmount(Number(e.target.value) || 0)}
        />
        <button type="button" onClick={() => setAmount((n) => roundAmt(n + delta, peptide.unit))} aria-label="Increase">
          +
        </button>
      </div>
      <p className="unit">
        {peptide.unit}
        {peptide.lastAmount != null ? ` · last ${peptide.lastAmount}` : ""}
      </p>
      {error ? <p className="error">{error}</p> : null}
      <button className="btn" disabled={saving || amount <= 0} onClick={() => void save()}>
        {saving ? "Saving…" : "Save"}
      </button>
    </>
  );
}

function roundAmt(n: number, unit: PeptideUnit): number {
  const places = unit === "mcg" ? 0 : 2;
  return Number(n.toFixed(places));
}

function LogWeightSheet({ loggedOn }: { loggedOn?: string }) {
  const { user, closeSheet, bump } = useAppState();
  const on = loggedOn ?? todayLocal();
  const unit = user?.settings.weightUnit ?? "kg";
  const [value, setValue] = useState("");
  const [existing, setExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .weighIns()
      .then((r) => {
        if (cancelled) return;
        const row = r.weighIns.find((w) => w.loggedOn === on);
        if (row) {
          setExisting(true);
          setValue(unit === "lb" ? (row.kg * 2.20462262).toFixed(1) : row.kg.toFixed(1));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [on, unit]);

  async function save() {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a weight.");
      return;
    }
    try {
      await client.logWeight({ kg: kgFromInput(n, unit), loggedOn: on });
      closeSheet();
      bump();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save weight.");
    }
  }
  return (
    <>
      <h2>{existing ? "Edit weight" : "Log weight"}</h2>
      <label className="field">
        <span>
          {on} ({unit})
        </span>
        <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="btn" onClick={() => void save()}>
        Save
      </button>
    </>
  );
}

function AddPeptideSheet() {
  const { closeSheet, bump, setPeptides, peptides } = useAppState();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<PeptideUnit>("mcg");
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!name.trim()) {
      setError("Name the peptide.");
      return;
    }
    try {
      const { peptide } = await client.createPeptide({ name: name.trim(), unit });
      setPeptides([...peptides, peptide]);
      closeSheet();
      bump();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add peptide.");
    }
  }
  return (
    <>
      <h2>Add a peptide</h2>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Unit</span>
        <select value={unit} onChange={(e) => setUnit(e.target.value as PeptideUnit)}>
          {PEPTIDE_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="btn" onClick={() => void save()}>
        Save
      </button>
    </>
  );
}

function AddVialSheet({ peptideId }: { peptideId?: string }) {
  const { peptides, closeSheet, bump } = useAppState();
  const [pid, setPid] = useState(peptideId ?? peptides[0]?.id ?? "");
  const peptide = peptides.find((p) => p.id === pid);
  const [mg, setMg] = useState("");
  const [bacMl, setBacMl] = useState("");
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState<MixUnit>(asMixUnit(peptide?.unit));
  const [mixedOn, setMixedOn] = useState<string>(todayLocal());
  const [label, setLabel] = useState("");
  const [syringeUnits, setSyringeUnits] = useState<SyringeCap>(100);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!peptide) return;
    setUnit(asMixUnit(peptide.unit));
    if (peptide.lastAmount != null && peptide.lastAmount > 0) setDose(String(peptide.lastAmount));
  }, [peptide]);

  const math = vialMath({
    mg: Number(mg),
    bacMl: Number(bacMl),
    dose: Number(dose),
    unit,
    syringeUnits,
  });

  if (peptides.length === 0) {
    return (
      <>
        <h2>Add vial</h2>
        <p className="muted">Add a peptide first.</p>
        <Link to="/protocol/peptides">Peptide library</Link>
      </>
    );
  }
  async function save() {
    const totalAmount = Number(mg);
    const doseAmt = Number(dose);
    const bac = Number(bacMl);
    if (!pid || !(totalAmount > 0) || !(doseAmt > 0) || !(bac > 0)) {
      setError("Need peptide, vial amount, BAC, and dose.");
      return;
    }
    try {
      await client.createVial({
        peptideId: pid,
        totalAmount,
        dose: doseAmt,
        bacMl: bac,
        mixedOn,
        openedOn: mixedOn,
        syringeUnits,
        label: label.trim() || null,
      });
      closeSheet();
      bump();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add vial.");
    }
  }
  return (
    <>
      <h2>Add vial</h2>
      <SyringeChips value={syringeUnits} onChange={setSyringeUnits} />
      {math ? <SyringeRuler drawUnits={math.drawUnits} maxUnits={syringeUnits} color={peptide?.color} /> : null}
      {math ? <MixReadout math={math} dose={Number(dose)} unit={unit} /> : null}
      <label className="field">
        <span>Peptide</span>
        <select value={pid} onChange={(e) => setPid(e.target.value)}>
          {peptides.map((p: Peptide) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
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
      <label className="field">
        <span>Mixed on</span>
        <input type="date" value={mixedOn} onChange={(e) => setMixedOn(e.target.value)} />
      </label>
      <label className="field">
        <span>Label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="btn" onClick={() => void save()}>
        Save
      </button>
    </>
  );
}

function StartVialSheet({ peptideId }: { peptideId: string }) {
  const { peptides, closeSheet, bump } = useAppState();
  const peptide = peptides.find((p) => p.id === peptideId);
  const [vials, setVials] = useState<Vial[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = todayLocal();

  useEffect(() => {
    client.vials().then((r) => setVials(r.vials)).catch(() => setVials([]));
  }, []);

  if (!peptide) {
    return (
      <>
        <h2>Start a vial today?</h2>
        <p className="muted">Peptide not found.</p>
      </>
    );
  }
  if (vials == null) {
    return (
      <>
        <h2>Start a vial today?</h2>
        <p className="muted">Loading…</p>
      </>
    );
  }

  const mix = lastMixFor(peptide, vials);
  const math = vialMath({
    mg: mix.mg,
    bacMl: mix.bacMl,
    dose: mix.dose,
    unit: mix.unit,
    syringeUnits: mix.syringeUnits,
  });

  async function start() {
    setSaving(true);
    setError(null);
    try {
      await client.createVial({
        peptideId,
        totalAmount: mix.mg,
        dose: mix.dose,
        bacMl: mix.bacMl,
        mixedOn: on,
        openedOn: on,
        syringeUnits: mix.syringeUnits,
      });
      closeSheet();
      bump();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start vial.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h2>Start a vial today?</h2>
      <p className="muted">
        Add a {peptide.name} vial for {on}
        {mix.fromLast ? " using your last mix." : " with a default mix — you can edit it under Vials."}
      </p>
      <dl className="mix-dl">
        <div>
          <dt>Vial</dt>
          <dd>{compactNum(mix.mg)} mg</dd>
        </div>
        <div>
          <dt>BAC</dt>
          <dd>{compactNum(mix.bacMl)} mL</dd>
        </div>
        <div>
          <dt>Dose</dt>
          <dd>
            {compactNum(mix.dose)}
            {mix.unit}
          </dd>
        </div>
        <div>
          <dt>Draw</dt>
          <dd>{math ? `${compactNum(math.drawUnits)} u` : "—"}</dd>
        </div>
      </dl>
      {error ? <p className="error">{error}</p> : null}
      <div className="row-btns">
        <button className="btn ghost" type="button" onClick={closeSheet}>
          Cancel
        </button>
        <button className="btn" type="button" disabled={saving} onClick={() => void start()}>
          {saving ? "Starting…" : "Start vial"}
        </button>
      </div>
    </>
  );
}

export function ToastBar() {
  const { toast, clearToast } = useAppState();
  if (!toast) return null;
  return (
    <div className="toast card" role="status">
      <span>{toast.message}</span>
      {toast.undo ? (
        <button
          type="button"
          onClick={() => {
            void toast.undo?.().then(clearToast);
          }}
        >
          Undo
        </button>
      ) : (
        <button type="button" onClick={clearToast}>
          Ok
        </button>
      )}
    </div>
  );
}
