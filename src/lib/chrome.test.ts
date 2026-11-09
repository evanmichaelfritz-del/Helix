import { afterEach, describe, expect, it, vi } from "vitest";
import { syncBackdropChrome } from "./chrome.ts";

type Supports = (property: string, value: string) => boolean;

function mount(supports: Supports | null, initial: string[] = []): Set<string> {
  const classes = new Set(initial);
  const root = {
    classList: {
      toggle(name: string, force?: boolean) {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
      contains: (name: string) => classes.has(name),
    },
  };
  const css = supports ? { supports } : undefined;
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("window", { CSS: css, document: { documentElement: root } });
  vi.stubGlobal("CSS", css);
  return classes;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("syncBackdropChrome", () => {
  it("sets no-backdrop only when both backdrop-filter probes fail", () => {
    const neither = mount(() => false);
    syncBackdropChrome();
    expect(neither.has("no-backdrop")).toBe(true);

    const standard = mount((property) => property === "backdrop-filter");
    syncBackdropChrome();
    expect(standard.has("no-backdrop")).toBe(false);

    const webkit = mount((property) => property === "-webkit-backdrop-filter");
    syncBackdropChrome();
    expect(webkit.has("no-backdrop")).toBe(false);
  });

  it("clears no-backdrop when support appears", () => {
    const classes = mount((property) => property === "backdrop-filter", ["no-backdrop"]);
    syncBackdropChrome();
    expect(classes.has("no-backdrop")).toBe(false);
  });

  it("no-ops when window, document, or CSS is missing", () => {
    expect(() => syncBackdropChrome()).not.toThrow();

    const classes = mount(null);
    expect(() => syncBackdropChrome()).not.toThrow();
    expect(classes.has("no-backdrop")).toBe(false);

    vi.stubGlobal("window", {});
    vi.stubGlobal("document", undefined);
    expect(() => syncBackdropChrome()).not.toThrow();
  });
});
