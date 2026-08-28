import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  buildTodayScheduledDoses,
  EMPTY_HERO_TITLE,
  pickTodayHero,
  supportingLines,
  todaysWorkouts,
  type TodayScheduledDose,
} from "@shared/health.ts";
import { todayLocal, type TodayPayload } from "@shared/types.ts";
import { ApiError, client } from "../lib/api.ts";
import { dayHeading, formatWeight, hoursLabel, signedDelta } from "../lib/format.ts";
import { useAppState } from "../lib/state.tsx";
import { PeptideSwatch, VialRunway } from "../components/Shell.tsx";

export function TodayPage() {
  const {
    openSheet,
    user,
    todayPayload,
    todayDay,
    todayWorkouts,
    healthWeighIns,
    todayError,
    appDataReady,
    peptides,
    vials,
    doses,
    bump,
    showToast,
  } = useAppState();
  const [fabOpen, setFabOpen] = useState(false);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const on = todayLocal();
  const unit = user?.settings.weightUnit ?? "kg";
  const scheduledDoses = buildTodayScheduledDoses({ peptides, vials, doses, on });

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

  async function quickLog(item: TodayScheduledDose) {
    if (item.logged || item.amount <= 0) {
      openSheet({ kind: "log-dose", peptideId: item.peptide.id });
      return;
    }
    setLoggingId(item.peptide.id);
    try {
      const { dose } = await client.logDose({
        peptideId: item.peptide.id,
        amount: item.amount,
        loggedOn: on,
      });
      bump();
      showToast({
        message: `Logged ${item.amount} ${item.unit} ${item.peptide.name}`,
        undo: async () => {
          await client.undoDose(dose.id);
          bump();
        },
      });
    } catch (err) {
      showToast({
        message: err instanceof ApiError ? err.message : "Could not log dose.",
      });
    } finally {
      setLoggingId(null);
    }
  }

  async function undoDose(item: TodayScheduledDose) {
    if (!item.loggedDose) return;
    setLoggingId(item.peptide.id);
    try {
      await client.undoDose(item.loggedDose.id);
      bump();
    } catch (err) {
      showToast({
        message: err instanceof ApiError ? err.message : "Could not undo dose.",
      });
    } finally {
      setLoggingId(null);
    }
  }

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

      <TodayDosesSection
        items={scheduledDoses}
        hasPeptides={peptides.length > 0}
        loggingId={loggingId}
        onQuickLog={(item) => void quickLog(item)}
        onUndo={(item) => void undoDose(item)}
      />

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

function TodayDosesSection(props: {
  items: TodayScheduledDose[];
  hasPeptides: boolean;
  loggingId: string | null;
  onQuickLog: (item: TodayScheduledDose) => void;
  onUndo: (item: TodayScheduledDose) => void;
}) {
  if (!props.hasPeptides) {
    return (
      <Link className="card protocol-mini" to="/protocol/peptides">
        Add a peptide
      </Link>
    );
  }
  if (props.items.length === 0) {
    return (
      <article className="card today-doses-empty">
        <p className="kicker">Peptides</p>
        <p className="muted">Nothing scheduled for today.</p>
        <Link className="btn ghost" to="/protocol/vials" style={{ marginTop: 12 }}>
          Edit schedules
        </Link>
      </article>
    );
  }

  return (
    <section className="today-doses">
      <p className="kicker" style={{ marginBottom: 8 }}>
        Peptides today
      </p>
      <div className="list">
        {props.items.map((item) => {
          const busy = props.loggingId === item.peptide.id;
          return (
            <div className="card today-dose-row" key={item.peptide.id}>
              <PeptideSwatch color={item.peptide.color} />
              <div className="meta" style={{ flex: 1, minWidth: 0 }}>
                <strong>{item.peptide.name}</strong>
                <div className="muted">
                  {item.amount} {item.unit} · {item.timesLabel}
                </div>
              </div>
              <VialRunway remaining={item.remainingInjections} tone={item.runwayTone} tiny />
              {item.logged ? (
                <button
                  type="button"
                  className="quick-log-btn done"
                  disabled={busy}
                  aria-label={`Undo ${item.peptide.name}`}
                  onClick={() => props.onUndo(item)}
                >
                  {busy ? "…" : "Logged"}
                </button>
              ) : (
                <button
                  type="button"
                  className="quick-log-btn"
                  disabled={busy || item.amount <= 0}
                  aria-label={`Log ${item.peptide.name}`}
                  onClick={() => props.onQuickLog(item)}
                >
                  {busy ? "…" : "+"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
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
