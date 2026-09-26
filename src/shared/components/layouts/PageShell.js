"use client";

// PageShell — the deck's one masthead (v0.9.99).
//
// WHY IT EXISTS: measured before this tide, twenty-four rooms each assembled
// their own heading, their own action row and their own container widths. The
// identity motifs — the mast-rise choreography, the compass tile, the tide
// line, the status beacon — live in globals.css and are worn by exactly three
// files in the whole tree (Header, QuickNav, StatusBeacon). So the header has
// an identity and the rooms have headings, and the two do not look related.
//
// This is that identity, issued as a component. A room hands it a title, a
// subtitle, an icon, actions and children; everything else is the deck's.
//
// WHAT IT DELIBERATELY DOES NOT DO:
//
//  · It does not re-implement `.deck-enter`. The shell's content wrapper
//    already animates a page's top-level blocks, so a PageShell that also
//    staggered its own children would fight it — two sequences on one mount.
//    `data-reveal` on the body is the opt-in for the LOWER half of a long
//    room, which deck-enter (a mount animation) cannot reach.
//  · It does not carry its own width or padding. The rooms' scroll container
//    owns those today, and a shell that re-imposed them would double the
//    gutter on every existing page. `maxWidth` is available for a room that
//    genuinely needs a narrower measure, and defaults to none.
//  · It does not hide its title from assistive tech or from search. The h1 is
//    a real h1; the eyebrow above it is decoration and says so.

import { cn } from "@/shared/utils/cn";

/**
 * A room's masthead.
 *
 * @param {string}   title      - the room's name. Rendered as the page's h1.
 * @param {string}   [subtitle] - one line of context under the title.
 * @param {string}   [eyebrow]  - a short label above the title (a group name).
 * @param {string}   [icon]     - a Material Symbols ligature for the compass tile.
 * @param {node}     [actions]  - buttons, aligned to the end of the masthead row.
 * @param {node}     [children] - the room's body. Wrapped, not re-styled.
 * @param {boolean}  [reveal]   - arm the scroll-reveal contract on the body.
 * @param {string}   [maxWidth] - an optional measure, e.g. "max-w-5xl".
 * @param {string}   [bodyClassName] - classes on the body wrapper. Needed by a
 *   room whose body is several siblings that relied on their PARENT's flex gap:
 *   one wrapper is fine for a single child, but it swallows the spacing between
 *   siblings, so those rooms pass e.g. "flex flex-col gap-4" to keep it exact.
 * @param {string}   [className]- extra classes on the outer element.
 */
export default function PageShell({
  title,
  subtitle,
  eyebrow,
  icon,
  actions,
  children,
  reveal = false,
  maxWidth,
  bodyClassName,
  className,
}) {
  return (
    <div className={cn("w-full", maxWidth, className)}>
      {/* The masthead carries NO entrance of its own — deliberate, not an
          omission. Measured at v0.9.99 and mended at v0.9.100: `.mast-rise`
          declares a BASE `opacity: 0` and relies on its own `forwards` fill to
          hold the end state. Inside `.deck-enter` the shell's rule
          (`.deck-enter > :only-child > *`, specificity 0,2,0) outbids
          `.mast-rise` (0,1,0) and substitutes `deckEnter … backwards`, which
          never fills forward — so the base `opacity: 0` showed through and
          every adopted room's masthead rendered INVISIBLE. The shell already
          animates this header as a top-level block of the page; wearing a
          second entrance on a deck-animated element is precisely what the
          note at the top of this file says the shell will not do. */}
      <header className="flex flex-wrap items-start gap-4 mb-6 lg:mb-8">
        {icon ? (
          <span
            className="mast-compass-tile flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-brand)] bg-brand-500/10 text-brand-500"
            aria-hidden="true"
          >
            <span className="material-symbols-outlined text-[22px]">{icon}</span>
          </span>
        ) : null}

        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-subtle mb-1">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mast-tide relative inline-block text-xl lg:text-2xl font-semibold text-text-main leading-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1.5 text-sm text-text-muted max-w-2xl">{subtitle}</p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </header>

      {/*
        The body. `data-reveal` is the INTENT marker only — useReveal() is what
        arms the hiding, and only for elements already mounted when it runs. A
        room that never calls the hook renders this body normally, which is the
        safety contract: nothing carries the hiding class in markup.
      */}
      <div data-reveal={reveal ? "" : undefined} className={bodyClassName}>
        {children}
      </div>
    </div>
  );
}
