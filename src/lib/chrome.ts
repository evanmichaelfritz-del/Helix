import type { ThemePref } from "@shared/types.ts";
import {
  HELIX_THEME_KEY,
  isDarkTheme,
  parseThemePref,
  themeColor,
} from "@shared/theme.ts";

declare global {
  interface Window {
    __HELIX_THEME_BOOTED?: boolean;
  }
}

export function themeBooted(): boolean {
  return typeof window !== "undefined" && window.__HELIX_THEME_BOOTED === true;
}

export function readStoredTheme(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(HELIX_THEME_KEY));
  } catch {
    return "system";
  }
}

export function persistHelixTheme(theme: ThemePref): void {
  if (!themeBooted()) return;
  localStorage.setItem(HELIX_THEME_KEY, theme);
}

export function applyChrome(opts: { theme: ThemePref; reduceEffects: boolean }): void {
  const root = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = isDarkTheme(opts.theme, prefersDark);
  root.classList.toggle("light", !dark);
  root.classList.toggle("reduce-effects", opts.reduceEffects);
  delete root.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", themeColor(dark));
}

export function watchSystemTheme(
  getOpts: () => { theme: ThemePref; reduceEffects: boolean },
): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    const opts = getOpts();
    if (opts.theme === "system") applyChrome(opts);
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const KEY = (userId: string) => `helix:faceId:${userId}`;

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buf(id: string): ArrayBuffer {
  const pad = id.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(pad + "==".slice((pad.length + 3) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

export function storedCredentialId(userId: string): string | null {
  return localStorage.getItem(KEY(userId));
}

export function faceIdAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

export async function registerFaceId(opts: { userId: string; email: string }): Promise<boolean> {
  if (!faceIdAvailable()) return false;
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Helix", id: location.hostname },
      user: {
        id: new TextEncoder().encode(opts.userId),
        name: opts.email,
        displayName: opts.email,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
      },
      timeout: 60_000,
    },
  });
  if (!cred || !(cred instanceof PublicKeyCredential)) return false;
  localStorage.setItem(KEY(opts.userId), b64(cred.rawId));
  return true;
}

export async function unlockFaceId(userId: string): Promise<boolean> {
  const id = storedCredentialId(userId);
  if (!id || !faceIdAvailable()) return false;
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: buf(id) }],
      userVerification: "required",
      timeout: 60_000,
    },
  });
  return Boolean(cred);
}

export function clearFaceId(userId: string): void {
  localStorage.removeItem(KEY(userId));
}
