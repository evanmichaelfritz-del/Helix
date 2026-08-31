import type { ThemePref } from "./types.js";

export const HELIX_THEME_KEY = "helix-theme";
export const THEME_COLOR_DARK = "#1c1c1e";
export const THEME_COLOR_LIGHT = "#e7e8ee";

export const THEME_OPTIONS = [
  { value: "system", label: "Follow system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

export const THEME_CARDS = [
  { value: "dark", label: "Dark Mode" },
  { value: "light", label: "Light Mode" },
  { value: "system", label: "System" },
] as const;

export function themeOptionLabel(pref: ThemePref): string {
  for (const opt of THEME_OPTIONS) {
    if (opt.value === pref) return opt.label;
  }
  return "Follow system";
}

export function parseThemePref(raw: string | null | undefined): ThemePref {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function isDarkTheme(pref: ThemePref, prefersDark: boolean): boolean {
  return pref === "dark" || (pref === "system" && prefersDark);
}

export function themeColor(dark: boolean): string {
  return dark ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
}
