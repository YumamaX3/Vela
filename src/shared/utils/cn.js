/**
 * cn — class-name composition with real conflict resolution.
 *
 * WAS: join, filter falsy, collapse whitespace. That meant `cn("p-4", cond && "p-2")`
 * produced "p-4 p-2" and which one the browser applied was decided by the order
 * Tailwind happened to EMIT those utilities in the stylesheet — not by the order
 * written at the call site. On an element carrying several simultaneous conditions
 * (selected · added · disabled · hovered · focused) that is an unreviewable coin
 * flip, which is why the selection primitives being built in this tide need a real
 * merge. Star-approved as a new dependency (2026-09-05): tailwind-merge 3.6.0,
 * MIT, zero dependencies.
 *
 * ── Verified before adoption, not assumed ──────────────────────────────────────
 * Old vs new were diffed across all 49 real call sites (a balanced-paren scan of
 * src/, with every boolean ident enumerated both ways and every className-ish
 * ident tested empty AND conflicting). Result: 13 diffs were "caller className
 * wins", which is the React convention these components already assume by placing
 * className last; 4 were genuine resolutions of DOCUMENTED intent, each pinned in
 * tests/unit/cn-conflict-resolution.test.js; and zero dropped a Vela custom token.
 *
 * The four genuine resolutions were latent bugs this fixes:
 *  · Input.js:41,46 / Select.js:33,37 — the `// iOS zoom fix` needs text-[16px] to
 *    beat the base text-sm on mobile; which won was emission order.
 *  · Input.js:42,48 — `error && "…border-red-500/40"` means the border turns red,
 *    so border-transparent must yield; it did not reliably.
 *  · Input.js:43,48 — same conditional's focus ring must go red, not brand coral.
 *
 * ── The Vela token registration, and why it is needed ──────────────────────────
 * globals.css registers five shadow and two radius tokens via `@theme inline`, so
 * Tailwind v4 generates `shadow-elev`, `rounded-brand-lg` and friends as real
 * utilities. twMerge does not know them and cannot: `shadow-[var(--shadow-elev)]`
 * is AMBIGUOUS to a parser — the variable could resolve to a box-shadow length or
 * to a colour — so twMerge keeps both classes and CSS order decides again. The app
 * hits this constantly (30 arbitrary `shadow-[var(--shadow-*)]` usages, incl.
 * Modal.js:56, Drawer.js:53, Card.js:29, Loading.js:53).
 *
 * So both vocabularies are taught to twMerge here. All five Vela shadow tokens are
 * box-shadow LENGTHS (--shadow-soft/warm/elevated/elev/focus, globals.css:60-67,
 * 113-120), and both radius tokens are lengths (--radius-brand, --radius-brand-lg).
 *
 * The validator is deliberately narrow: it matches ONLY `[var(--shadow-` for
 * shadows and `[var(--radius-` for radii. A shadow COLOUR such as
 * `shadow-[var(--color-brand-500)]` is a different group and must survive — proven
 * by test, because over-merging would silently delete styling rather than misapply
 * it, which is the more dangerous failure.
 *
 * ── Compatibility guarantees (each one pinned by test) ─────────────────────────
 *  · Falsy filtering preserved — `cond && "p-2"` still contributes nothing when
 *    cond is false. This is the ONE normalisation cn still does itself; twMerge
 *    does not filter arguments, it receives a string.
 *  · Whitespace collapsing preserved — multi-line template literals at a call site
 *    still produce one clean string. Performed by twMerge, not by cn: an earlier
 *    draft carried its own `.replace(/\s+/g," ").trim()` and a mutation harness
 *    proved it dead code (removing it changed no behaviour), because twMerge trims
 *    and collapses internally and returns "" for whitespace-only input. The dead
 *    lines were deleted rather than given a test that would only have justified
 *    them. The contract still holds and is still pinned.
 *  · Empty input returns "" — never undefined, which would render class="undefined".
 *  · Unknown classes pass through untouched, so the hand-written globals in
 *    globals.css (.card-soft, .card-elev, .custom-scrollbar,
 *    .material-symbols-outlined, .traffic-light, .slide-in-right, .fade-in)
 *    survive composition. twMerge only removes a class that CONFLICTS with a later
 *    one; it never drops what it does not recognise.
 *  · twMerge removes the loser in place and does NOT reorder — `cn("px-4","py-2
 *    px-1")` yields "py-2 px-1", keeping each survivor where the author put it.
 *  · No try/catch: a fallback that silently dropped conflict resolution would hide
 *    the very failure this module exists to prevent. twMerge returns a string and
 *    does not throw on odd input.
 */

import { extendTailwindMerge } from "tailwind-merge";

/** `[var(--shadow-…)]` — a Vela box-shadow token in arbitrary form. */
function isVelaShadowVar(cls) {
  return typeof cls === "string" && cls.startsWith("[var(--shadow-") && cls.endsWith(")]");
}

/** `[var(--radius-…)]` — a Vela radius token in arbitrary form. */
function isVelaRadiusVar(cls) {
  return typeof cls === "string" && cls.startsWith("[var(--radius-") && cls.endsWith(")]");
}

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // token names + arbitrary-var forms. `extend` ADDS to the default group, so
      // shadow-sm/md/lg/none/xl and rounded-md/lg/xl/none keep working.
      shadow: [{ shadow: ["soft", "warm", "elevated", "elev", "focus", isVelaShadowVar] }],
      "rounded": [{ rounded: ["brand", "brand-lg", isVelaRadiusVar] }],
    },
  },
});

export function cn(...classes) {
  // filter(Boolean) is the ONE normalisation cn does itself: twMerge takes a string,
  // not an argument list, so falsy slots (`cond && "p-2"` when cond is false) must
  // be dropped before joining or they would render as the literal text "false".
  //
  // Everything else is twMerge's, verified by probe rather than assumed: it trims,
  // collapses internal whitespace (including newlines and tabs from a multi-line
  // template literal at a call site), and returns "" — never undefined — for empty
  // or whitespace-only input. So cn() with no arguments returns "" and cannot
  // produce class="undefined".
  //
  // This used to carry its own `.replace(/\s+/g, " ").trim()` plus an
  // `if (!cleaned) return ""` guard. A mutation harness proved both dead: removing
  // them changed no behaviour at all. They were deleted instead of being given a
  // test that would only have justified their existence.
  return twMerge(classes.filter(Boolean).join(" "));
}

export default cn;
