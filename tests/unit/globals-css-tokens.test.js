/**
 * globals.css — the four Stage-1 repairs, asserted as SOURCE claims plus an
 * opt-in BUILT-CSS proof.
 *
 * The split matters and is deliberate:
 *
 *  · SOURCE assertions (always run) prove what I wrote. They read
 *    src/app/globals.css, which exists in every checkout.
 *  · BUILT assertions (skipped when .next/static/css is absent) prove what the
 *    compiler EMITTED. A claim about what Tailwind emits is a claim about a file
 *    on disk — reasoned-about cascade behaviour has burned this repo before, so
 *    the proof is the artifact. They skip rather than fake-pass when there is no
 *    build, and say so.
 *
 * ── THE FOUR REPAIRS ────────────────────────────────────────────────────────
 *
 * 1. `prefers-reduced-motion` was scoped to `.login-page *, .login-page::before`
 *    only — every animation outside the login page kept running at full speed for
 *    a user who asked for stillness. Measured casualties, all `infinite`:
 *    topology-edge-flicker 0.18s steps(2), topology-edge-dash 0.22s,
 *    topology-router-pulse / icon-shake / label-flicker, animate-spin,
 *    animate-pulse, animate-border-glow, animate-pulse-glow, .btn-cta, and 15
 *    inline `style={{ animation: "spin 1s linear infinite" }}` sites.
 *
 * 2. A global `:focus-visible` did not exist. Measured gap: 140 interactive
 *    elements with NO focus treatment — 70 buttons, 60 anchors, 9 inputs,
 *    1 select. (A first pass reported "61 naked suppressions"; re-measuring with
 *    `focus:border-primary` counted as an indicator returned ZERO. The real gap
 *    is elements with neither suppression nor indicator, not suppressions without
 *    a partner.)
 *
 * 3. `--font-sans` hardcoded `'Inter'` while next/font emits the metric-adjusted
 *    `--font-inter:"Inter","Inter Fallback"`, consumed zero times.
 *
 * 4. `h-dvh` had no working fallback (see below).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const CSS_SRC = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
const LAYOUT_SRC = readFileSync(
  join(process.cwd(), "src", "shared", "components", "layouts", "DashboardLayout.js"),
  "utf8"
);

/**
 * Strip comments before searching source for a pattern.
 *
 * EVERY source-guard test below needs this, and two of them failed without it —
 * the positive form of a lesson already sealed in this repo
 * (`negative-regex-source-guard-defeated-by-comment`):
 *
 *   · `CSS_SRC.indexOf(":focus-visible")` matched the COMMENT at globals.css:243
 *     ("An unlayered `:focus-visible` would…"), not the rule at :253 — so the test
 *     concluded the rule was not inside @layer base when it was.
 *   · `/h-screen h-dvh|h-dvh h-screen/` matched the COMMENT at
 *     DashboardLayout.js:69 (`cn("h-screen h-dvh")` collapses to…) — so the test
 *     concluded the shell carried both classes when it carries only h-dvh.
 *
 * A guard that can be tripped by the documentation explaining it is not a guard.
 *
 * Comments ONLY — string literals are deliberately PRESERVED. That is a real
 * distinction from the stripper in scroll-lock-refcount.test.jsx, which removes
 * both: there the strings were prose in log calls; here the strings ARE the
 * payload. `className="flex h-dvh w-full overflow-hidden bg-bg"` is a JSX
 * attribute value, and `--font-sans: 'Inter', …` is a CSS declaration — strip them
 * and the suite would be asserting against a file with all of its subject matter
 * deleted. An earlier draft of this helper did exactly that.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ");
}

const CSS_CODE = stripComments(CSS_SRC);
const LAYOUT_CODE = stripComments(LAYOUT_SRC);

describe("the comment stripper is not theatre", () => {
  // A guard that cannot fail is not a guard. Prove both directions.
  it("removes the two comments that were tripping the source guards", () => {
    expect(CSS_SRC).toContain("An unlayered `:focus-visible`");
    expect(CSS_CODE).not.toContain("An unlayered");
    expect(LAYOUT_SRC).toContain('cn("h-screen h-dvh")');
    expect(LAYOUT_CODE).not.toContain('cn("h-screen h-dvh")');
  });

  it("still sees live code — so it cannot pass by deleting everything", () => {
    expect(CSS_CODE).toContain(":focus-visible");
    expect(CSS_CODE).toContain("@layer base {");
    expect(CSS_CODE).toContain("@supports not (height: 100dvh)");
    expect(LAYOUT_CODE).toContain("h-dvh w-full overflow-hidden");
    expect(LAYOUT_CODE).toContain("inert={!sidebarOpen}");
  });

  it("preserves string literals, which are the payload in JSX and CSS", () => {
    expect(LAYOUT_CODE).toContain('className="flex h-dvh w-full overflow-hidden bg-bg"');
    expect(CSS_CODE).toContain("'Inter'");
  });

  it("does not collapse the file into noise — line structure survives", () => {
    // The @layer base lookup depends on `lastIndexOf` + `indexOf("\n}")`, so a
    // stripper that ate newlines would silently change what it proves.
    expect(CSS_CODE.split("\n").length).toBeGreaterThan(200);
  });
});

/**
 * Locate the built CSS. Returns null when there is no build output, in which case
 * the BUILT suites skip — they never fake a pass.
 *
 * `main` is the largest chunk by byte count, which is the Tailwind bundle and
 * therefore carries every @layer. Picking by size (never by filename) keeps the
 * test independent of content hashes that change on every build.
 *
 * `all` is the concatenation of every chunk, because next/font emits its
 * `.__variable_*` face-metric class into a SEPARATE, smaller chunk than the
 * Tailwind bundle — asserting it against `main` alone fails even though the
 * variable genuinely ships and genuinely resolves at runtime.
 */
function findBuiltCss() {
  const dir = join(process.cwd(), ".next", "static", "css");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
  if (!files.length) return null;
  const withSize = files
    .map((f) => ({ f, css: readFileSync(join(dir, f), "utf8") }))
    .sort((a, b) => b.css.length - a.css.length);
  return {
    css: withSize[0].css,
    all: withSize.map((x) => x.css).join("\n"),
    chunks: withSize.map((x) => x.f),
  };
}

const BUILT = findBuiltCss();
const builtIt = BUILT ? it : it.skip;

/**
 * Innermost enclosing `@layer NAME{` for a byte offset, by brace depth.
 *
 * Walking backwards and letting depth go negative reports a chain of artifacts
 * (it did exactly that in an early probe: `@layer theme`, then a banner comment,
 * neither of which encloses anything). This walks FORWARD from each candidate
 * layer opening and depth-matches its block, which cannot over-report.
 */
function enclosingLayer(css, pos) {
  const layerOpenings = [...css.matchAll(/@layer\s+([a-z]+)\s*\{/g)]
    .map((m) => ({ name: m[1], start: m.index }))
    .filter((l) => l.start <= pos)
    .sort((a, b) => b.start - a.start);

  for (const { name, start } of layerOpenings) {
    let i = css.indexOf("{", start);
    let depth = 0;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") {
        depth--;
        if (depth === 0) return pos < i ? name : null;
      }
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────
// 1 · reduced-motion reaches everything, not the login page
// ────────────────────────────────────────────────────────────────

describe("prefers-reduced-motion is no longer scoped to the login page", () => {
  it("targets the universal selector", () => {
    const block = CSS_SRC.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/
    );
    expect(block, "no reduced-motion block found at all").toBeTruthy();
    const body = block[1];
    // `*,` and `*::before` / `*::after` — the universal triple, per the
    // accessibility rule's own prescription.
    expect(body).toMatch(/^\s*\*,/m);
    expect(body).toMatch(/\*::before/);
    expect(body).toMatch(/\*::after/);
  });

  it("does NOT still carry the old .login-page scoping", () => {
    const block = CSS_SRC.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/
    );
    expect(block[1]).not.toContain(".login-page");
  });

  it("caps every animation rather than only shortening duration", () => {
    // animation-duration alone leaves an infinite loop spinning forever at a tiny
    // per-iteration length. iteration-count:1 is what actually stops it.
    const block = CSS_SRC.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/
    )[1];
    expect(block).toContain("animation-duration: 0.01ms !important");
    expect(block).toContain("animation-iteration-count: 1 !important");
    expect(block).toContain("transition-duration: 0.01ms !important");
  });

  it("includes scroll-behavior, which the old block omitted", () => {
    const block = CSS_SRC.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/
    )[1];
    expect(block).toContain("scroll-behavior: auto !important");
  });

  it("uses 0.01ms and never 0s", () => {
    // A 0s duration makes some transition callbacks fire synchronously or not at
    // all. 0.01ms is the conventional "effectively instant but still a real
    // transition" value.
    const block = CSS_SRC.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/
    )[1];
    expect(block).not.toMatch(/:\s*0s\s*!important/);
  });

  it("the animations it now covers really exist and really are infinite", () => {
    // Guard against the rule widening to cover nothing. Rather than counting the
    // word "infinite" (which proves nothing about WHICH animations), assert the real
    // selector → animation-name → infinite chain for the non-login casualties.
    //
    // The login-page animations (login-drift, login-twinkle, login-crest-pulse,
    // login-ring-out) were already covered by the old `.login-page *` scope and are
    // excluded here on purpose: this list is the set the widening NEWLY reaches.
    //
    // Names are stable identifiers; line numbers are not. An earlier draft of the
    // comment in globals.css cited eight line numbers for these and every one was
    // stale by the time it was read, so the test keys off selectors instead.
    const NEWLY_COVERED = [
      [".animate-spin", "spin"],
      [".animate-pulse", "pulse"],
      [".animate-border-glow", "border-glow"],
      // camelCase keyframe — `@keyframes pulse-glow` never existed, so asserting the
      // hyphenated name would have been fiction that passed by accident.
      [".animate-pulse-glow", "pulseGlow"],
      [".btn-cta", "ctaGlowPulse"],
      [".btn-cta::before", "ctaShimmer"],
      [".topology-router-core", "topology-router-pulse"],
      [".topology-router-icon", "topology-router-icon-shake"],
      [".topology-router-label", "topology-router-label-flicker"],
      [".topology-edge-kame", "topology-edge-dash"],
      [".topology-edge-halo", "topology-edge-flicker"],
      [".topology-edge-plasma", "topology-edge-dash"],
    ];

    for (const [selector, anim] of NEWLY_COVERED) {
      // the keyframe must be defined
      expect(CSS_CODE, `@keyframes ${anim} missing`).toContain(`@keyframes ${anim}`);
      // and the selector must actually run it, infinitely
      const ruleIdx = CSS_CODE.indexOf(`${selector} {`);
      expect(ruleIdx, `selector ${selector} not found`).toBeGreaterThan(-1);
      const block = CSS_CODE.slice(ruleIdx, CSS_CODE.indexOf("}", ruleIdx));
      expect(block, `${selector} does not animate ${anim}`).toContain(anim);
      expect(block, `${selector} is not infinite`).toContain("infinite");
    }
  });

  it("the login-page animations it already covered are unchanged in kind", () => {
    // The old scope was `.login-page *`. These four were the ones it reached; naming
    // them keeps the "newly covered" list above honest about what is actually new.
    for (const anim of ["login-drift", "login-twinkle", "login-crest-pulse", "login-ring-out"]) {
      expect(CSS_CODE, `@keyframes ${anim} missing`).toContain(`@keyframes ${anim}`);
    }
  });

  it("records that two keyframes run at two different durations each", () => {
    // Correcting an earlier comment that claimed one duration per name. Both
    // topology-edge-dash and topology-edge-flicker are declared twice, at different
    // speeds, by different selectors — so a single number per name is always wrong.
    const dash = CSS_CODE.match(/topology-edge-dash ([\d.]+)s/g) || [];
    const flicker = CSS_CODE.match(/topology-edge-flicker ([\d.]+)s/g) || [];
    expect(new Set(dash).size, `expected 2 distinct edge-dash durations, got ${[...new Set(dash)]}`).toBe(2);
    expect(new Set(flicker).size, `expected 2 distinct edge-flicker durations, got ${[...new Set(flicker)]}`).toBe(2);
  });

  it("the inline-animation sites the widened rule reaches are counted, not asserted", () => {
    // The comment in globals.css claims "15 inline sites across 12 files". A cited
    // number is a claim that rots the moment someone adds a spinner, and this is the
    // same class of drift the eight stale line numbers were. So it is measured here.
    //
    // A stylesheet `!important` DOES override a non-important inline style, which is
    // why the widened selector reaches these at all without touching 12 component
    // files — the premise the whole repair rests on.
    const sites = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.jsx?$/.test(entry.name)) continue;
        const src = readFileSync(full, "utf8");
        // `\binfinite\b`, NOT a bare `infinite`: the substring form counts
        // `infiniteX`, `infinite-scroll`, or a comment mentioning the word as if it
        // were a running animation. A mutation harness proved it — renaming one
        // site's `infinite` to `infiniteX` left this test GREEN, because the old
        // pattern still matched. Word boundaries make it count animations, not
        // spellings.
        const n = (src.match(/animation:[^}\n]*\binfinite\b/g) || []).length;
        if (n) sites.push({ file: full, n });
      }
    };
    walk(join(process.cwd(), "src"));

    const total = sites.reduce((a, s) => a + s.n, 0);
    expect(total, `inline infinite-animation sites moved from 15 to ${total}; update the globals.css comment`).toBe(15);
    expect(sites.length, `file count moved from 12 to ${sites.length}`).toBe(12);

    // And the widest single file is the one the comment names first.
    const top = [...sites].sort((a, b) => b.n - a.n)[0];
    expect(top.file.endsWith("AnimatedBackground.js")).toBe(true);
    expect(top.n).toBe(3);
  });
});

describe("reduced-motion (BUILT CSS)", () => {
  builtIt("emits the universal selector, minified", () => {
    expect(BUILT.css).toMatch(
      /@media \(prefers-reduced-motion:reduce\)\{\*,::?after,::?before\{|@media \(prefers-reduced-motion:reduce\)\{\*,[^}]*\{/
    );
    // and the login-page scoping is gone from the emitted artifact too
    expect(BUILT.css).not.toMatch(
      /@media \(prefers-reduced-motion:reduce\)\{\.login-page/
    );
  });
});

// ────────────────────────────────────────────────────────────────
// 2 · global :focus-visible — placement is the whole point
// ────────────────────────────────────────────────────────────────

describe("a global :focus-visible rule now exists", () => {
  it("declares outline width, style and colour from the brand token", () => {
    const rule = CSS_SRC.match(/:focus-visible\s*\{([^}]*)\}/);
    expect(rule, "no :focus-visible rule in globals.css").toBeTruthy();
    expect(rule[1]).toMatch(/outline:\s*2px solid var\(--color-primary\)/);
    expect(rule[1]).toMatch(/outline-offset:\s*2px/);
  });

  it("lives inside @layer base — NOT unlayered", () => {
    // This is the load-bearing placement claim. globals.css's plain rules are
    // UNLAYERED, and unlayered author CSS beats every @layer — so an unlayered
    // :focus-visible would ALSO beat the 12 deliberate `focus-visible:outline-none`
    // utilities and the 90 that pair a suppression with their own indicator,
    // giving 57 elements a double ring. In @layer base, utilities win.
    //
    // Searched against CSS_CODE (comments and strings stripped), NOT CSS_SRC: the
    // explanatory paragraph above this rule mentions `:focus-visible` and
    // `focus-visible:outline-none` by name, and indexOf on the raw source found the
    // prose first and reported the rule as unlayered. The comment is the thing
    // explaining the guard; it must not be able to trip it.
    const ruleStart = CSS_CODE.indexOf(":focus-visible");
    expect(ruleStart, "no :focus-visible in stripped source").toBeGreaterThan(-1);
    const layerStart = CSS_CODE.lastIndexOf("@layer base {", ruleStart);
    expect(layerStart, "the rule is not preceded by an @layer base block").toBeGreaterThan(-1);
    const layerEnd = CSS_CODE.indexOf("\n}", layerStart);
    expect(ruleStart, "the rule is outside the @layer base block").toBeLessThan(layerEnd);
  });

  it("uses a token that resolves to the same brand colour in BOTH themes", () => {
    // One declaration serves light and dark only if the token does not diverge.
    const light = CSS_SRC.match(/^:root\s*\{[\s\S]*?--color-brand-500:\s*(#[0-9a-fA-F]{3,8})/m);
    const dark = CSS_SRC.match(
      /^\.dark\s*\{[\s\S]*?--color-brand-500:\s*(#[0-9a-fA-F]{3,8})/m
    );
    expect(light, "light --color-brand-500 not found").toBeTruthy();
    expect(dark, "dark --color-brand-500 not found").toBeTruthy();
    expect(light[1].toLowerCase()).toBe(dark[1].toLowerCase());

    // and --color-primary is an alias of it, not an independent value
    expect(CSS_SRC).toContain("--color-primary: var(--color-brand-500)");
  });

  it("reuses the existing shadow-focus token's own colour, so the ring is not a new accent", () => {
    // --shadow-focus is a 3px rgba(229,106,74,.18) glow. 229,106,74 IS #E56A4A,
    // the brand. So the new outline and the pre-existing focus shadow are the same
    // hue — the accent stays singular (the design system's one-accent rule).
    const shadow = CSS_SRC.match(/--shadow-focus:\s*0 0 0 3px rgba\((\d+),\s*(\d+),\s*(\d+)/);
    expect(shadow).toBeTruthy();
    const [r, g, b] = [shadow[1], shadow[2], shadow[3]].map(Number);
    const hex = [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
    expect(`#${hex}`.toLowerCase()).toBe("#e56a4a");
  });
});

describe("focus-visible cascade (BUILT CSS)", () => {
  builtIt("emits the rule inside @layer base", () => {
    const needle = ":focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}";
    expect(BUILT.css, "global focus rule not emitted").toContain(needle);
    expect(enclosingLayer(BUILT.css, BUILT.css.indexOf(needle))).toBe("base");
  });

  builtIt("keeps every deliberate suppression in @layer utilities, which wins", () => {
    const utils = BUILT.css.indexOf("@layer utilities{");
    expect(utils, "no utilities layer in the built css").toBeGreaterThan(-1);

    // Two independent mechanisms put utilities above base, and BOTH must hold or
    // the suppressions could lose:
    //
    //  1. DECLARED ORDER. Tailwind's own source says
    //     `@layer theme, base, components, utilities;` (tailwindcss/index.css:1) and
    //     in CSS cascade layers a later-declared layer beats an earlier one
    //     REGARDLESS of specificity. That statement does not survive into this
    //     bundle (asserted below), so it cannot be the only thing relied on.
    //  2. SOURCE ORDER. With no declaration statement present, precedence follows
    //     first appearance — so `@layer base{` must come before `@layer utilities{`.
    expect(utils).toBeGreaterThan(
      BUILT.css.indexOf("@layer base{"),
      "utilities must be declared after base or the suppressions would lose"
    );

    // Record mechanism 1's absence rather than letting a reader assume it holds.
    expect(BUILT.css, "an explicit layer-order declaration appeared — update this comment")
      .not.toContain("@layer theme,base,components,utilities;");

    const competitors = [
      String.raw`.focus\:outline-none:focus{--tw-outline-style:none;outline-style:none}`,
      String.raw`.focus-visible\:outline-none:focus-visible{--tw-outline-style:none;outline-style:none}`,
    ];
    for (const c of competitors) {
      expect(BUILT.css, `${c} not emitted`).toContain(c);
      expect(
        enclosingLayer(BUILT.css, BUILT.css.indexOf(c)),
        `${c} must be in the utilities layer`
      ).toBe("utilities");
    }
  });

  builtIt("the paired indicators the 90 suppressions rely on are also emitted", () => {
    // The 90 paired sites use focus:border-primary (46), focus:ring-* (39) and
    // focus:shadow-* (6). Spot-check each family survived.
    //
    // Substring containment, NOT toMatch: the emitted selector contains a literal
    // backslash (`.focus\:ring-2:focus`), and `toMatch(string)` does substring
    // matching while `toMatch(regex)` would need the backslash escaped — two
    // different meanings for the same input, which is exactly how an earlier
    // version of this assertion passed a string and searched for two backslashes.
    // Plain `toContain` on the literal is unambiguous.
    for (const selector of [
      ".focus\\:ring-2:focus",
      ".focus\\:border-primary:focus",
      ".focus-visible\\:ring-2:focus-visible",
    ]) {
      expect(BUILT.css, `${selector} not emitted`).toContain(selector);
    }
  });
});

// ────────────────────────────────────────────────────────────────
// 3 · h-dvh fallback — the comment claimed one that did not exist
// ────────────────────────────────────────────────────────────────

describe("h-dvh has a real fallback, gated on the feature test", () => {
  it("declares @supports not (height: 100dvh) in globals.css", () => {
    expect(CSS_SRC).toMatch(/@supports not \(height: 100dvh\)\s*\{/);
  });

  it("covers all three dvh utilities, not only the one in use today", () => {
    const block = CSS_SRC.match(/@supports not \(height: 100dvh\)\s*\{([\s\S]*?)\n\}/)[1];
    expect(block).toMatch(/\.h-dvh\s*\{\s*height: 100vh/);
    expect(block).toMatch(/\.min-h-dvh\s*\{\s*min-height: 100vh/);
    expect(block).toMatch(/\.max-h-dvh\s*\{\s*max-height: 100vh/);
  });

  it("is UNLAYERED, so it can beat the utilities layer", () => {
    // Inside @layer base this fallback would LOSE to .h-dvh in utilities, making it
    // dead code — the same class of defect the focus rule avoids by the opposite
    // placement. Both placements are deliberate and opposite, which is why each is
    // asserted rather than assumed.
    const at = CSS_SRC.indexOf("@supports not (height: 100dvh)");
    const layerStart = CSS_SRC.lastIndexOf("@layer base {", at);
    if (layerStart !== -1) {
      const layerEnd = CSS_SRC.indexOf("\n}", layerStart);
      expect(at, "the dvh fallback must not sit inside @layer base").toBeGreaterThan(layerEnd);
    }
  });

  it("DashboardLayout's comment no longer claims an automatic fallback", () => {
    // The false claim, verbatim, so a re-introduction fails the suite. Searched in
    // the RAW source on purpose: this assertion is ABOUT the prose, so stripping
    // comments would remove the very thing it checks.
    expect(LAYOUT_SRC).not.toContain("100dvh falls back to 100vh");
    // and the corrected reasoning is present
    expect(LAYOUT_SRC).toContain("@supports not (height: 100dvh)");
  });

  it("the shell really uses h-dvh and really does NOT also carry h-screen", () => {
    // Both classes together resolve to 100vh: measured, Tailwind emits .h-screen
    // AFTER .h-dvh, and the cn() helper collapses the pair to one anyway. So the
    // class-list fallback cannot work — which is why @supports exists.
    expect(LAYOUT_CODE).toMatch(/className="flex h-dvh w-full overflow-hidden bg-bg"/);
    // Against LAYOUT_CODE, not LAYOUT_SRC: the explanatory comment records the
    // cn("h-screen h-dvh") collapse by name, and a raw-source search matched that
    // prose and reported the shell as carrying both classes when it carries one.
    expect(LAYOUT_CODE).not.toMatch(/h-screen h-dvh|h-dvh h-screen/);
  });

  it("no OTHER element in the shell silently reintroduces h-screen", () => {
    // Guards the whole file, not just the root div: an inner container pinned to
    // h-screen would restore the original iOS defect underneath the fixed shell.
    const screens = LAYOUT_CODE.match(/h-screen/g) || [];
    expect(screens.length, `h-screen still present in stripped source: ${screens.length}x`).toBe(0);
  });
});

describe("dvh fallback (BUILT CSS)", () => {
  builtIt("emits the @supports block with all three utilities", () => {
    expect(BUILT.css).toContain(
      "@supports not (height:100dvh){.h-dvh{height:100vh}.min-h-dvh{min-height:100vh}.max-h-dvh{max-height:100vh}}"
    );
  });

  builtIt("still emits .h-dvh and .h-screen themselves, so supported browsers get dvh", () => {
    expect(BUILT.css).toContain(".h-dvh{height:100dvh}");
    expect(BUILT.css).toContain(".h-screen{height:100vh}");
  });

  builtIt("the emitted order is why the class-list fallback could never work", () => {
    // Records the measurement that justified @supports: h-screen comes LATER.
    const screen = BUILT.css.indexOf(".h-screen{height:100vh}");
    const dvh = BUILT.css.indexOf(".h-dvh{height:100dvh}");
    expect(dvh).toBeGreaterThan(-1);
    expect(screen).toBeGreaterThan(dvh);
  });
});

// ────────────────────────────────────────────────────────────────
// 4 · the font token actually reaches the browser
// ────────────────────────────────────────────────────────────────

describe("body consumes next/font's metric-adjusted face", () => {
  it("body's font-family reads var(--font-inter) with a literal fallback", () => {
    const body = CSS_SRC.match(/^body\s*\{([\s\S]*?)\}/m);
    expect(body, "no body rule").toBeTruthy();
    expect(body[1]).toMatch(/font-family:\s*var\(--font-inter,\s*'Inter'\)/);
    // and the rest of the stack survives after it
    expect(body[1]).toContain("-apple-system");
    expect(body[1]).toContain("system-ui");
  });

  it("--font-sans stays a LITERAL stack — the trap this repair had to avoid", () => {
    // `var(--font-inter)` inside `@theme`'s --font-sans would be substituted at
    // :root, where the variable is undefined (next/font emits it on <body> as
    // `.__variable_*`). That makes the token guaranteed-invalid at computed-value
    // time and silently drops body to the browser's initial font — a worse bug than
    // the one being fixed, and invisible in review.
    const themeSans = CSS_SRC.match(/@theme inline \{[\s\S]*?--font-sans:\s*([^;]*);/);
    expect(themeSans, "no --font-sans in @theme inline").toBeTruthy();
    expect(themeSans[1]).not.toContain("var(--font-inter)");
    expect(themeSans[1]).toContain("'Inter'");
  });

  it("layout.js still applies the variable class next/font generates", () => {
    const layout = readFileSync(join(process.cwd(), "src", "app", "layout.js"), "utf8");
    expect(layout).toContain("inter.variable");
    expect(layout).toContain('variable: "--font-inter"');
  });
});

describe("font token (BUILT CSS)", () => {
  builtIt("emits body's font-family consuming --font-inter", () => {
    expect(BUILT.css).toContain(
      'body{background-color:var(--color-bg);font-family:var(--font-inter,"Inter")'
    );
  });

  builtIt("still emits .font-sans as the literal stack, so that utility is unbroken", () => {
    expect(BUILT.css).toContain(
      ".font-sans{font-family:Inter,-apple-system,BlinkMacSystemFont,SF Pro Text,SF Pro Display,system-ui,sans-serif}"
    );
  });

  builtIt("--font-inter is defined on the next/font class, proving the var resolves", () => {
    // This is the fact that makes the body rule work at all: the variable is
    // emitted on <body> itself, one element above where it is consumed.
    //
    // Searched across BUILT.all (every chunk concatenated), not BUILT.css: next/font
    // emits its `.__variable_*` / `.__className_*` rules into a SEPARATE, smaller
    // chunk than the Tailwind bundle, so asserting against the largest chunk alone
    // fails even though the variable genuinely ships and genuinely resolves.
    expect(BUILT.all).toMatch(/__variable_[a-z0-9]+\{--font-inter:"Inter","Inter Fallback"\}/);
    // and the size-adjusted fallback that makes it worth consuming is real, not a
    // bare alias — `size-adjust` is the metric adjustment itself.
    expect(BUILT.all).toMatch(/@font-face\{[^}]*size-adjust:/);
  });
});

// ────────────────────────────────────────────────────────────────
// The four token families that were CUT — recorded so they are not
// re-proposed on the strength of a census that counted consumers wrongly
// ────────────────────────────────────────────────────────────────

describe("the four token families measured and deliberately NOT added", () => {
  it("adds no z-index token family (z-index is not a v4 theme namespace)", () => {
    expect(CSS_SRC).not.toMatch(/--z-index-|--z-\w+:/);
    // and nothing consumes one
    expect(CSS_SRC).not.toContain("var(--z-");
  });

  it("adds no type-scale token family (the lone census hit was a colour, not a size)", () => {
    // The "1 custom type-scale consumer" that justified this family was
    // `text-[var(--color-terminal)]` — a colour in arbitrary-value position.
    expect(CSS_SRC).not.toMatch(/--text-2xs|--text-3xs/);
  });

  it("adds no motion token family (transition-colors and friends are Tailwind defaults)", () => {
    expect(CSS_SRC).not.toMatch(/--transition-(colors|all|transform):/);
  });

  it("adds no mono token family — Tailwind's default already resolves all 196 consumers", () => {
    // Measured: v4 ships --font-mono and emits .font-mono{font-family:var(--font-mono)}.
    // There was nothing broken to fix; adding a family would have been decoration.
    expect(CSS_SRC).not.toMatch(/--font-mono:/);
  });
});
