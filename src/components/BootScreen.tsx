const RUNG_COUNT = 16;
const LETTERS = ["H", "E", "L", "I", "X"] as const;
const MOTES = [0, 1, 2, 3, 4] as const;

export function BootScreen() {
  return (
    <div className="boot" role="status" aria-live="polite" aria-label="Loading Helix">
      <div className="boot-fx" aria-hidden="true">
        <div className="boot-wash" />
        <div className="boot-grid" />
        <div className="boot-scan" />
        <div className="boot-motes">
          {MOTES.map((i) => (
            <i key={i} />
          ))}
        </div>
      </div>
      <div className="boot-stage" aria-hidden="true">
        <div className="boot-halo" />
        <div className="boot-ring boot-ring-a" />
        <div className="boot-ring boot-ring-b" />
        <div className="boot-ring boot-ring-c" />
        <div className="boot-core">
          <div className="boot-helix">
            {Array.from({ length: RUNG_COUNT }, (_, i) => (
              <i key={i} />
            ))}
          </div>
        </div>
      </div>
      <p className="boot-word">
        {LETTERS.map((letter) => (
          <span key={letter}>{letter}</span>
        ))}
      </p>
      <div className="boot-meter" aria-hidden="true">
        <i />
      </div>
      <p className="boot-kicker">calibrating</p>
    </div>
  );
}
