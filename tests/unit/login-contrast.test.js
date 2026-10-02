import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The login gate's contrast guard.
 *
 * WHY THIS FILE EXISTS (plan §2.5, finding A3): the `--login-*` ledger shipped
 * three mutually inconsistent sets of ratios for the same tokens - the CSS
 * comments said one thing, `docs/design/login-tokens.dtcg.json` said another,
 * and the arithmetic said a third. No guard in the repository computed a
 * contrast ratio at all, so a green suite proved nothing about the one success
 * criterion the redesign leaned on. This file closes that hole.
 *
 * WHAT IT CHECKS, in two independent directions:
 *   1. ARITHMETIC - every token clears its WCAG floor against the ground it
 *      actually sits on (text 4.5:1, non-text 3:1).
 *   2. DECLARATION - when a token's own CSS comment states a ratio, that number
 *      must equal the computed one. A comment is a claim; this makes it a
 *      checkable one.
 *
 * WHAT IT CANNOT CHECK: the *composite* ground. The card is a translucent
 * gradient over the sky radial, and the tide stage drifts behind both. Those
 * are measured from rendered pixels in the browser walk; here the grounds are
 * the declared token values, named below.
 */

const CSS = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");

// --- the declared grounds -------------------------------------------------
// Every ratio below is against one of these, and each is asserted to still be
// declared in the stylesheet, so a ground cannot move out from under a ratio
// without this file going red.
const LIGHT = { page: "#F7F8FA", field: "#F1F3F7", card: "#F7F8FA" };
const DARK = { page: "#121D30", field: "#20304E", card: "#1A2842" };

const GROUND_DECLARATIONS = [
  "--color-bg: #F7F8FA",
  "--color-surface-2: #F1F3F7",
  "--color-bg: #121D30",
  "--color-surface-2: #20304E",
];

// --- the ledger -----------------------------------------------------------
// `ground` names which of the three grounds the token sits on. `floor` is the
// WCAG 2 threshold that applies to what the token paints.
const CASES = [
  { token: "--login-cta", ground: "own", floor: 4.5, paints: "text", note: "white CTA label on the fill" },
  { token: "--login-cta-hover", ground: "own", floor: 4.5, paints: "text", note: "white CTA label on the hover fill" },
  { token: "--login-field-border", ground: "field", floor: 3.0, paints: "nonText", note: "SC 1.4.11 control boundary" },
  { token: "--login-focus-ring", ground: "field", floor: 3.0, paints: "nonText", note: "SC 1.4.11 / 2.4.13 indicator" },
  { token: "--login-placeholder", ground: "field", floor: 4.5, paints: "text", note: "placeholder copy" },
  { token: "--login-eyebrow", ground: "page", floor: 4.5, paints: "text", note: "eyebrow over the sky" },
  { token: "--login-feature-icon", ground: "page", floor: 3.0, paints: "nonText", note: "feature glyph over the sky" },
  { token: "--login-footer", ground: "page", floor: 4.5, paints: "text", note: "footer line over the sky" },
  { token: "--login-warn", ground: "card", floor: 4.5, paints: "text", note: "lockout copy on the card" },
  { token: "--login-error-text", ground: "card", floor: 4.5, paints: "text", note: "error copy on the card" },
];

// --- colour helpers (WCAG 2.1 relative luminance, sRGB) -------------------
function parseHex(hex) {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}
function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const fmt = (n) => Math.round(n * 100) / 100;

// --- CSS region extraction (assert each selector appears exactly once) ----
function region(selector) {
  // Line-anchored: `.login-page {` must not match inside `.dark .login-page {`.
  const pattern = new RegExp("^" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{$", "m");
  const match = pattern.exec(CSS);
  const at = match ? match.index : -1;
  expect(at, `selector not found: ${selector}`).toBeGreaterThan(-1);
  const second = new RegExp("^" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{$", "gm");
  expect(second.exec(CSS.slice(at + 1)), `selector not unique: ${selector}`).toBeNull();
  let depth = 0;
  const open = CSS.indexOf("{", at);
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === "{") depth += 1;
    if (CSS[i] === "}") {
      depth -= 1;
      if (depth === 0) return CSS.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced block: ${selector}`);
}

/** The declaration line for a token inside a region (for value + comment). */
function declaration(blockText, token) {
  const line = blockText.split("\n").find((l) => {
    const t = l.trim();
    // A comment line can begin with the token name (the ledger's prose does);
    // only a real declaration carries the colon.
    if (t.startsWith("/*") || t.startsWith("*") || t.startsWith("//")) return false;
    return t.startsWith(token + ":");
  });
  return line || null;
}

/**
 * The declaration that governs a token on a given shore. Tokens that do not
 * differ per theme are declared once in `.login-page` and inherited by
 * `.dark .login-page` - exactly as the cascade resolves them - so a missing
 * dark declaration falls back to the light one rather than failing.
 */
function governingDeclaration(login, token, loginLightBlock) {
  return declaration(login, token) || declaration(loginLightBlock, token);
}

/** Resolve `var(--x)` one level against the light/dark global token blocks. */
function resolveValue(raw, themeBlocks) {
  const v = raw.replace(/\/\*.*/, "").replace(/;\s*$/, "").trim();
  const alias = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (!alias) return v;
  for (const blockText of themeBlocks) {
    const decl = declaration(blockText, alias[1]);
    if (decl) return decl.slice(decl.indexOf(":") + 1).replace(/\/\*.*/, "").trim();
  }
  throw new Error(`unresolved alias: ${raw}`);
}

const loginLight = region(".login-page");
const loginDark = region(".dark .login-page");
// The global token blocks, for alias resolution only (first match wins).
const globalLight = region(":root");
const globalDark = region(".dark");

/** Every `N.NN:1` a declaration's comment states, in order. */
function statedRatios(line) {
  return [...(line.match(/(\d+\.\d+):1/g) || [])].map((s) => parseFloat(s));
}

describe("the login contrast ledger", () => {
  it("the declared grounds are still declared", () => {
    for (const decl of GROUND_DECLARATIONS) {
      expect(CSS, `ground moved out from under the ratios: ${decl}`).toContain(decl);
    }
  });

  for (const { token, ground, floor, note } of CASES) {
    for (const [shore, blocks, login, grounds] of [
      ["light", [globalLight], loginLight, LIGHT],
      ["dark", [globalDark], loginDark, DARK],
    ]) {
      it(`${token} (${shore}) clears ${floor}:1 - ${note}`, () => {
        const decl = governingDeclaration(login, token, loginLight);
        expect(decl, `${token} not declared for ${shore}`).toBeTruthy();
        const value = resolveValue(decl.slice(decl.indexOf(":") + 1), blocks);
        expect(value).toMatch(/^#/);

        const groundHex = ground === "own" ? value : grounds[ground];
        // The label painted on the fill is the app's white; every other case is
        // the token against its ground.
        const fg = ground === "own" ? "#FFFFFF" : value;
        const measured = fmt(contrast(fg, groundHex));

        expect(
          measured,
          `${token} ${shore}: ${fg} on ${groundHex} = ${measured}:1, floor ${floor}:1`,
        ).toBeGreaterThanOrEqual(floor);

        // Declaration half: a stated ratio must be the computed one.
        // A declaration shared by both shores may state both ratios -
        // "light X:1, dark Y:1" - so the dark shore reads the second number.
        const stated = statedRatios(decl);
        if (stated.length) {
          const expected = shore === "dark" && stated.length > 1 ? stated[1] : stated[0];
          expect(
            expected,
            `${token} ${shore}: comment says ${expected}:1, arithmetic says ${measured}:1`,
          ).toBe(measured);
        }
      });
    }
  }

  it("prints the measured ledger (the numbers the comments must carry)", () => {
    const rows = [];
    for (const { token, ground } of CASES) {
      for (const [shore, blocks, login, grounds] of [
        ["light", [globalLight], loginLight, LIGHT],
        ["dark", [globalDark], loginDark, DARK],
      ]) {
        const decl = governingDeclaration(login, token, loginLight);
        const value = resolveValue(decl.slice(decl.indexOf(":") + 1), blocks);
        const groundHex = ground === "own" ? value : grounds[ground];
        const fg = ground === "own" ? "#FFFFFF" : value;
        rows.push(`${token} ${shore}: ${fg} on ${groundHex} = ${fmt(contrast(fg, groundHex))}:1`);
      }
    }
    console.log("\n" + rows.join("\n"));
    expect(rows.length).toBe(CASES.length * 2);
  });
});
