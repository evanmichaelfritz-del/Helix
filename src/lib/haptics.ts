import { GLASS_PRESS_SELECTOR } from "./glass-press.ts";

export type HapticKind = "tap" | "toggle";

export const HAPTIC_TAP_MS = 12;
export const HAPTIC_TOGGLE_MS: readonly number[] = [10, 28, 14];
export const HAPTIC_SELECTOR = `${GLASS_PRESS_SELECTOR}, .dock a, .rail a`;

type VibrateFn = (pattern: number[]) => boolean;

export function hapticKindFor(el: Element): HapticKind {
  return el.matches(".toggle button") ? "toggle" : "tap";
}

function navigatorVibrate(): VibrateFn | null {
  if (typeof navigator === "undefined") return null;
  const fn = navigator.vibrate;
  if (typeof fn !== "function") return null;
  return (pattern) => fn.call(navigator, pattern);
}

export function haptic(kind: HapticKind, vibrate?: VibrateFn | null): boolean {
  const run = vibrate === undefined ? navigatorVibrate() : vibrate;
  if (!run) return false;
  const pattern = kind === "toggle" ? [...HAPTIC_TOGGLE_MS] : [HAPTIC_TAP_MS];
  try {
    return run(pattern);
  } catch {
    return false;
  }
}

export function bindHaptics(root: ParentNode = document): () => void {
  const coolUntil = new WeakMap<HTMLElement, number>();

  function target(ev: Event): HTMLElement | null {
    if (ev instanceof MouseEvent && ev.button !== 0) return null;
    const raw = ev.target;
    if (!(raw instanceof Element)) return null;
    const hit = raw.closest(HAPTIC_SELECTOR);
    if (!(hit instanceof HTMLElement)) return null;
    if (hit instanceof HTMLButtonElement && hit.disabled) return null;
    return hit;
  }

  function fire(el: HTMLElement): void {
    const now = Date.now();
    if (now < (coolUntil.get(el) ?? 0)) return;
    coolUntil.set(el, now + 80);
    haptic(hapticKindFor(el));
  }

  function onDown(ev: Event): void {
    const el = target(ev);
    if (el) fire(el);
  }

  function onClick(ev: Event): void {
    const el = target(ev);
    if (el) fire(el);
  }

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("mousedown", onDown);
  root.addEventListener("click", onClick);
  return () => {
    root.removeEventListener("pointerdown", onDown);
    root.removeEventListener("mousedown", onDown);
    root.removeEventListener("click", onClick);
  };
}
