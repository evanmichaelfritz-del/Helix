import { MIX_UNITS, SYRINGE_CAPS, compactNum, mixLead, mixMeta, syringeMarks, type MixUnit, type SyringeCap, type VialMath } from "@shared/vial-math.ts";
import { cn } from "@shared/cn.ts";

export function SyringeChips(props: { value: SyringeCap; onChange: (value: SyringeCap) => void }) {
  return (
    <div className="syringe-chips" role="group" aria-label="Syringe">
      {SYRINGE_CAPS.map((cap) => (
        <button
          key={cap}
          type="button"
          className={cn("syringe-chip", props.value === cap && "on")}
          onClick={() => props.onChange(cap)}
        >
          {cap}u
        </button>
      ))}
    </div>
  );
}

export function SyringeRuler(props: { drawUnits: number; maxUnits?: number; color?: string }) {
  const max = props.maxUnits && props.maxUnits > 0 ? props.maxUnits : 100;
  const draw = Math.min(Math.max(props.drawUnits, 0), max);
  const pct = (draw / max) * 100;
  const marks = syringeMarks(max);
  const color = props.color ?? "var(--accent)";
  return (
    <div className="syringe">
      <div className="syringe-row">
        <span className="syringe-hub" aria-hidden />
        <span className="syringe-join" aria-hidden />
        <div className="syringe-barrel">
          <div className="syringe-fill" style={{ width: `${pct}%`, background: color }} />
          {marks.minor.map((n) => (
            <i key={`m-${n}`} className="syringe-tick minor" style={{ left: `${(n / max) * 100}%` }} />
          ))}
          {marks.labels.map((n) => (
            <i key={`M-${n}`} className="syringe-tick major" style={{ left: `${(n / max) * 100}%` }} />
          ))}
          <i className="syringe-tick draw" style={{ left: `${pct}%` }} />
          {marks.labels.map((n) => (
            <span
              key={`l-${n}`}
              className="syringe-label"
              style={{
                left: `${(n / max) * 100}%`,
                transform: n === 0 ? "translateX(0)" : n === max ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {n}
            </span>
          ))}
        </div>
        <span className="syringe-shaft" aria-hidden />
        <span className="syringe-tip" aria-hidden />
      </div>
      <p className="syringe-caption">
        {compactNum(draw)} / {max} u
      </p>
    </div>
  );
}

export function MixReadout(props: { math: VialMath; dose: number; unit: MixUnit }) {
  return (
    <div className="mix-readout">
      <p className="mix-lead">{mixLead(props.math, props.dose, props.unit)}</p>
      <p className="mix-meta">{mixMeta(props.math)}</p>
    </div>
  );
}

export function MixUnitSelect(props: { value: MixUnit; onChange: (unit: MixUnit) => void }) {
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value as MixUnit)}>
      {MIX_UNITS.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>
  );
}
