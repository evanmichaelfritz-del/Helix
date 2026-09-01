import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { stepperDelta } from "@shared/health.ts";
import { doseSheetMode } from "@shared/dose-sheet.ts";
import { SYRINGE_UNITS, type SyringeUnits } from "@shared/peptide-calc.ts";
import { PEPTIDE_UNITS, todayLocal, type Dose, type Peptide, type PeptideUnit } from "@shared/types.ts";
import { cn } from "@shared/cn.ts";
import { kgFromInput } from "../lib/format.ts";
import { ApiError, client } from "../lib/api.ts";
import { useAppState } from "../lib/state.tsx";

export function Sheets() {
  const { sheet, closeSheet } = useAppState();
  useEffect(() => {
    if (!sheet) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeSheet();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, closeSheet]);
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
        {sheet.kind === "log-dose" ? <LogDoseSheet peptideId={sheet.peptideId} /> : null}
        {sheet.kind === "log-weight" ? <LogWeightSheet /> : null}
        {sheet.kind === "add-peptide" ? <AddPeptideSheet returnTo={sheet.returnTo} /> : null}
        {sheet.kind === "add-vial" ? <AddVialSheet peptideId={sheet.peptideId} /> : null}
      </div>
    </div>
  );
}

function SheetCancel() {
  const { closeSheet } = useAppState();
  return (
    <button className="btn ghost" type="button" onClick={closeSheet}>
      Cancel
    </button>
  );
}

function LogDoseSheet({ peptideId }: { peptideId?: string }) {
  const { peptides, closeSheet, bump, showToast, openSheet } = useAppState();
  const [todayDoses, setTodayDoses] = useState<Dose[] | null>(null);
  const [amount, setAmount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .doses(todayLocal())
      .then((r) => {
        if (!cancelled) setTodayDoses(r.doses.filter((d) => !d.undone));
      })
      .catch(() => {
        if (!cancelled) setTodayDoses([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loggedIds = new Set((todayDoses ?? []).map((d) => d.peptideId));
  const peptide =
    (peptideId ? peptides.find((p) => p.id === peptideId) : undefined) ??
    peptides.find((p) => !loggedIds.has(p.id)) ??
    peptides[0];

  useEffect(() => {
    if (peptide) setAmount(peptide.lastAmount ?? 0);
  }, [peptide]);

  if (!peptide) {
    return (
      <>
        <h2>Log dose</h2>
        <p className="muted">Add a peptide first.</p>
        <div className="row-btns">
          <button className="btn" onClick={() => openSheet({ kind: "add-peptide", returnTo: "log-dose" })}>
            Add a peptide
          </button>
          <SheetCancel />
        </div>
      </>
    );
  }

  const logged = (todayDoses ?? []).find((d) => d.peptideId === peptide.id);
  const mode = doseSheetMode(logged);

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
          <SheetCancel />
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
        loggedOn: todayLocal(),
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
      <div className="row-btns">
        <button className="btn" disabled={saving || amount <= 0} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </button>
        <SheetCancel />
      </div>
    </>
  );
}

function roundAmt(n: number, unit: PeptideUnit): number {
  const places = unit === "mcg" ? 0 : 2;
  return Number(n.toFixed(places));
}

function LogWeightSheet() {
  const { user, closeSheet, bump } = useAppState();
  const unit = user?.settings.weightUnit ?? "lb";
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a weight.");
      return;
    }
    try {
      await client.logWeight({ kg: kgFromInput(n, unit), loggedOn: todayLocal() });
      closeSheet();
      bump();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save weight.");
    }
  }
  return (
    <>
      <h2>Log weight</h2>
      <label className="field">
        <span>Today ({unit})</span>
        <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <div className="row-btns">
        <button className="btn" onClick={() => void save()}>
          Save
        </button>
        <SheetCancel />
      </div>
    </>
  );
}

function AddPeptideSheet({ returnTo }: { returnTo?: "log-dose" }) {
  const { closeSheet, bump, setPeptides, peptides, openSheet } = useAppState();
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
      bump();
      if (returnTo === "log-dose") {
        openSheet({ kind: "log-dose", peptideId: peptide.id });
      } else {
        closeSheet();
      }
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
      <div className="row-btns">
        <button className="btn" onClick={() => void save()}>
          Save
        </button>
        <SheetCancel />
      </div>
    </>
  );
}

function AddVialSheet({ peptideId }: { peptideId?: string }) {
  const { peptides, closeSheet, bump } = useAppState();
  const [pid, setPid] = useState(peptideId ?? peptides[0]?.id ?? "");
  const [total, setTotal] = useState("");
  const [bac, setBac] = useState("");
  const [dose, setDose] = useState("");
  const [label, setLabel] = useState("");
  const [syringe, setSyringe] = useState<SyringeUnits>(30);
  const [error, setError] = useState<string | null>(null);
  if (peptides.length === 0) {
    return (
      <>
        <h2>Add vial</h2>
        <p className="muted">Add a peptide first.</p>
        <div className="row-btns">
          <Link className="btn" to="/protocol/peptides">
            Peptide library
          </Link>
          <SheetCancel />
        </div>
      </>
    );
  }
  async function save() {
    const totalAmount = Number(total);
    const bacMl = Number(bac);
    const doseAmt = Number(dose);
    if (!pid || !(totalAmount > 0) || !(bacMl > 0) || !(doseAmt > 0)) {
      setError("Need peptide, amount, BAC water, and dose.");
      return;
    }
    try {
      await client.createVial({
        peptideId: pid,
        totalAmount,
        dose: doseAmt,
        bacMl,
        syringeUnits: syringe,
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
        <span>Amount mg</span>
        <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
      </label>
      <label className="field">
        <span>BAC water mL</span>
        <input inputMode="decimal" value={bac} onChange={(e) => setBac(e.target.value)} />
      </label>
      <label className="field">
        <span>Dose</span>
        <input inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} />
      </label>
      <label className="field">
        <span>Label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <div className="field">
        <span>Syringe</span>
        <div className="day-pills" role="group" aria-label="Syringe">
          {SYRINGE_UNITS.map((size) => (
            <button
              key={size}
              type="button"
              className={cn("day-pill", size === syringe && "on")}
              onClick={() => setSyringe(size)}
            >
              {size}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="row-btns">
        <button className="btn" onClick={() => void save()}>
          Save
        </button>
        <SheetCancel />
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
