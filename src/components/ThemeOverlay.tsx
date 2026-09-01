import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { THEME_CARDS } from "@shared/theme.ts";
import type { ThemePref } from "@shared/types.ts";
import { applyChrome } from "../lib/chrome.ts";

export function ThemeOverlay(props: {
  theme: ThemePref;
  reduceEffects: boolean;
  onCancel: () => void;
  onSave: (theme: ThemePref) => void;
}) {
  const titleId = useId();
  const [draft, setDraft] = useState<ThemePref>(props.theme);

  useEffect(() => {
    applyChrome({ theme: draft, reduceEffects: props.reduceEffects });
  }, [draft, props.reduceEffects]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== "Escape") return;
      applyChrome({ theme: props.theme, reduceEffects: props.reduceEffects });
      props.onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.theme, props.reduceEffects, props.onCancel]);

  function revert() {
    applyChrome({ theme: props.theme, reduceEffects: props.reduceEffects });
    props.onCancel();
  }

  return createPortal(
    <div className="theme-overlay-backdrop" onClick={revert} role="presentation">
      <div
        className="theme-overlay card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="theme-overlay-head">
          <h2 id={titleId}>Display Settings</h2>
        </header>
        <p className="theme-overlay-kicker">Color Mode</p>
        <p className="muted">Choose your interface style</p>
        <div className="theme-picks" role="radiogroup" aria-label="Color mode">
          {THEME_CARDS.map((card) => {
            const on = draft === card.value;
            return (
              <button
                key={card.value}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? "theme-pick on" : "theme-pick"}
                onClick={() => setDraft(card.value)}
              >
                <ThemeMini pref={card.value} />
                <span className="theme-pick-label">{card.label}</span>
              </button>
            );
          })}
        </div>
        <div className="theme-overlay-foot">
          <button type="button" className="btn ghost" onClick={revert}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={() => props.onSave(draft)}>
            Save Changes
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ThemeMini({ pref }: { pref: ThemePref }) {
  if (pref === "system") {
    return (
      <span className="theme-mini theme-mini-system" aria-hidden="true">
        <ThemeMiniPane tone="dark" />
        <ThemeMiniPane tone="light" />
      </span>
    );
  }
  return <ThemeMiniPane tone={pref} />;
}

function ThemeMiniPane({ tone }: { tone: "dark" | "light" }) {
  return (
    <span className={`theme-mini theme-mini-${tone}`} aria-hidden="true">
      <b />
      <span>
        <i />
        <i />
      </span>
    </span>
  );
}
