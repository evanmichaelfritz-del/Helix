import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  EMPTY_HERO_TITLE,
  pickHealthDay,
  pickTodayHero,
  supportingLines,
  todaysWorkouts,
} from "@shared/health.ts";
import {
  todayLocal,
  type HealthDay,
  type TodayPayload,
  type TodayProtocol,
  type WeighIn,
  type Workout,
} from "@shared/types.ts";
import { ApiError, client } from "../lib/api.ts";
import { dayHeading, formatWeight, hoursLabel, signedDelta } from "../lib/format.ts";
import { useAppState } from "../lib/state.tsx";
import { PeptideSwatch, VialRunway } from "../components/Shell.tsx";

export function TodayPage() {
  const { gen, openSheet, user, setPeptides } = useAppState();
  const [data, setData] = useState<TodayPayload | null>(null);
  const [day, setDay] = useState<HealthDay | null>(null);
  const [weighIns, setWeighIns] = useState<WeighIn[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fabOpen, setFabOpen] = useState(false);
  const on = todayLocal();
  const unit = user?.settings.weightUnit ?? "kg";

  useEffect(() => {
    let cancelled = false;
    Promise.all([client.today(on), client.health(), client.workouts(on)])
      .then(([today, health, listed]) => {
        if (cancelled) return;
        setData(today);
        const matched = pickHealthDay(health.days, on);
        setDay(matched ?? (today.day?.loggedOn === on ? today.day : null));
        setWeighIns(health.weighIns.length > 0 ? health.weighIns : today.weighIns);
        const fromList = todaysWorkouts(listed.workouts, on);
        const fromToday = todaysWorkouts(today.workouts, on);
        setWorkouts(fromList.length > 0 ? fromList : fromToday);
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

  const hero = pickTodayHero(day);
  const supporting = supportingLines(
    day,
    weighIns.filter((row) => row.loggedOn <= on),
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
            <span className={`delta ${delta > 0 ? "up" : "down"}`}> {signedDelta(delta, unit)}</span>
          ) : null}
        </>
      ),
    });
  }
  const todayWorkouts = todaysWorkouts(workouts, on);

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

      {todayWorkouts.length > 0 ? (
        <div className="stack workouts">
          {todayWorkouts.map((w) => (
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
        Vitals
      </Link>
    </>
  );
}
