export const GLASS_PRESS_CLASS = "is-pressing";
export const GLASS_PRESS_HOLD_MS = 320;
export const GLASS_PRESS_SELECTOR = [
  ".btn",
  ".tabs button",
  ".toggle button",
  ".quick-log-btn",
  ".expand-btn",
  ".day-pill",
  ".time-pill",
  ".fab",
  ".fab-item",
  ".stepper button",
  ".cal-nav button",
  ".theme-open",
  ".theme-pick",
  ".theme-x",
].join(", ");

function pressTarget(ev: Event): HTMLElement | null {
  if (ev instanceof MouseEvent && ev.button !== 0) return null;
  const raw = ev.target;
  if (!(raw instanceof Element)) return null;
  const hit = raw.closest(GLASS_PRESS_SELECTOR);
  if (!(hit instanceof HTMLElement)) return null;
  if (hit instanceof HTMLButtonElement && hit.disabled) return null;
  return hit;
}

export function bindGlassPress(root: ParentNode = document): () => void {
  const startedAt = new WeakMap<HTMLElement, number>();
  const releaseTimer = new WeakMap<HTMLElement, number>();

  function clearTimer(el: HTMLElement): void {
    const id = releaseTimer.get(el);
    if (id === undefined) return;
    window.clearTimeout(id);
    releaseTimer.delete(el);
  }

  function onDown(ev: Event): void {
    const el = pressTarget(ev);
    if (!el) return;
    clearTimer(el);
    el.classList.add(GLASS_PRESS_CLASS);
    startedAt.set(el, Date.now());
  }

  function onUp(ev: Event): void {
    const el = pressTarget(ev);
    if (!el || !el.classList.contains(GLASS_PRESS_CLASS)) return;
    const started = startedAt.get(el) ?? Date.now();
    const wait = Math.max(0, GLASS_PRESS_HOLD_MS - (Date.now() - started));
    clearTimer(el);
    const id = window.setTimeout(() => {
      el.classList.remove(GLASS_PRESS_CLASS);
      startedAt.delete(el);
      releaseTimer.delete(el);
    }, wait);
    releaseTimer.set(el, id);
  }

  function onClick(ev: Event): void {
    const el = pressTarget(ev);
    if (!el) return;
    if (!el.classList.contains(GLASS_PRESS_CLASS)) {
      el.classList.add(GLASS_PRESS_CLASS);
      startedAt.set(el, Date.now());
    }
    onUp(ev);
  }

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("mousedown", onDown);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("mouseup", onUp);
  root.addEventListener("pointercancel", onUp);
  root.addEventListener("click", onClick);
  return () => {
    root.removeEventListener("pointerdown", onDown);
    root.removeEventListener("mousedown", onDown);
    root.removeEventListener("pointerup", onUp);
    root.removeEventListener("mouseup", onUp);
    root.removeEventListener("pointercancel", onUp);
    root.removeEventListener("click", onClick);
  };
}
