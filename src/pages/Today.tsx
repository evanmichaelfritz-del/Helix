import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  EMPTY_HERO_TITLE,
  pickTodayHero,
  supportingLines,
  todaysWorkouts,
} from "@shared/health.ts";
import { todayLocal, type TodayPayload, type TodayProtocol } from "@shared/types.ts";
import { dayHeading, formatWeight, hoursLabel, signedDelta } from "../lib/format.ts";
import { useAppState } from "../lib/state.tsx";
import { PeptideSwatch, VialRunway } from "../components/Shell.tsx";

export function TodayPage() {
  const { openSheet, user, todayPayload, todayDay, todayWorkouts, healthWeighIns, todayError, appDataReady } =
    useAppState();
  const [fabOpen, setFabOpen] = useState(false);
  const on = todayLocal();
  const unit = user?.settings.weightUnit ?? "kg";

  if (todayError) return <p className="error">{todayError}</p>;
  if (!todayPayload) {
    return appDataReady ? <p className="muted">Nothing for today yet.</p> : <p className="muted">Loading…</p>;
  }

  const data = todayPayload;
  const hero = pickTodayHero(todayDay);
  const supporting = supportingLines(
    todayDay,
    healthWeighIns.filter((row) => row.loggedOn <= on),
    hero,
  );
  const support: { key: string; node: ReactNode }[] = [];
  if (supporting.sleepHours != null) {
    support.push({ key: "sleep", node: <>Sleep {hoursLabel(supporting.sleepHours)}</> });
  }
  if (supporting.strain != null) {
    support.push({ key: "strain", node: <>Strain {supporting.strain.toFixed(1)}</> });
  } else if (supporting.steps != null) {
    support.push({ key: "steps", node: <>{supporting.steps.toLocaleString()} steps</> });
  }
  if (supporting.weightKg != null) {
    const delta = supporting.weightDeltaKg;
    support.push({
      key: "weight",
      node: (
        <>
          {formatWeight(supporting.weightKg, unit)}
          {delta != null && Math.abs(delta) >= 0.05 ? (
            <span> {signedDelta(delta, unit)}</span>
          ) : null}
        </>
      ),
    });
  }
  const workouts = todaysWorkouts(todayWorkouts, on);

  return (
    <>
      <h1>Today</h1>
      <article className="card today-hero">
        <p className="kicker">{dayHeading(data.on)}</p>
        <TodayHero hero={hero} />
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
        <TodayProtocolCard
          protocol={data.protocol}
          onLog={(peptideId) => openSheet({ kind: "log-dose", peptideId })}
        />
      )}

      {workouts.length > 0 ? (
        <div className="stack workouts">
          {workouts.map((w) => (
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

function TodayProtocolCard(props: {
  protocol: Extract<TodayProtocol, { kind: "dose" }>;
  onLog: (peptideId: string) => void;
}) {
  const p = props.protocol;
  return (
    <button type="button" className="card protocol-mini" onClick={() => props.onLog(p.peptide.id)}>
      <PeptideSwatch color={p.peptide.color} />
      <div className="meta">
        <strong>
          {p.amount} {p.unit}
        </strong>
        <span>
          {p.peptide.name} · {p.status === "logged" ? "Logged" : "Due today"}
        </span>
      </div>
      <VialRunway remaining={p.remainingInjections} tone={p.runwayTone} tiny />
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
    <>
      <p className="empty-hero-title">{EMPTY_HERO_TITLE}</p>
      <Link className="hero-cta" to="/health#sources">
        Import Whoop, Garmin, or Apple Health
      </Link>
    </>
  );
}
