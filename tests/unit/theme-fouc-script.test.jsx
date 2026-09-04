// @vitest-environment happy-dom
/**
 * The pre-hydration theme script — the dark-mode flash fix.
 *
 * ThemeProvider calls initTheme() inside a useEffect, which runs AFTER first
 * paint, so a dark-mode user saw a light page for one frame on every load. The
 * fix is an inline script in layout.js's <head>. Nothing in React can do this:
 * by the time an effect runs the browser has already painted.
 *
 * ── THE BUG THIS SUITE PRIMARILY EXISTS TO CATCH ────────────────────────────
 * zustand's `persist` does not write a bare value. From its own source
 * (node_modules/zustand/esm/middleware.mjs:360):
 *     storage.setItem(options.name, { state, version })
 * wrapped by createJSONStorage's JSON.stringify (:300). So localStorage["theme"]
 * holds `{"state":{"theme":"dark"},"version":0}`.
 *
 * The obvious script — `if (localStorage.getItem("theme") === "dark")` — fails on
 * EVERY load while looking perfectly correct: getItem returns the JSON string,
 * which never === "dark", so the class is never added and the flash remains. That
 * is a silent failure with no console output and no test signal unless a test
 * feeds it the REAL persisted shape. So this suite writes the real shape, not a
 * convenient one.
 *
 * themeStore.js sets no `storage:` override (verified), so the default localStorage
 * JSON adapter applies. THEME_CONFIG.storageKey is "theme" and defaultTheme is
 * "system" (config.js:38-39).
 *
 * ── Method ──────────────────────────────────────────────────────────────────
 * The script is extracted from layout.js's SOURCE rather than reimplemented here,
 * so the test exercises the actual shipped string. Extracting by locating the
 * inlineScriptJson call makes the test brittle to a rename but honest to the
 * content; it fails loudly rather than testing a copy.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THEME_CONFIG } from "@/shared/constants/config";

const LAYOUT_SRC = readFileSync(
  join(process.cwd(), "src", "app", "layout.js"),
  "utf8"
);

/**
 * Build the same themeScript string layout.js builds, by executing layout.js's own
 * helper logic against the real THEME_CONFIG. Rather than re-deriving it (which
 * would let the test drift from the source), the IIFE body is pulled from the file.
 */
function extractThemeScript() {
  const start = LAYOUT_SRC.indexOf("const themeScript = `(function(){");
  if (start === -1) throw new Error("themeScript not found in layout.js — was it renamed?");
  const end = LAYOUT_SRC.indexOf("})();`;", start);
  if (end === -1) throw new Error("themeScript not terminated in layout.js");
  const templateBody = LAYOUT_SRC.slice(start + "const themeScript = `".length, end + "})();".length);

  // Resolve the two interpolations exactly as layout.js does. inlineScriptJson is
  // defined in the same file, so reimplementing it here would risk drift — assert
  // its shape is present in the source, then apply the same transformation.
  expect(LAYOUT_SRC).toContain("function inlineScriptJson(value)");
  const inlineScriptJson = (value) =>
    JSON.stringify(value)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026");

  return templateBody
    .replace(/\$\{inlineScriptJson\(THEME_CONFIG\.storageKey\)\}/g, inlineScriptJson(THEME_CONFIG.storageKey))
    .replace(/\$\{inlineScriptJson\(THEME_CONFIG\.defaultTheme\)\}/g, inlineScriptJson(THEME_CONFIG.defaultTheme));
}

const SCRIPT = extractThemeScript();

/**
 * happy-dom under vitest 4 hands the test a `localStorage` that is a plain OBJECT
 * with no setItem/getItem/removeItem at all (probed, not assumed:
 * `typeof localStorage.setItem === "undefined"` and
 * `Object.getOwnPropertyNames(Object.getPrototypeOf(localStorage))` lists only
 * Object.prototype's own methods). vitest also warns
 * "`--localstorage-file` was provided without a valid path", so it is
 * interposing its own storage that needs configuration.
 *
 * That is an environment gap, NOT a defect in the script under test — the script
 * is read verbatim from layout.js and is never modified here. So a minimal,
 * spec-shaped Storage is installed over the existing object. It backs onto a Map
 * and defines getItem/setItem/removeItem/clear/key/length, which is the surface
 * the script uses (getItem only) plus enough to assert with.
 *
 * Installed on BOTH globalThis.localStorage and window.localStorage, which the
 * probe showed are the same object (`localStorage === window.localStorage` is
 * true) — so one assignment covers both, but the shim is written to tolerate them
 * differing, since a future environment could split them.
 */
function installStorageShim() {
  const make = () => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
      setItem: (k, v) => { map.set(String(k), String(v)); },
      removeItem: (k) => { map.delete(String(k)); },
      clear: () => { map.clear(); },
      key: (i) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
      _map: map,
    };
  };
  const shim = make();
  // Assignment can silently no-op if the property is non-writable (and throws in
  // strict ESM, hence the try). defineProperty is the fallback that actually wins.
  const install = (obj) => {
    try { obj.localStorage = shim; } catch { /* fall through */ }
    if (typeof obj.localStorage?.setItem !== "function") {
      try {
        Object.defineProperty(obj, "localStorage", {
          value: shim, writable: true, configurable: true,
        });
      } catch { /* give up; the assertion below will surface it */ }
    }
  };
  install(globalThis);
  install(window);

  // Fail LOUDLY if the shim did not take, rather than letting every test below
  // error with the same opaque "setItem is not a function".
  if (typeof globalThis.localStorage.setItem !== "function") {
    throw new Error("storage shim failed to install — localStorage is not writable in this environment");
  }
  return shim;
}

const storage = installStorageShim();

/** The real zustand persist shape — NOT a bare string. */
function persisted(theme) {
  return JSON.stringify({ state: { theme }, version: 0 });
}

/**
 * Run the shipped inline script against a prepared DOM.
 *
 * WHY eval() IS USED, and why it is safe here (documented per the security hook):
 * The value being evaluated is `SCRIPT`, built by extractThemeScript() from
 * layout.js read off disk in THIS repository at test time. No network content, no
 * user input, no fixture data reaches it. The trust boundary is "my own source
 * file", which is the same trust boundary as importing the module.
 *
 * It is also the only way to test this code: the production artifact is an inline
 * <script> body inside dangerouslySetInnerHTML, not an importable function. The
 * alternatives are worse — reimplementing the logic in the test would let the test
 * drift from what actually ships (and then pass against a version that is not the
 * product), and appending a <script> element in happy-dom does not execute it.
 *
 * So: eval the real string, never a copy. That is the whole point of the suite.
 */
function runScriptWithStorage(themeValue) {
  // Reset the class and storage, install the value, run the script.
  document.documentElement.classList.remove("dark");
  try { localStorage.removeItem(THEME_CONFIG.storageKey); } catch {}
  if (themeValue !== undefined) {
    localStorage.setItem(THEME_CONFIG.storageKey, themeValue);
  }
  // eslint-disable-next-line no-eval -- see the block comment above: trusted own-source string
  eval(SCRIPT);
  return document.documentElement.classList.contains("dark");
}

function setSystemPrefersDark(prefersDark) {
  // happy-dom's matchMedia exists but returns a fixed non-matching result; stub it
  // so "system" can be exercised in both directions.
  window.matchMedia = (query) => ({
    matches: prefersDark && /prefers-color-scheme:\s*dark/.test(query),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

beforeEach(() => {
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  try { localStorage.removeItem(THEME_CONFIG.storageKey); } catch {}
  document.documentElement.classList.remove("dark");
});

// ────────────────────────────────────────────────────────────────
// The load-bearing cases: the REAL persisted shape
// ────────────────────────────────────────────────────────────────

describe("the theme script reads zustand's persisted shape", () => {
  it("applies .dark when theme is persisted as dark", () => {
    expect(runScriptWithStorage(persisted("dark"))).toBe(true);
  });

  it("does NOT apply .dark when theme is persisted as light", () => {
    expect(runScriptWithStorage(persisted("light"))).toBe(false);
  });

  it("follows the OS when theme is persisted as system and the OS is dark", () => {
    setSystemPrefersDark(true);
    expect(runScriptWithStorage(persisted("system"))).toBe(true);
  });

  it("does not apply .dark when theme is system and the OS is light", () => {
    setSystemPrefersDark(false);
    expect(runScriptWithStorage(persisted("system"))).toBe(false);
  });

  it("would FAIL on the naive bare-string read — proving the shape matters", () => {
    // This is the regression this whole suite guards. A script written as
    //   localStorage.getItem("theme") === "dark"
    // gets `false` here, because the stored value is the JSON envelope, not "dark".
    // Asserting the naive read fails is what makes the real one meaningful: without
    // it, a suite could pass against either implementation.
    const stored = persisted("dark");
    expect(stored === "dark").toBe(false);
    expect(JSON.parse(stored).state.theme).toBe("dark");
    // and the script, reading correctly, still gets it right
    expect(runScriptWithStorage(stored)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// Defaults and absence
// ────────────────────────────────────────────────────────────────

describe("the theme script handles a missing or unusable value", () => {
  it("falls back to THEME_CONFIG.defaultTheme when nothing is stored", () => {
    // defaultTheme is "system", so the result must follow the OS
    setSystemPrefersDark(true);
    expect(runScriptWithStorage(undefined)).toBe(true);
    setSystemPrefersDark(false);
    expect(runScriptWithStorage(undefined)).toBe(false);
  });

  it("survives corrupt JSON without throwing or touching the class", () => {
    // A user hand-editing storage, or a half-written value, must not break <head>.
    let threw = null;
    try {
      document.documentElement.classList.remove("dark");
      localStorage.setItem(THEME_CONFIG.storageKey, "{not json at all");
      eval(SCRIPT);
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("survives a JSON value with no state key", () => {
    expect(() => runScriptWithStorage(JSON.stringify({ version: 0 }))).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("survives a JSON value whose state.theme is not a string", () => {
    expect(
      () => runScriptWithStorage(JSON.stringify({ state: { theme: 42 }, version: 0 }))
    ).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("survives a bare string left by a different implementation", () => {
    // Forward-compat: if the store ever stops using zustand persist, a bare
    // "dark" should not crash the script. It falls back to the default instead of
    // being honoured, which is safe — and does not throw.
    expect(() => runScriptWithStorage("dark")).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────
// toggle, not add — so a light theme must REMOVE a stale .dark
// ────────────────────────────────────────────────────────────────

describe("the theme script toggles rather than only adds", () => {
  it("removes a stale .dark class when the persisted theme is light", () => {
    // classList.add-only would leave .dark on the element forever in that case.
    document.documentElement.classList.add("dark");
    localStorage.setItem(THEME_CONFIG.storageKey, persisted("light"));
    eval(SCRIPT);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("leaves .dark in place when the persisted theme is dark", () => {
    document.documentElement.classList.add("dark");
    localStorage.setItem(THEME_CONFIG.storageKey, persisted("dark"));
    eval(SCRIPT);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// The inline-script breakout guard
// ────────────────────────────────────────────────────────────────

describe("interpolated values cannot break out of the inline script", () => {
  it("the shipped script contains no literal </script>", () => {
    // JSON.stringify does NOT escape "/", so `</script>` inside an interpolated
    // value would terminate the <script> block early — in <head>, the worst
    // possible place. inlineScriptJson escapes < > & to their < forms.
    expect(SCRIPT).not.toContain("</script>");
  });

  it("the escape is what makes that true, and is applied to both interpolations", () => {
    // Prove the mechanism rather than the current values: a hostile value run
    // through the same escape cannot produce a script terminator, and still
    // parses back to itself.
    const hostile = 'a</script><script>alert(1)</script>';
    const escape = (v) =>
      JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
    const escaped = escape(hostile);

    expect(JSON.stringify(hostile)).toContain("</script>"); // stringify alone is NOT enough
    expect(escaped).not.toContain("</script>");
    expect(JSON.parse(escaped)).toBe(hostile);

    // and layout.js actually defines and uses that escape on both values
    expect(LAYOUT_SRC).toContain('replace(/</g, "\\\\u003c")');
    expect(LAYOUT_SRC).toContain("inlineScriptJson(THEME_CONFIG.storageKey)");
    expect(LAYOUT_SRC).toContain("inlineScriptJson(THEME_CONFIG.defaultTheme)");
  });

  it("the current config values are the safe literals, so no behaviour changes", () => {
    expect(THEME_CONFIG.storageKey).toBe("theme");
    expect(THEME_CONFIG.defaultTheme).toBe("system");
    // neither value contains a character the escape would alter, so the shipped
    // script is byte-identical to the naive JSON.stringify version today
    expect(JSON.stringify(THEME_CONFIG.storageKey)).toBe('"theme"');
    expect(SCRIPT).toContain('localStorage.getItem("theme")');
  });
});

// ────────────────────────────────────────────────────────────────
// Placement — a correct script in the wrong place does nothing
// ────────────────────────────────────────────────────────────────

describe("the script is placed where it can actually prevent the flash", () => {
  it("is injected in <head>, before the font gate", () => {
    const headStart = LAYOUT_SRC.indexOf("<head>");
    const themeInject = LAYOUT_SRC.indexOf("__html: themeScript");
    const fontInject = LAYOUT_SRC.indexOf("document.fonts.ready");
    expect(headStart).toBeGreaterThan(-1);
    expect(themeInject).toBeGreaterThan(headStart);
    expect(fontInject).toBeGreaterThan(themeInject);
  });

  it("the html element carries suppressHydrationWarning, which the script depends on", () => {
    // Mutating documentElement before React hydrates would warn about a class
    // mismatch without this. It was already present, and is now load-bearing.
    expect(LAYOUT_SRC).toContain("suppressHydrationWarning");
  });

  it("does NOT add a matchMedia change listener (useTheme.js already owns that)", () => {
    // Duplicating the listener would give two writers for the same class. This
    // script resolves the FIRST paint only; useTheme.js subscribes for later
    // changes via subscribeToSystemTheme and a `theme === "system"` listener.
    expect(SCRIPT).not.toContain("addEventListener");
    expect(SCRIPT).not.toContain("addListener");
  });
});
