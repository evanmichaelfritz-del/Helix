import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type { HealthDay, ImportResult, WeighIn, Workout } from "@shared/types.ts";
import { parseImportFile } from "@shared/import/index.ts";
import { ApiError, client } from "../lib/api.ts";
import { formatWeight, hoursLabel } from "../lib/format.ts";
import { useAppState } from "../lib/state.tsx";

export function VitalsPage() {
  const { gen, bump, user } = useAppState();
  const location = useLocation();
  const [days, setDays] = useState<HealthDay[]>([]);
  const [weighIns, setWeighIns] = useState<WeighIn[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const unit = user?.settings.weightUnit ?? "kg";

  useEffect(() => {
    client
      .health()
      .then((r) => {
        setDays(r.days);
        setWeighIns(r.weighIns);
        setWorkouts(r.workouts);
      })
      .catch(() => undefined);
  }, [gen]);

  useEffect(() => {
    if (location.hash !== "#sources") return;
    document.querySelector("[data-helix-scroll]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash, days.length]);

  const series = useMemo(() => trendSeries(days), [days]);
  const weights = weighIns.slice(-14).map((w) => w.kg);

  return (
    <>
      <h1>Vitals</h1>
      <article className="card today-hero">
        <p className="kicker">{series.label}</p>
        {series.values.length > 0 ? (
          <>
            <div className={`hero-value ${series.tone ?? ""}`}>
              {series.latest}
              {series.unit}
            </div>
            <Liveline values={series.values} />
          </>
        ) : (
          <p className="muted" style={{ marginTop: 16 }}>
            No imported days yet. Pick a file below.
          </p>
        )}
      </article>

      {weights.length > 0 ? (
        <article className="card today-hero section">
          <p className="kicker">Weight</p>
          <div className="hero-value" style={{ fontSize: 36 }}>
            {formatWeight(weights[weights.length - 1], unit)}
          </div>
          <Liveline values={weights} />
        </article>
      ) : null}

      {workouts.length > 0 ? (
        <div className="stack section">
          {workouts.slice(0, 12).map((w) => (
            <article className="card workout" key={w.id}>
              <div>
                <strong>{w.name}</strong>
                <div className="muted">{w.loggedOn}</div>
              </div>
              <span>{w.durationMin != null ? `${w.durationMin} min` : w.loggedOn}</span>
            </article>
          ))}
        </div>
      ) : null}

      <section className="section" id="sources" data-helix-scroll>
        <p className="kicker" style={{ marginBottom: 10 }}>
          Sources
        </p>
        <div className="pickers">
          <FilePicker
            label="Whoop CSV"
            hint="Physiological cycles export, or a zip that contains it."
            accept=".csv,.zip"
            onImported={(result, text) => {
              setImported(result);
              setMsg(text);
              bump();
            }}
          />
          <FilePicker
            label="Garmin JSON dailies zip"
            hint="Connect full data export. Activities CSV is rejected."
            accept=".zip,.json"
            onImported={(result, text) => {
              setImported(result);
              setMsg(text);
              bump();
            }}
          />
          <FilePicker
            label="Apple Health export"
            hint="export.xml or the zip that contains it."
            accept=".zip,.xml"
            onImported={(result, text) => {
              setImported(result);
              setMsg(text);
              bump();
            }}
          />
        </div>
        {imported ? <ImportedCounts result={imported} /> : null}
        {msg && !imported ? <p className="muted" style={{ marginTop: 10 }}>{msg}</p> : null}
      </section>
    </>
  );
}

function trendSeries(days: HealthDay[]): {
  label: string;
  values: number[];
  latest: string;
  unit: string;
  tone?: string;
} {
  const whoop = days.filter((d) => d.whoopRecovery != null);
  if (whoop.length) {
    const last = whoop[whoop.length - 1].whoopRecovery ?? 0;
    const tone = last >= 67 ? "green" : last >= 34 ? "amber" : "red";
    return {
      label: "Whoop recovery",
      values: whoop.map((d) => d.whoopRecovery ?? 0),
      latest: String(Math.round(last)),
      unit: "%",
      tone,
    };
  }
  const garmin = days.filter((d) => d.garminBodyBattery != null);
  if (garmin.length) {
    const last = garmin[garmin.length - 1].garminBodyBattery ?? 0;
    return {
      label: "Garmin body battery",
      values: garmin.map((d) => d.garminBodyBattery ?? 0),
      latest: String(Math.round(last)),
      unit: "",
    };
  }
  const sleep = days.filter((d) => d.sleepHours != null);
  if (sleep.length) {
    const last = sleep[sleep.length - 1].sleepHours ?? 0;
    return {
      label: "Sleep",
      values: sleep.map((d) => d.sleepHours ?? 0),
      latest: hoursLabel(last),
      unit: "",
    };
  }
  return { label: "Trend", values: [], latest: "", unit: "" };
}

function Liveline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 320;
  const h = 84;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 8) + 4;
    const y = h - 8 - ((v - min) / span) * (h - 16);
    return { x, y };
  });
  const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `4,${h - 4} ${line} ${w - 4},${h - 4}`;
  return (
    <svg className="liveline" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polygon className="liveline-fill" points={area} />
      <polyline className="liveline-stroke" points={line} />
    </svg>
  );
}

export function ImportedCounts({ result }: { result: ImportResult }) {
  return (
    <p className="import-counts">
      Imported {result.healthDays} days, {result.weighIns} weigh-ins, {result.workouts} workouts
      {result.peptides ? `, ${result.peptides} peptides` : ""}
      {result.vials ? `, ${result.vials} vials` : ""}
      {result.doses ? `, ${result.doses} doses` : ""}.
    </p>
  );
}

export function FilePicker(props: {
  label: string;
  hint: string;
  accept: string;
  onImported: (result: ImportResult | null, message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function handle(file: File) {
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = await parseImportFile({ name: file.name, type: file.type, buffer });
      if (parsed.kind === "error") {
        props.onImported(null, parsed.error);
        return;
      }
      const result = await client.importRecords(parsed.records);
      props.onImported(
        result,
        `Imported ${result.healthDays} days, ${result.weighIns} weigh-ins, ${result.workouts} workouts${
          result.peptides ? `, ${result.peptides} peptides` : ""
        }.`,
      );
    } catch (err) {
      props.onImported(null, err instanceof ApiError ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className="drop">
      <input
        type="file"
        accept={props.accept}
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handle(file);
          e.target.value = "";
        }}
      />
      <strong>{props.label}</strong>
      <span>{busy ? "Reading…" : props.hint}</span>
    </label>
  );
}
