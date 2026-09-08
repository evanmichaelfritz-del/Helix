export const GLASS_PRESS_CLASS = "is-pressing";
export const GLASS_RIPPLE_CLASS = "is-rippling";
export const GLASS_PRESS_HOLD_MS = 320;
export const GLASS_RIPPLE_MS = 320;
export const GLASS_RIPPLE_ACCENT_PCT = 36;
export const GLASS_PRESS_TARGETS = [
  ".btn",
  ".tabs button",
  ".subnav a",
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
] as const;
export const GLASS_PRESS_SELECTOR = GLASS_PRESS_TARGETS.join(", ");

export function glassEffectsReduced(
  root?: { classList: { contains: (name: string) => boolean } } | null,
  query?: ((q: string) => { matches: boolean }) | null,
): boolean {
  const el =
    root === undefined ? (typeof document === "undefined" ? null : document.documentElement) : root;
  if (el?.classList.contains("reduce-effects")) return true;
  const mq =
    query === undefined ? (typeof matchMedia === "function" ? matchMedia.bind(globalThis) : null) : query;
  if (!mq) return false;
  try {
    return mq("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function rippleOrigin(
  el: { getBoundingClientRect: () => { left: number; top: number; width: number; height: number } },
  ev: Event,
): { x: string; y: string } {
  const point = ev as Event & { clientX?: number; clientY?: number };
  if (typeof point.clientX !== "number" || typeof point.clientY !== "number") {
    return { x: "50%", y: "50%" };
  }
  if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) {
    return { x: "50%", y: "50%" };
  }
  const r = el.getBoundingClientRect();
  const w = r.width || 1;
  const h = r.height || 1;
  const x = ((point.clientX - r.left) / w) * 100;
  const y = ((point.clientY - r.top) / h) * 100;
  return {
    x: `${Math.min(100, Math.max(0, x))}%`,
    y: `${Math.min(100, Math.max(0, y))}%`,
  };
}

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
  const rippleTimer = new WeakMap<HTMLElement, number>();

  function clearTimer(el: HTMLElement): void {
    const id = releaseTimer.get(el);
    if (id === undefined) return;
    window.clearTimeout(id);
    releaseTimer.delete(el);
  }

  function clearRipple(el: HTMLElement): void {
    const id = rippleTimer.get(el);
    if (id !== undefined) {
      window.clearTimeout(id);
      rippleTimer.delete(el);
    }
    el.classList.remove(GLASS_RIPPLE_CLASS);
  }

  function pulseRipple(el: HTMLElement, ev: Event): void {
    clearRipple(el);
    if (glassEffectsReduced()) return;
    const origin = rippleOrigin(el, ev);
    el.style.setProperty("--ripple-x", origin.x);
    el.style.setProperty("--ripple-y", origin.y);
    void el.offsetWidth;
    el.classList.add(GLASS_RIPPLE_CLASS);
    const id = window.setTimeout(() => {
      el.classList.remove(GLASS_RIPPLE_CLASS);
      rippleTimer.delete(el);
    }, GLASS_RIPPLE_MS);
    rippleTimer.set(el, id);
  }

  function onDown(ev: Event): void {
    const el = pressTarget(ev);
    if (!el) return;
    clearTimer(el);
    el.classList.add(GLASS_PRESS_CLASS);
    startedAt.set(el, Date.now());
    pulseRipple(el, ev);
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
      pulseRipple(el, ev);
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
