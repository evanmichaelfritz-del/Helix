import { cn } from "@shared/cn.ts";
import type { PeptideSchedule, Weekday } from "@shared/schedule.ts";
import { WEEKDAY_LABELS } from "@shared/schedule.ts";

type Props = {
  schedule: PeptideSchedule;
  onChange: (schedule: PeptideSchedule) => void;
  disabled?: boolean;
};

export function PeptideScheduleEditor({ schedule, onChange, disabled }: Props) {
  function toggleDay(day: Weekday) {
    const has = schedule.days.includes(day);
    const days = has ? schedule.days.filter((d) => d !== day) : [...schedule.days, day];
    onChange({ ...schedule, days: days.sort((a, b) => a - b) as Weekday[] });
  }

  function toggleTime(key: "morning" | "evening") {
    const next = { ...schedule, [key]: !schedule[key] };
    if (!next.morning && !next.evening) next.morning = true;
    onChange(next);
  }

  return (
    <div className="schedule-editor">
      <div className="schedule-block">
        <span className="schedule-label">Days</span>
        <div className="day-pills" role="group" aria-label="Days of week">
          {WEEKDAY_LABELS.map((label, day) => (
            <button
              key={label}
              type="button"
              className={cn("day-pill", schedule.days.includes(day as Weekday) && "on")}
              aria-pressed={schedule.days.includes(day as Weekday)}
              disabled={disabled}
              onClick={() => toggleDay(day as Weekday)}
            >
              {label.slice(0, 1)}
            </button>
          ))}
        </div>
      </div>
      <div className="schedule-block">
        <span className="schedule-label">Time</span>
        <div className="time-pills" role="group" aria-label="Time of day">
          <button
            type="button"
            className={cn("time-pill", schedule.morning && "on")}
            aria-pressed={schedule.morning}
            disabled={disabled}
            onClick={() => toggleTime("morning")}
          >
            Morning
          </button>
          <button
            type="button"
            className={cn("time-pill", schedule.evening && "on")}
            aria-pressed={schedule.evening}
            disabled={disabled}
            onClick={() => toggleTime("evening")}
          >
            Evening
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      className={cn("chevron", open && "open")}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
