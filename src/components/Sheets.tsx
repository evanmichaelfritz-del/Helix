import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { stepperDelta } from "@shared/health.ts";
import { PEPTIDE_UNITS, todayLocal, type Peptide, type PeptideUnit } from "@shared/types.ts";
import { kgFromInput } from "../lib/format.ts";
import { ApiError, client } from "../lib/api.ts";
import { useAppState } from "../lib/state.tsx";

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
        {sheet.kind === "log-dose" ? <LogDoseSheet peptideId={sheet.peptideId} /> : null}
        {sheet.kind === "log-weight" ? <LogWeightSheet /> : null}
        {sheet.kind === "add-peptide" ? <AddPeptideSheet /> : null}
        {sheet.kind === "add-vial" ? <AddVialSheet peptideId={sheet.peptideId} /> : null}
      </div>
    </div>
  );
}

function LogDoseSheet({ peptideId }: { peptideId?: string }) {
  const { peptides, closeSheet, bump, showToast, openSheet } = useAppState();
  const peptide = peptides.find((p) => p.id === peptideId) ?? peptides[0];
  const [amount, setAmount] = useState(peptide?.lastAmount ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (peptide) setAmount(peptide.lastAmount ?? 0);
  }, [peptide]);

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
      <p className="unit">{peptide.unit}{peptide.lastAmount != null ? ` · last ${peptide.lastAmount}` : ""}</p>
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

function LogWeightSheet() {
  const { user, closeSheet, bump } = useAppState();
  const unit = user?.settings.weightUnit ?? "kg";
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
  const [total, setTotal] = useState("");
  const [dose, setDose] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    const totalAmount = Number(total);
    const doseAmt = Number(dose);
    if (!pid || !(totalAmount > 0) || !(doseAmt > 0)) {
      setError("Need peptide, vial amount, and dose.");
      return;
    }
    try {
      await client.createVial({
        peptideId: pid,
        totalAmount,
        dose: doseAmt,
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
        <span>Label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="field">
        <span>Amount in vial</span>
        <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
      </label>
      <label className="field">
        <span>Dose per injection</span>
        <input inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="btn" onClick={() => void save()}>
        Save
      </button>
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
