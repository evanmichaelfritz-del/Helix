import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { todayLocal, type TodayPayload, type TodayProtocol } from "@shared/types.ts";
import { ApiError, client } from "../lib/api.ts";
import { dayHeading, formatWeight, hoursLabel, signedDelta } from "../lib/format.ts";
import { useAppState } from "../lib/state.tsx";
import { Runway, Swatch } from "../components/Shell.tsx";

export function TodayPage() {
  const { gen, openSheet, user, setPeptides } = useAppState();
  const [data, setData] = useState<TodayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fabOpen, setFabOpen] = useState(false);
  const on = todayLocal();
  const unit = user?.settings.weightUnit ?? "kg";

  useEffect(() => {
    let cancelled = false;
    client
      .today(on)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load today.");
      });
    client.peptides().then((r) => setPeptides(r.peptides)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [gen, on, setPeptides]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const support: { key: string; node: ReactNode }[] = [];
  if (data.supporting.sleepHours != null) {
    support.push({ key: "sleep", node: <>Sleep {hoursLabel(data.supporting.sleepHours)}</> });
  }
  if (data.supporting.strain != null) {
    support.push({ key: "strain", node: <>Strain {data.supporting.strain.toFixed(1)}</> });
  } else if (data.supporting.steps != null) {
    support.push({ key: "steps", node: <>{data.supporting.steps.toLocaleString()} steps</> });
  }
  if (data.supporting.weightKg != null) {
    const delta = data.supporting.weightDeltaKg;
    support.push({
      key: "weight",
      node: (
        <>
          {formatWeight(data.supporting.weightKg, unit)}
          {delta != null && Math.abs(delta) >= 0.05 ? (
            <span className={`delta ${delta > 0 ? "up" : "down"}`}> {signedDelta(delta, unit)}</span>
          ) : null}
        </>
      ),
    });
  }

  return (
    <>
      <h1>Today</h1>
      <article className="card today-hero">
        <p className="kicker">{dayHeading(data.on)}</p>
        <TodayHero hero={data.hero} />
        {support.length > 0 ? (
          <ul className="support">
            {support.map((s) => (
              <li key={s.key}>{s.node}</li>
            ))}
          </ul>
        ) : null}
      </article>

      {data.protocol.kind === "empty" ? (
        <Link className="card protocol-mini" to="/protocol">
          Add a peptide
        </Link>
      ) : (
        <ProtocolMini
          protocol={data.protocol}
          onLog={(peptideId) => openSheet({ kind: "log-dose", peptideId })}
        />
      )}

      {data.workouts.length > 0 ? (
        <div className="stack workouts">
          {data.workouts.map((w) => (
            <article className="card workout" key={w.id}>
              <strong>{w.name}</strong>
              <span>
                {w.durationMin != null ? `${w.durationMin} min` : ""}
                {w.strain != null ? ` · strain ${w.strain}` : ""}
              </span>
            </article>
          ))}
        </div>
      ) : null}

      <div className="fab-wrap">
        {fabOpen ? (
          <>
            <button className="fab-item" type="button" onClick={() => { setFabOpen(false); openSheet({ kind: "log-dose" }); }}>
              Log dose
            </button>
            <button className="fab-item" type="button" onClick={() => { setFabOpen(false); openSheet({ kind: "log-weight" }); }}>
              Log weight
            </button>
          </>
        ) : null}
        <button className="fab" type="button" aria-label="Log" onClick={() => setFabOpen((v) => !v)}>
          {fabOpen ? "×" : "+"}
        </button>
      </div>
    </>
  );
}

function ProtocolMini(props: {
  protocol: Extract<TodayProtocol, { kind: "dose" }>;
  onLog: (peptideId: string) => void;
}) {
  const p = props.protocol;
  return (
    <button type="button" className="card protocol-mini" onClick={() => props.onLog(p.peptide.id)}>
      <Swatch color={p.peptide.color} />
      <div className="meta">
        <strong>{p.peptide.name}</strong>
        <span>
          {p.amount} {p.unit} · {p.status === "logged" ? "Logged" : "Due today"}
        </span>
      </div>
      <Runway remaining={p.remainingInjections} tone={p.runwayTone} />
    </button>
  );
}

function TodayHero({ hero }: { hero: TodayPayload["hero"] }) {
  if (hero.kind === "whoop") {
    return (
      <>
        <div className={`hero-value ${hero.tone}`}>{Math.round(hero.recovery)}%</div>
        <p className="hero-label">Whoop recovery</p>
      </>
    );
  }
  if (hero.kind === "garmin") {
    return (
      <>
        <div className="hero-value">{Math.round(hero.bodyBattery)}</div>
        <p className="hero-label">Garmin body battery</p>
      </>
    );
  }
  if (hero.kind === "sleep") {
    return (
      <>
        <div className="hero-value">{hoursLabel(hero.hours)}</div>
        <p className="hero-label">Sleep</p>
      </>
    );
  }
  return (
    <Link className="import-empty" to="/health#sources">
      Import Whoop, Garmin, or Apple Health
    </Link>
  );
}
