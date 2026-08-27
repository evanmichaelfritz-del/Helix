import { useEffect, useMemo, useState } from "react";
import { CAL_CHIP_CAP, CAL_WEEKDAYS, inspectHeading, monthCells, monthRange, monthTitle, shiftMonth } from "@shared/calendar.ts";
import { todayLocal, type Dose, type Peptide, type WeighIn } from "@shared/types.ts";
import { client } from "../lib/api.ts";
import { formatWeightChip } from "../lib/format.ts";
import { useAppState } from "../lib/state.tsx";
import { PeptideSwatch } from "../components/Shell.tsx";

type DayMarks = {
  doses: Array<Dose & { peptide: Peptide | undefined }>;
  weighIn: WeighIn | undefined;
};

export function CalendarPage() {
  const { gen, openSheet, user, peptides, setPeptides } = useAppState();
  const today = todayLocal();
  const [y0, m0] = today.split("-").map(Number);
  const [cursor, setCursor] = useState({ year: y0, month: m0 });
  const [selected, setSelected] = useState<string | null>(today);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [weighIns, setWeighIns] = useState<WeighIn[]>([]);
  const cells = useMemo(() => monthCells(cursor.year, cursor.month), [cursor]);
  const range = useMemo(() => monthRange(cursor.year, cursor.month), [cursor]);
  const unit = user?.settings.weightUnit ?? "kg";

  useEffect(() => {
    client.peptides().then((r) => setPeptides(r.peptides)).catch(() => undefined);
    client.doses(undefined, { from: range.from, to: range.to }).then((r) => setDoses(r.doses)).catch(() => undefined);
    client.health(range.from, range.to).then((r) => setWeighIns(r.weighIns)).catch(() => undefined);
  }, [gen, range.from, range.to, setPeptides]);

  const byDay = useMemo(() => {
    const map = new Map<string, DayMarks>();
    function slot(on: string): DayMarks {
      let next = map.get(on);
      if (!next) {
        next = { doses: [], weighIn: undefined };
        map.set(on, next);
      }
      return next;
    }
    for (const dose of doses) {
      if (dose.undone) continue;
      slot(dose.loggedOn).doses.push({
        ...dose,
        peptide: peptides.find((p) => p.id === dose.peptideId),
      });
    }
    for (const w of weighIns) slot(w.loggedOn).weighIn = w;
    return map;
  }, [doses, peptides, weighIns]);

  const inspect = selected ? byDay.get(selected) : undefined;
  const inspectDoses = inspect?.doses ?? [];
  const inspectWeight = inspect?.weighIn;

  function go(delta: number) {
    setCursor((cur) => shiftMonth(cur.year, cur.month, delta));
  }

  return (
    <>
      <div className="cal-toolbar">
        <button className="btn ghost cal-nav" type="button" onClick={() => go(-1)}>
          Prev
        </button>
        <button
          className="btn ghost cal-nav"
          type="button"
          onClick={() => {
            setCursor({ year: y0, month: m0 });
            setSelected(today);
          }}
        >
          Today
        </button>
        <button className="btn ghost cal-nav" type="button" onClick={() => go(1)}>
          next
        </button>
        <p className="cal-month">{monthTitle(cursor.year, cursor.month)}</p>
      </div>

      <div className="cal">
        {CAL_WEEKDAYS.map((d, i) => (
          <b key={`${d}${i}`}>{d}</b>
        ))}
        {cells.map((cell, i) =>
          cell ? (
            <button
              key={cell}
              type="button"
              className="cal-cell"
              onClick={() => setSelected(cell)}
              aria-pressed={selected === cell}
            >
              <span className={cell === today ? "cal-num today" : "cal-num"}>{Number(cell.slice(-2))}</span>
              <DayChips marks={byDay.get(cell)} unit={unit} />
            </button>
          ) : (
            <span key={`e${i}`} className="cal-empty" />
          ),
        )}
      </div>

      <p className="muted cal-caption">Color = peptide. W = weight. Tap a day to inspect or log.</p>

      {selected ? (
        <article className="card cal-inspect">
          <h2>{inspectHeading(selected)}</h2>
          {inspectDoses.length === 0 && !inspectWeight ? <p className="muted">Nothing logged.</p> : null}
          <ul className="cal-inspect-list">
            {inspectDoses.map((d) => (
              <li key={d.id}>
                {d.peptide ? <PeptideSwatch color={d.peptide.color} /> : null}
                <span>
                  {d.amount} {d.unit} {d.peptide?.name ?? ""}
                </span>
              </li>
            ))}
            {inspectWeight ? (
              <li>
                <span className="cal-w">W</span>
                <span>{formatWeightChip(inspectWeight.kg, unit).replace(/^W\s/, "")}</span>
              </li>
            ) : null}
          </ul>
          <div className="row-btns">
            <button className="btn" type="button" onClick={() => openSheet({ kind: "log-dose", loggedOn: selected })}>
              Log dose
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => openSheet({ kind: "log-weight", loggedOn: selected })}
            >
              {inspectWeight ? "Edit weight" : "Log weight"}
            </button>
          </div>
        </article>
      ) : null}
    </>
  );
}

function DayChips(props: { marks: DayMarks | undefined; unit: "kg" | "lb" }) {
  if (!props.marks) return null;
  const chips: Array<{ key: string; label: string; color?: string; weight?: boolean }> = [];
  for (const d of props.marks.doses) {
    chips.push({
      key: d.id,
      label: `${d.amount}${d.unit}`,
      color: d.peptide?.color,
    });
  }
  if (props.marks.weighIn) {
    chips.push({
      key: props.marks.weighIn.id,
      label: formatWeightChip(props.marks.weighIn.kg, props.unit),
      weight: true,
    });
  }
  if (chips.length === 0) return null;
  const visible = chips.slice(0, CAL_CHIP_CAP);
  const extra = chips.length - visible.length;
  return (
    <span className="cal-chips">
      {visible.map((c) => (
        <span
          key={c.key}
          className={c.weight ? "cal-chip weight" : "cal-chip"}
          style={c.color ? { background: c.color } : undefined}
        >
          {c.label}
        </span>
      ))}
      {extra > 0 ? <span className="cal-chip more">+{extra}</span> : null}
    </span>
  );
}
