// @vitest-environment happy-dom
/**
 * The theme toggle's first click — where the store disagreed with its own hook.
 *
 * The persisted shape and the pre-hydration script are covered by
 * theme-fouc-script.test.jsx. THIS suite covers the state machine underneath
 * them, and the one setting it used to get wrong.
 *
 * `toggleTheme` computed the next theme from the RAW setting:
 *     currentTheme === "dark" ? "light" : "dark"
 * With the default `system` (config.js:39) on a dark-OS machine the raw value
 * is neither "dark" nor "light", so the ternary resolved `system → dark` —
 * the class stayed dark and the first click changed nothing at all, while the
 * button's own label flipped to "Switch to light mode". A control that reports
 * one thing and does nothing. The `useTheme` hook already derived `isDark`
 * correctly (`theme === "dark" || (theme === "system" && systemPrefersDark)`),
 * so the store and its hook held two different opinions of the same theme.
 *
 * ── Method ──────────────────────────────────────────────────────────────────
 * Deterministic, no browser: `window.matchMedia` is stubbed so the OS
 * preference is a fact of the test rather than of the machine running it. Each
 * case asserts BOTH the stored theme and the class on <html>, because the bug
 * was precisely that those two agreed with each other while disagreeing with
 * what the user saw.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * happy-dom under vitest 4 hands the test a `localStorage` that is a plain
 * object with no setItem/getItem at all (probed in theme-fouc-script.test.jsx).
 * zustand's `persist` reads storage at store creation, so the shim must exist
 * BEFORE the store module is evaluated — hence `vi.hoisted`, which runs ahead
 * of the import graph. If the environment ever ships a real Storage, this
 * leaves it untouched.
 */
const storage = vi.hoisted(() => {
  const existing = globalThis.localStorage;
  if (existing && typeof existing.getItem === "function") return existing;

  const map = new Map();
  const shim = {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  for (const target of [globalThis, globalThis.window]) {
    if (!target) continue;
    try { target.localStorage = shim; } catch { /* non-writable: defined below */ }
    try { Object.defineProperty(target, "localStorage", { value: shim, configurable: true }); } catch { /* already assigned */ }
  }
  return shim;
});

import useThemeStore from "@/store/themeStore";

/** Make the OS preference a fact of the test, not of the machine running it.
 *  `vi.stubGlobal` rather than a bare assignment: happy-dom defines
 *  `matchMedia` as a READ-ONLY property, so `window.matchMedia = …` throws
 *  `TypeError: Cannot assign to read only property`. stubGlobal installs it by
 *  descriptor and `vi.unstubAllGlobals()` puts the original back. */
function setSystemPrefersDark(prefersDark) {
  const impl = (query) => ({
    matches: query.includes("prefers-color-scheme: dark") ? prefersDark : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  vi.stubGlobal("matchMedia", vi.fn(impl));
}

const isDarkClass = () => document.documentElement.classList.contains("dark");

beforeEach(() => {
  storage.clear();
  useThemeStore.setState({ theme: "system" });
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("one click flips the theme the user can actually see", () => {
  it("system + a dark OS lands on light — the case that used to be a no-op", () => {
    setSystemPrefersDark(true);
    useThemeStore.getState().setTheme("system");
    expect(isDarkClass()).toBe(true); // the OS preference is honoured first

    useThemeStore.getState().toggleTheme();

    expect(useThemeStore.getState().theme).toBe("light");
    expect(isDarkClass()).toBe(false);
  });

  it("system + a light OS lands on dark", () => {
    setSystemPrefersDark(false);
    useThemeStore.getState().setTheme("system");
    expect(isDarkClass()).toBe(false);

    useThemeStore.getState().toggleTheme();

    expect(useThemeStore.getState().theme).toBe("dark");
    expect(isDarkClass()).toBe(true);
  });

  it("an explicit dark lands on light", () => {
    setSystemPrefersDark(true);
    useThemeStore.getState().setTheme("dark");

    useThemeStore.getState().toggleTheme();

    expect(useThemeStore.getState().theme).toBe("light");
    expect(isDarkClass()).toBe(false);
  });

  it("an explicit light lands on dark", () => {
    setSystemPrefersDark(false);
    useThemeStore.getState().setTheme("light");

    useThemeStore.getState().toggleTheme();

    expect(useThemeStore.getState().theme).toBe("dark");
    expect(isDarkClass()).toBe(true);
  });

  it("two clicks from system return to where it started", () => {
    setSystemPrefersDark(true);
    useThemeStore.getState().setTheme("system");

    useThemeStore.getState().toggleTheme();
    useThemeStore.getState().toggleTheme();

    expect(useThemeStore.getState().theme).toBe("dark");
    expect(isDarkClass()).toBe(true);
  });
});
