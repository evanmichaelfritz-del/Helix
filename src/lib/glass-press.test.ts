import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GLASS_PRESS_CLASS,
  GLASS_PRESS_SELECTOR,
  GLASS_PRESS_TARGETS,
  GLASS_RIPPLE_CLASS,
  GLASS_RIPPLE_MS,
  glassEffectsReduced,
} from "./glass-press.ts";

const LOCKED_TARGETS = [
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
] as const;

describe("glass-press lock", () => {
  it("keeps the signed glass-press selector list", () => {
    expect([...GLASS_PRESS_TARGETS]).toEqual([...LOCKED_TARGETS]);
    expect(GLASS_PRESS_SELECTOR).toBe(LOCKED_TARGETS.join(", "));
    expect(GLASS_PRESS_CLASS).toBe("is-pressing");
    expect(GLASS_RIPPLE_CLASS).toBe("is-rippling");
  });

  it("skips ripple when html.reduce-effects or prefers-reduced-motion", () => {
    const html = { classList: { contains: (name: string) => name === "reduce-effects" } };
    expect(glassEffectsReduced(html, null)).toBe(true);
    const quiet = { classList: { contains: () => false } };
    expect(glassEffectsReduced(quiet, () => ({ matches: true }))).toBe(true);
    expect(glassEffectsReduced(quiet, () => ({ matches: false }))).toBe(false);
    expect(glassEffectsReduced(quiet, null)).toBe(false);
  });

  it("maps James Labi rim, soft press, mint ripple, and mint active onto CSS tokens", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const binder = readFileSync("src/lib/glass-press.ts", "utf8");
    const pkg = readFileSync("package.json", "utf8");

    expect(css).toMatch(/--glass-inset:\s*inset 0 2px 0/);
    expect(css).toMatch(/--glass-press-scale:\s*0\.97/);
    expect(css).toMatch(/--glass-press-ease:\s*0\.16s ease-out/);
    expect(css).toMatch(/html\.reduce-effects \{[\s\S]*?--glass-press-scale:\s*1/);
    expect(css).toMatch(/\.btn:active, \.btn\.is-pressing \{ transform: scale\(var\(--glass-press-scale\)\)/);
    expect(css).toMatch(/@keyframes glass-ripple/);
    expect(css).toMatch(new RegExp(`animation: glass-ripple ${GLASS_RIPPLE_MS}ms ease-out`));
    expect(css).toMatch(/\.reduce-effects \.is-rippling::before \{[\s\S]*?animation: none/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*?\.is-rippling::before \{[\s\S]*?animation: none/);
    expect(css).toMatch(/\.reduce-effects \.btn,[\s\S]*?background: var\(--primary\)/);
    expect(css).toMatch(/\.reduce-effects \.tabs button\.on,[\s\S]*?background: var\(--primary\)/);
    expect(css).toMatch(/\.tabs button\.on \{[\s\S]*?background: color-mix\(in srgb, var\(--primary\)/);
    expect(css).toMatch(/\.day-pill\.on, \.time-pill\.on \{[\s\S]*?background: color-mix\(in srgb, var\(--primary\)/);
    expect(css).toMatch(/\.toggle button\.on \{[\s\S]*?background: color-mix\(in srgb, var\(--primary\)/);
    expect(css).toMatch(/\.theme-pick\.on \{[\s\S]*?background: color-mix\(in srgb, var\(--primary\)/);
    expect(css).toMatch(/\.chrome \{[\s\S]*?backdrop-filter: var\(--glass-blur\)/);
    expect(css).toMatch(/--glass-blur:\s*blur\(22px\)/);
    expect(css).toMatch(/^\.card \{[\s\S]*?background:\s*var\(--solid\)/m);
    expect(binder).toMatch(/glassEffectsReduced\(\)/);
    expect(binder).toMatch(/GLASS_RIPPLE_CLASS/);
    expect(binder).toMatch(/GLASS_PRESS_CLASS/);
    expect(pkg).not.toMatch(/framer-motion/);
  });
});
