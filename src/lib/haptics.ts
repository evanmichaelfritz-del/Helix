import { GLASS_PRESS_SELECTOR } from "./glass-press.ts";

export type HapticKind = "tap" | "toggle";

export const HAPTIC_TAP_MS = 12;
export const HAPTIC_TOGGLE_MS: readonly number[] = [10, 28, 14];
export const HAPTIC_SELECTOR = `${GLASS_PRESS_SELECTOR}, .dock a, .rail a`;
export const HAPTIC_HIT_CLASS = "haptic-hit";

type VibrateFn = (pattern: number[]) => boolean;

export function hapticKindFor(el: Element): HapticKind {
  return el.matches(".toggle button") ? "toggle" : "tap";
}

export function isAppleTouch(
  ua = typeof navigator === "undefined" ? "" : navigator.userAgent,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
  points = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (platform === "MacIntel" && points > 1);
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

function moveHit(host: HTMLElement, hit: HTMLInputElement): void {
  const r = host.getBoundingClientRect();
  hit.style.left = `${r.left}px`;
  hit.style.top = `${r.top}px`;
  hit.style.width = `${r.width}px`;
  hit.style.height = `${r.height}px`;
}

function makeHit(host: HTMLElement): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.className = HAPTIC_HIT_CLASS;
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  input.addEventListener("click", (ev) => ev.stopPropagation());
  input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  input.addEventListener("change", () => {
    input.checked = false;
    if (host.isConnected) host.click();
  });
  document.body.append(input);
  return input;
}

export function bindHaptics(root: ParentNode = document): () => void {
  const coolUntil = new WeakMap<HTMLElement, number>();
  const hosts = new Set<HTMLElement>();
  const hits = new WeakMap<HTMLElement, HTMLInputElement>();
  const apple = isAppleTouch();

  function target(ev: Event): HTMLElement | null {
    if (ev instanceof MouseEvent && ev.button !== 0) return null;
    const raw = ev.target;
    if (!(raw instanceof Element)) return null;
    if (raw.closest(`.${HAPTIC_HIT_CLASS}`)) return null;
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

  function stamp(): void {
    const nodes = root.querySelectorAll(HAPTIC_SELECTOR);
    const seen = new Set<HTMLElement>();
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node instanceof HTMLButtonElement && node.disabled) continue;
      seen.add(node);
      if (!hits.has(node)) {
        const input = makeHit(node);
        hits.set(node, input);
        hosts.add(node);
      }
    }
    for (const host of hosts) {
      if (seen.has(host) && host.isConnected) continue;
      hits.get(host)?.remove();
      hosts.delete(host);
    }
    syncHits();
  }

  function syncHits(): void {
    for (const host of hosts) {
      const input = hits.get(host);
      if (!input) continue;
      if (!host.isConnected) {
        input.remove();
        hosts.delete(host);
        continue;
      }
      moveHit(host, input);
      input.style.pointerEvents = "none";
    }
    for (const host of hosts) {
      const input = hits.get(host);
      if (!input) continue;
      const r = host.getBoundingClientRect();
      const sized = r.width >= 8 && r.height >= 8;
      const top = sized
        ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        : null;
      const onTop = Boolean(top && (top === host || host.contains(top)));
      input.style.pointerEvents = sized && onTop ? "auto" : "none";
    }
  }

  let stampQueued = false;
  function queueStamp(): void {
    if (stampQueued) return;
    stampQueued = true;
    requestAnimationFrame(() => {
      stampQueued = false;
      stamp();
    });
  }

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("mousedown", onDown);
  root.addEventListener("click", onClick);

  let observer: MutationObserver | null = null;
  if (apple && typeof MutationObserver === "function" && document.body) {
    stamp();
    observer = new MutationObserver(queueStamp);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", syncHits, true);
    window.addEventListener("resize", syncHits);
  }

  return () => {
    root.removeEventListener("pointerdown", onDown);
    root.removeEventListener("mousedown", onDown);
    root.removeEventListener("click", onClick);
    observer?.disconnect();
    window.removeEventListener("scroll", syncHits, true);
    window.removeEventListener("resize", syncHits);
    for (const host of hosts) hits.get(host)?.remove();
    hosts.clear();
  };
}
