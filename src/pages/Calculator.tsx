import { useMemo, useState } from "react";
import {
  convertDose,
  convertWater,
  DOSE_UNITS,
  doseToMg,
  formatMgMl,
  formatMl,
  formatUnits,
  formulateDraw,
  formulateReverse,
  isDoseUnit,
  isWaterUnit,
  MAX_CALC_PEPTIDES,
  parsePositive,
  SYRINGE_UNITS,
  syringeTicks,
  vialAmountToMg,
  WATER_UNITS,
  waterToMl,
  type DoseUnit,
  type SyringeUnits,
  type WaterUnit,
} from "@shared/peptide-calc.ts";
import { cn } from "@shared/cn.ts";
import { useAppState } from "../lib/state.tsx";

type PeptideRow = {
  key: string;
  mg: string;
  dose: string;
};

type Mode = "draw" | "reverse";

function newRow(partial?: Partial<PeptideRow>): PeptideRow {
  return {
    key: `p${Math.random().toString(36).slice(2, 8)}`,
    mg: "5",
    dose: "250",
    ...partial,
  };
}

export function CalculatorPage() {
  const [mode, setMode] = useState<Mode>("draw");
  return (
    <>
      <div className="tabs">
        <button type="button" className={mode === "draw" ? "on" : undefined} onClick={() => setMode("draw")}>
          Draw
        </button>
        <button type="button" className={mode === "reverse" ? "on" : undefined} onClick={() => setMode("reverse")}>
          Reverse
        </button>
      </div>
      {mode === "draw" ? <DrawCalc /> : <ReverseCalc />}
    </>
  );
}

function DrawCalc() {
  const { peptides, vials } = useAppState();
  const [syringe, setSyringe] = useState<SyringeUnits>(30);
  const [rows, setRows] = useState<PeptideRow[]>(() => [newRow()]);
  const [water, setWater] = useState("5");
  const [waterUnit, setWaterUnit] = useState<WaterUnit>("ml");
  const [doseUnit, setDoseUnit] = useState<DoseUnit>("mcg");
  const [fromVial, setFromVial] = useState("");

  const usableVials = vials.flatMap((vial) => {
    const peptide = peptides.find((p) => p.id === vial.peptideId);
    if (!peptide) return [];
    const mg = vialAmountToMg({ unit: peptide.unit, amount: vial.totalAmount });
    if (mg == null) return [];
    return [{ vial, peptide, mg }];
  });

  const result = useMemo(() => {
    const waterMl = parsePositive(water);
    return formulateDraw({
      syringe,
      waterMl: waterMl == null ? 0 : waterToMl(waterMl, waterUnit),
      peptides: rows.map((row) => ({
        vialMg: parsePositive(row.mg) ?? 0,
        doseMg: doseToMg(parsePositive(row.dose) ?? 0, doseUnit),
      })),
    });
  }, [doseUnit, rows, syringe, water, waterUnit]);

  function setRow(key: string, patch: Partial<PeptideRow>) {
    setRows((cur) => cur.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    if (rows.length >= MAX_CALC_PEPTIDES) return;
    setRows((cur) => [...cur, newRow({ mg: "5", dose: doseUnit === "mg" ? "0.25" : "250" })]);
  }

  function fillFromVial(id: string) {
    setFromVial(id);
    const picked = usableVials.find((row) => row.vial.id === id);
    if (!picked) return;
    const nextDoseUnit: DoseUnit = picked.peptide.unit === "mg" ? "mg" : "mcg";
    const doseAmt = picked.peptide.lastAmount ?? picked.vial.dose;
    setDoseUnit(nextDoseUnit);
    setRows([
      newRow({
        mg: formatMl(picked.mg),
        dose: String(doseAmt),
      }),
    ]);
  }

  function switchWater(next: WaterUnit) {
    const n = parsePositive(water);
    if (n != null) setWater(String(convertWater(n, waterUnit, next)));
    setWaterUnit(next);
  }

  function switchDose(next: DoseUnit) {
    setRows((cur) =>
      cur.map((row) => {
        const n = parsePositive(row.dose);
        return n == null ? row : { ...row, dose: String(convertDose(n, doseUnit, next)) };
      }),
    );
    setDoseUnit(next);
  }

  const doseLabel = rows
    .map((row) => parsePositive(row.dose))
    .filter((n): n is number => n != null)
    .map((n) => `${formatMl(n)} ${doseUnit}`)
    .join(" + ");

  return (
    <div className="stack">
      {usableVials.length > 0 ? (
        <label className="field">
          <span>From a vial</span>
          <select value={fromVial} onChange={(e) => fillFromVial(e.target.value)}>
            <option value="">Leave blank</option>
            {usableVials.map((row) => (
              <option key={row.vial.id} value={row.vial.id}>
                {row.peptide.name}
                {row.vial.label ? ` · ${row.vial.label}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="field">
        <span>Syringe</span>
        <div className="day-pills">
          {SYRINGE_UNITS.map((size) => (
            <button
              key={size}
              type="button"
              className={cn("day-pill", size === syringe && "on")}
              onClick={() => setSyringe(size)}
            >
              {size} units
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Peptide in the vial</span>
        {rows.map((row, i) => (
          <div className="calc-row" key={row.key}>
            <span className="muted">{rows.length > 1 ? `Peptide ${i + 1}` : "mg"}</span>
            <input
              inputMode="decimal"
              value={row.mg}
              aria-label={rows.length > 1 ? `Peptide ${i + 1} milligrams` : "Peptide milligrams"}
              onChange={(e) => setRow(row.key, { mg: e.target.value })}
            />
            <span className="muted">mg</span>
            {rows.length > 1 ? (
              <button
                type="button"
                className="calc-remove"
                aria-label={`Remove peptide ${i + 1}`}
                onClick={() => setRows((cur) => cur.filter((r) => r.key !== row.key))}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
        {rows.length < MAX_CALC_PEPTIDES ? (
          <button type="button" className="btn ghost" onClick={addRow}>
            Add peptide
          </button>
        ) : null}
      </div>

      <label className="field">
        <span>Bac water</span>
        <div className="calc-row">
          <input
            inputMode="decimal"
            value={water}
            aria-label="Bac water"
            onChange={(e) => setWater(e.target.value)}
          />
          <select
            value={waterUnit}
            aria-label="Water unit"
            onChange={(e) => {
              if (isWaterUnit(e.target.value)) switchWater(e.target.value);
            }}
          >
            {WATER_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </div>
      </label>

      <div className="field">
        <span>Dose</span>
        {rows.map((row, i) => (
          <div className="calc-row" key={`d-${row.key}`}>
            <span className="muted">{rows.length > 1 ? `Peptide ${i + 1}` : doseUnit}</span>
            <input
              inputMode="decimal"
              value={row.dose}
              aria-label={rows.length > 1 ? `Peptide ${i + 1} dose` : "Dose"}
              onChange={(e) => setRow(row.key, { dose: e.target.value })}
            />
            {i === 0 ? (
              <select
                value={doseUnit}
                aria-label="Dose unit"
                onChange={(e) => {
                  if (isDoseUnit(e.target.value)) switchDose(e.target.value);
                }}
              >
                {DOSE_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            ) : (
              <span className="muted">{doseUnit}</span>
            )}
          </div>
        ))}
      </div>

      <article className="card calc-result">
        {result.kind === "need-inputs" ? (
          <p className="muted" style={{ margin: 0 }}>
            Add peptide, bac water, and a dose.
          </p>
        ) : (
          <>
            <p className="kicker">Draw</p>
            <div className="calc-units">
              {formatUnits(result.units)}
              <span> units</span>
            </div>
            <SyringeTrack syringe={syringe} units={result.units} />
            <p>
              Draw {formatUnits(result.units)} units for {doseLabel || "this dose"}.
            </p>
            <p className="muted">
              {formatMgMl(result.concentrationMgMl)} mg/mL. {formatMl(result.dosesPerVial)} doses
              in the vial, {formatMl(result.doseMl)} mL each.
            </p>
            {result.overSyringe ? (
              <p className="error">
                {formatUnits(result.units)} units will not fit a {syringe}-unit syringe.
              </p>
            ) : null}
          </>
        )}
      </article>
      <p className="muted">U-100 insulin syringe. 100 units is 1 mL.</p>
    </div>
  );
}

function ReverseCalc() {
  const [vial, setVial] = useState("5");
  const [dose, setDose] = useState("250");
  const [units, setUnits] = useState("100");
  const result = useMemo(() => {
    const vialMg = parsePositive(vial) ?? 0;
    const doseMcg = parsePositive(dose) ?? 0;
    const draw = parsePositive(units) ?? 0;
    return formulateReverse({
      vialMg,
      doseMg: doseToMg(doseMcg, "mcg"),
      units: draw,
    });
  }, [dose, units, vial]);

  return (
    <div className="stack">
      <p className="muted" style={{ marginTop: 0 }}>
        How much bac water to use if you already know the draw.
      </p>
      <label className="field">
        <span>Peptide in the vial</span>
        <div className="calc-row">
          <input
            inputMode="decimal"
            value={vial}
            aria-label="Peptide milligrams"
            onChange={(e) => setVial(e.target.value)}
          />
          <span className="muted">mg</span>
        </div>
      </label>
      <label className="field">
        <span>Dose</span>
        <div className="calc-row">
          <input inputMode="decimal" value={dose} aria-label="Dose micrograms" onChange={(e) => setDose(e.target.value)} />
          <span className="muted">mcg</span>
        </div>
      </label>
      <label className="field">
        <span>Draw</span>
        <div className="calc-row">
          <input inputMode="decimal" value={units} aria-label="Units to draw" onChange={(e) => setUnits(e.target.value)} />
          <span className="muted">units</span>
        </div>
      </label>
      <article className="card calc-result">
        {result.kind === "need-inputs" ? (
          <p className="muted" style={{ margin: 0 }}>
            Add vial amount, dose, and units.
          </p>
        ) : (
          <>
            <p className="kicker">Bac water</p>
            <div className="calc-units">
              {formatMgMl(result.waterMl)}
              <span> mL</span>
            </div>
            <p>Use {formatMgMl(result.waterMl)} mL of bac water.</p>
            <p className="muted">That is {formatMl(result.waterIu)} units.</p>
          </>
        )}
      </article>
    </div>
  );
}

function SyringeTrack(props: { syringe: SyringeUnits; units: number }) {
  const ticks = syringeTicks(props.syringe);
  const clamped = Math.min(Math.max(props.units, 0), props.syringe);
  const fill = `${(clamped / props.syringe) * 100}%`;
  return (
    <div className="calc-syringe" aria-hidden="true">
      <div className="calc-syringe-bar">
        <i className="calc-syringe-fill" style={{ width: fill }} />
        <i className="calc-syringe-mark" style={{ left: fill }} />
      </div>
      <div className="calc-syringe-ticks">
        {ticks.map((tick) => (
          <span key={tick} style={{ left: `${(tick / props.syringe) * 100}%` }}>
            {tick}
          </span>
        ))}
      </div>
    </div>
  );
}
