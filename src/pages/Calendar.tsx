import { useMemo, useState } from "react";
import { dosesByDay, monthCells, shiftMonth } from "@shared/calendar.ts";
import { todayLocal } from "@shared/types.ts";
import { dayHeading } from "../lib/format.ts";
import { cn } from "@shared/cn.ts";
import { useAppState } from "../lib/state.tsx";
import { PeptideSwatch } from "../components/Shell.tsx";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const MAX_DOTS = 4;

export function CalendarPage() {
  const { peptides, doses } = useAppState();
  const today = todayLocal();
  const [y, m] = today.split("-").map(Number);
  const [cursor, setCursor] = useState({ year: y, month: m });
  const [openOn, setOpenOn] = useState<string | null>(null);
  const view = useMemo(() => monthCells(cursor.year, cursor.month), [cursor.year, cursor.month]);
  const byDay = useMemo(() => dosesByDay(doses, peptides), [doses, peptides]);
  const openDoses = openOn ? (byDay.get(openOn) ?? []) : [];
  const monthLabel = new Date(cursor.year, cursor.month - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  function move(delta: number) {
    const next = shiftMonth(cursor.year, cursor.month, delta);
    setCursor(next);
    if (openOn) {
      const [oy, om] = openOn.split("-").map(Number);
      if (oy !== next.year || om !== next.month) setOpenOn(null);
    }
  }

  return (
    <>
      <h1>Calendar</h1>
      <div className="cal-nav">
        <button type="button" aria-label="Previous month" onClick={() => move(-1)}>
          ‹
        </button>
        <strong>{monthLabel}</strong>
        <button type="button" aria-label="Next month" onClick={() => move(1)}>
          ›
        </button>
      </div>
      <div className="cal">
        {WEEKDAYS.map((label, i) => (
          <b key={i}>{label}</b>
        ))}
        {view.map((cell, i) =>
          cell ? (
            <button
              key={cell}
              type="button"
              className={cn(cell === today && "today", cell === openOn && "on")}
              aria-pressed={cell === openOn}
              aria-label={dayLabel({ on: cell, count: byDay.get(cell)?.length ?? 0 })}
              onClick={() => setOpenOn((cur) => (cur === cell ? null : cell))}
            >
              <span className="cal-num">{Number(cell.slice(-2))}</span>
              <span className="cal-dots" aria-hidden="true">
                {(byDay.get(cell) ?? []).slice(0, MAX_DOTS).map((row) => (
                  <i key={row.peptideId} style={{ background: row.color }} />
                ))}
              </span>
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
      {openOn ? (
        <section className="card cal-day" aria-live="polite">
          <p className="kicker">{dayHeading(openOn)}</p>
          {openDoses.length === 0 ? (
            <p className="muted" style={{ margin: "8px 0 0" }}>
              No peptides logged.
            </p>
          ) : (
            <div className="list" style={{ marginTop: 10 }}>
              {openDoses.map((row) => (
                <div className="list-row" key={row.peptideId}>
                  <PeptideSwatch color={row.color} />
                  <div className="meta">
                    <strong>{row.name}</strong>
                    <div className="muted">
                      {row.amount} {row.unit}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}

function dayLabel(opts: { on: string; count: number }): string {
  const [y, m, d] = opts.on.split("-").map(Number);
  const date = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  if (opts.count === 0) return date;
  if (opts.count === 1) return `${date}, 1 peptide`;
  return `${date}, ${opts.count} peptides`;
}
