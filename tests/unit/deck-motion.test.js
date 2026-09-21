/**
 * deck-motion.test.js — the dashboard's entrance choreography, asserted as
 * SOURCE claims plus an opt-in BUILT-CSS proof.
 *
 * The split matches globals-css-tokens.test.js and is deliberate:
 *  · SOURCE assertions (always run) prove what was written.
 *  · BUILT assertions (skipped when .next/static/css is absent) prove what the
 *    compiler EMITTED. They skip rather than fake-pass when there is no build.
 *
 * ── WHY THE `backwards` ASSERTION IS THE IMPORTANT ONE ──────────────────────
 *
 * A filled CSS animation leaves `transform: translateY(0)` on the element for
 * the rest of its life, and a non-none transform makes that element a
 * CONTAINING BLOCK for `position: fixed` descendants. The dashboard has 29
 * `<Modal` mounts, and Modal.js / Drawer.js render `fixed inset-0` INLINE with
 * no portal to escape through — so switching `.deck-enter` from `backwards` to
 * `forwards` (a one-word edit, and the intuitive one) would silently anchor
 * every modal in the app to the page wrapper instead of the viewport.
 *
 * That is a plausible bug with a catastrophic blast radius and no visible
 * symptom until a modal is opened, which is exactly the kind of contract a
 * test should defend rather than a comment.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const CSS_PATH = join(process.cwd(), "src", "app", "globals.css");
const CSS_SRC = readFileSync(CSS_PATH, "utf8");
const LAYOUT_SRC = readFileSync(
  join(process.cwd(), "src", "shared", "components", "layouts", "DashboardLayout.js"),
  "utf8"
);

/**
 * Strip comments before searching source.
 *
 * Every assertion below needs this — it is the lesson already sealed in this
 * repo as `negative-regex-source-guard-defeated-by-comment`: the comments in
 * globals.css DISCUSS `forwards` and `both` at length precisely because they
 * explain why `backwards` was chosen, so a naive search would find the
 * forbidden words in prose and conclude the rule was wrong.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CSS = stripComments(CSS_SRC);

/** All declaration bodies belonging to a selector that starts with `sel`. */
function ruleBodiesFor(src, sel) {
  const out = [];
  const re = new RegExp(`${sel.source}[^{}]*\\{([^}]*)\\}`, "g");
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

/** The @media (prefers-reduced-motion: reduce) block, braces balanced. */
function reducedMotionBlock(src) {
  const start = src.indexOf("@media (prefers-reduced-motion: reduce)");
  if (start === -1) return "";
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}

describe("deck motion — tokens", () => {
  const REQUIRED = [
    "--motion-dur-instant",
    "--motion-dur-quick",
    "--motion-dur-base",
    "--motion-dur-slow",
    "--motion-stagger",
    "--motion-rise",
    "--motion-ease-out",
    "--motion-ease-inout",
    "--motion-ease-spring",
  ];

  it.each(REQUIRED)("declares %s in :root", (token) => {
    expect(CSS).toContain(`${token}:`);
  });

  it("keeps every deck duration short enough for a repeatedly-visited panel", () => {
    // A dashboard is opened dozens of times a day. Anything past a second is a
    // stage cue, not an instrument-panel transition — so the tokens themselves
    // are bounded rather than each consumer being trusted to choose.
    const durations = [...CSS.matchAll(/--motion-dur-[a-z]+:\s*(\d+)ms/g)].map((m) => Number(m[1]));
    expect(durations.length).toBeGreaterThanOrEqual(4);
    for (const d of durations) {
      expect(d).toBeLessThanOrEqual(1000);
      expect(d).toBeGreaterThan(0);
    }
  });
});

describe("deck motion — the entrance", () => {
  it("defines the deckEnter keyframes with a rise and a fade", () => {
    expect(CSS).toMatch(/@keyframes\s+deckEnter\s*\{/);
    const body = ruleBodiesFor(CSS, /@keyframes\s+deckEnter/).join("");
    expect(body).toContain("opacity: 0");
    expect(body).toContain("translateY(var(--motion-rise))");
  });

  it("matches both page shapes, so no route is left still", () => {
    // 12 of the 29 routes return a single root element, where `> *` would match
    // exactly one node and produce no sequence at all. The second selector
    // reaches one level deeper for exactly that case.
    const joined = ruleBodiesFor(CSS, /\.deck-enter\s*>\s*\*:not\(:only-child\)/).join("");
    expect(joined).not.toBe("");
    const deeper = ruleBodiesFor(CSS, /\.deck-enter\s*>\s*:only-child\s*>\s*\*/).join("");
    expect(deeper).not.toBe("");
  });

  it("animates the sequence with `backwards` fill — NEVER forwards or both", () => {
    const bodies = ruleBodiesFor(CSS, /\.deck-enter/);
    const animDecls = bodies.filter((b) => /animation\s*:/.test(b));
    expect(animDecls.length).toBeGreaterThan(0);
    const all = animDecls.join("\n");

    // The load-bearing word. `backwards` applies the from-state during the
    // delay, plays, then RELEASES the element to its natural style — so the
    // transform exists only while it is moving. Any other fill keeps a live
    // transform forever, which captures every `fixed inset-0` modal.
    expect(all).toContain("backwards");
    expect(all).not.toMatch(/\bforwards\b/);
    expect(all).not.toMatch(/\bboth\b/);
  });

  it("drives the sequence from tokens rather than hardcoded times", () => {
    const bodies = ruleBodiesFor(CSS, /\.deck-enter/);
    const all = bodies.join("\n");
    expect(all).toContain("var(--motion-dur-base)");
    expect(all).toContain("var(--motion-ease-out)");
    // No bare millisecond literals in the deck's own declarations.
    expect(all).not.toMatch(/\d+ms/);
  });

  it("caps the stagger at the eighth child", () => {
    // Past eight steps the last block would still be arriving while the
    // operator is already reading it — latency with better manners.
    expect(CSS).toMatch(/\.deck-enter[^{}]*:nth-child\(n\+8\)/);
    const capped = ruleBodiesFor(CSS, /\.deck-enter[^{}]*:nth-child\(n\+8\)/).join("");
    expect(capped).toContain("calc(var(--motion-stagger)");
  });
});

describe("deck motion — stillness for those who ask for it", () => {
  const block = reducedMotionBlock(CSS);

  it("has a reduced-motion block at all", () => {
    expect(block).not.toBe("");
  });

  it("clamps animation-duration AND animation-delay", () => {
    // Duration and delay are independent; clamping one does NOT neutralise the
    // other. Every staggered entrance pairs a `backwards` fill with a delay,
    // and `backwards` holds the from-state for the whole delay — so without
    // the delay clamp a user who asked for stillness watches each block sit
    // invisible at opacity 0 for its full delay. The animation is gone but the
    // WAITING is not. This is the assertion that keeps that repair in place.
    expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/animation-delay:\s*0ms\s*!important/);
  });

  it("clamps transition duration and delay, and stops infinite loops", () => {
    expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/transition-delay:\s*0ms\s*!important/);
    expect(block).toMatch(/animation-iteration-count:\s*1\s*!important/);
  });

  it("widens past the login page, which was the original defect", () => {
    expect(block).toMatch(/\*\s*,/);
    expect(block).toContain("*::before");
    expect(block).toContain("*::after");
  });
});

describe("deck motion — the shell", () => {
  it("carries deck-enter on the content wrapper", () => {
    expect(LAYOUT_SRC).toContain("deck-enter");
  });

  it("re-keys the wrapper on pathname so the choreography replays per navigation", () => {
    // A CSS animation runs on MOUNT. React otherwise reuses this element across
    // a route change (only the children differ), so without the key the
    // entrance would play once per browser session, not once per navigation.
    expect(LAYOUT_SRC).toMatch(/key=\{pathname\}/);
  });
});

describe("deck motion — built CSS proof (opt-in)", () => {
  const cssDir = join(process.cwd(), ".next", "static", "css");
  const hasBuild = existsSync(cssDir);

  it.skipIf(!hasBuild)("emits .deck-enter with backwards fill", () => {
    const files = readdirSync(cssDir).filter((f) => f.endsWith(".css"));
    expect(files.length).toBeGreaterThan(0);
    const built = files.map((f) => readFileSync(join(cssDir, f), "utf8")).join("\n");
    expect(built).toContain("deck-enter");
    expect(built).toContain("deckEnter");
    expect(built).toMatch(/backwards/);
  });
});
