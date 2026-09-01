import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useLocation } from "react-router-dom";
import { EMPTY_HERO_TITLE } from "@shared/health.ts";
import { cn } from "@shared/cn.ts";
import type { ImportResult, WeighIn, WeightUnit } from "@shared/types.ts";
import { parseImportFile } from "@shared/import/index.ts";
import { LIVELINE_H, LIVELINE_W, livelineIndexAt, livelinePoints, livelineViewX } from "@shared/liveline.ts";
import { ApiError, client } from "../lib/api.ts";
import { formatWeight, hoursLabel, shortDate, signedDelta } from "../lib/format.ts";
import { useAppState } from "../lib/state.tsx";
import { SkeletonCards, useDelayedFlag } from "../components/Skeleton.tsx";

export function VitalsPage() {
  const { bump, user, setUser, healthDays, healthWeighIns, healthWorkouts, appDataReady } = useAppState();
  const location = useLocation();
  const [msg, setMsg] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const unit = user?.settings.weightUnit ?? "lb";
  const showSkeleton = useDelayedFlag(!appDataReady);

  useEffect(() => {
    if (location.hash !== "#sources") return;
    document.querySelector("[data-helix-scroll]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash, healthDays.length]);

  const series = useMemo(() => trendSeries(healthDays), [healthDays]);
  const recentWeights = healthWeighIns.slice(-28);

  async function setUnit(weightUnit: WeightUnit) {
    if (!user || user.settings.weightUnit === weightUnit) return;
    const previous = user;
    setUser({ ...user, settings: { ...user.settings, weightUnit } });
    try {
      const res = await client.patchMe({ settings: { ...user.settings, weightUnit } });
      setUser(res.user);
    } catch {
      setUser(previous);
    }
  }

  return (
    <>
      <h1>Vitals</h1>
      {showSkeleton ? <SkeletonCards /> : null}
      {appDataReady ? (
      <article className="card today-hero">
        {series.values.length > 0 ? (
          <>
            <p className="kicker">{series.label}</p>
            <div className={`hero-value ${series.tone ?? ""}`}>
              {series.latest}
              {series.unit}
            </div>
            <Liveline values={series.values} />
          </>
        ) : (
          <p className="empty-hero-title">{EMPTY_HERO_TITLE}</p>
        )}
      </article>
      ) : null}

      {appDataReady && recentWeights.length > 0 ? (
        <WeightCard weighIns={recentWeights} unit={unit} onUnit={setUnit} />
      ) : null}

      {healthWorkouts.length > 0 ? (
        <div className="stack section">
          {healthWorkouts.slice(0, 12).map((w) => (
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

function trendSeries(days: import("@shared/types.ts").HealthDay[]): {
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
  return { label: EMPTY_HERO_TITLE, values: [], latest: "", unit: "" };
}

function WeightCard(props: { weighIns: WeighIn[]; unit: WeightUnit; onUnit: (unit: WeightUnit) => void }) {
  const start = props.weighIns[0];
  const latest = props.weighIns[props.weighIns.length - 1];
  if (!start || !latest) return null;
  const delta = latest.kg - start.kg;
  return (
    <article className="card today-hero section">
      <div className="weight-head">
        <p className="kicker">Weight</p>
        <div className="day-pills" role="group" aria-label="Weight unit">
          {(["lb", "kg"] as const).map((u) => (
            <button
              key={u}
              type="button"
              className={cn("day-pill", props.unit === u && "on")}
              aria-pressed={props.unit === u}
              onClick={() => props.onUnit(u)}
            >
              {u}
            </button>
          ))}
        </div>
      </div>
      <div className="hero-value" style={{ fontSize: 36 }}>
        {formatWeight(latest.kg, props.unit)}
      </div>
      <p className="weight-start">
        from {formatWeight(start.kg, props.unit)} on {shortDate(start.loggedOn)}
        {props.weighIns.length > 1 ? (
          <span className={delta < 0 ? "down" : delta > 0 ? "up" : undefined}>
            {" "}
            · {signedDelta(delta, props.unit)}
          </span>
        ) : null}
      </p>
      <WeightLine weighIns={props.weighIns} unit={props.unit} />
    </article>
  );
}

function WeightLine(props: { weighIns: WeighIn[]; unit: WeightUnit }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const [active, setActive] = useState<number | null>(null);
  const values = props.weighIns.map((row) => row.kg);
  if (values.length < 2) return null;
  const { min, max, pts } = livelinePoints(values);
  const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `4,${LIVELINE_H - 4} ${line} ${LIVELINE_W - 4},${LIVELINE_H - 4}`;
  const reading = active != null ? props.weighIns[active] : null;
  const cursor = active != null ? pts[active] : null;

  function indexFromClientX(clientX: number): number {
    const svg = svgRef.current;
    if (!svg) return 0;
    return livelineIndexAt(livelineViewX(clientX, svg.getBoundingClientRect()), values.length);
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setActive(indexFromClientX(event.clientX));
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!dragging.current && event.pointerType !== "mouse") return;
    setActive(indexFromClientX(event.clientX));
  }

  function onPointerUp(event: PointerEvent<SVGSVGElement>) {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (event.pointerType !== "mouse") setActive(null);
  }

  return (
    <div className="weight-line">
      <div className="weight-readout" aria-live="polite">
        {reading ? (
          <>
            <strong>{formatWeight(reading.kg, props.unit)}</strong>
            <span>{shortDate(reading.loggedOn)}</span>
          </>
        ) : (
          <span className="muted">Drag the line to read a day</span>
        )}
      </div>
      <svg
        ref={svgRef}
        className="liveline weight-liveline"
        viewBox={`0 0 ${LIVELINE_W} ${LIVELINE_H}`}
        role="img"
        aria-label={`Weight from ${formatWeight(min, props.unit)} to ${formatWeight(max, props.unit)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!dragging.current) setActive(null);
        }}
      >
        <polygon className="liveline-fill" points={area} />
        <polyline className="liveline-stroke" points={line} />
        {pts.map((pt) => (
          <circle
            key={pt.index}
            className={pt.index === active ? "liveline-dot on" : "liveline-dot"}
            cx={pt.x}
            cy={pt.y}
            r={pt.index === active ? 4.5 : 2.6}
          />
        ))}
        {cursor ? (
          <line className="liveline-cursor" x1={cursor.x} y1={6} x2={cursor.x} y2={LIVELINE_H - 6} />
        ) : null}
      </svg>
      <div className="weight-axis">
        <span>{shortDate(props.weighIns[0].loggedOn)}</span>
        <span>{shortDate(props.weighIns[props.weighIns.length - 1].loggedOn)}</span>
      </div>
    </div>
  );
}

function Liveline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const { pts } = livelinePoints(values);
  const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `4,${LIVELINE_H - 4} ${line} ${LIVELINE_W - 4},${LIVELINE_H - 4}`;
  return (
    <svg className="liveline" viewBox={`0 0 ${LIVELINE_W} ${LIVELINE_H}`} aria-hidden>
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
