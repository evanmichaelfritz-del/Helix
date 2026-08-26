import { useEffect, useMemo, useState } from "react";
import { todayLocal } from "@shared/types.ts";
import { client } from "../lib/api.ts";
import { useAppState } from "../lib/state.tsx";

export function CalendarPage() {
  const { gen } = useAppState();
  const [marks, setMarks] = useState<Set<string>>(new Set());
  const on = todayLocal();
  const [y, m] = on.split("-").map(Number);
  const view = useMemo(() => monthCells(y, m), [y, m]);

  useEffect(() => {
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const last = new Date(y, m, 0).getDate();
    const to = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    Promise.all([client.health(from, to), client.doses()]).then(([h, d]) => {
      const next = new Set<string>();
      for (const day of h.days) next.add(day.loggedOn);
      for (const w of h.weighIns) next.add(w.loggedOn);
      for (const dose of d.doses) next.add(dose.loggedOn);
      setMarks(next);
    }).catch(() => undefined);
  }, [gen, y, m]);

  return (
    <>
      <h1>Calendar</h1>
      <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
        Desktop rail only in v1. Mobile keeps four tabs.
      </p>
      <div className="cal">
        {["S", "M", "T", "W", "T", "F", "S"].map((d) => (
          <b key={d}>{d}</b>
        ))}
        {view.map((cell, i) =>
          cell ? (
            <button key={cell} type="button" className={marks.has(cell) ? "dot" : undefined}>
              {Number(cell.slice(-2))}
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
    </>
  );
}

function monthCells(year: number, month: number): Array<string | null> {
  const first = new Date(year, month - 1, 1).getDay();
  const last = new Date(year, month, 0).getDate();
  const cells: Array<string | null> = Array.from({ length: first }, () => null);
  for (let d = 1; d <= last; d++) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return cells;
}
