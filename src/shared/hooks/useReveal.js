"use client";

// useReveal — the long rooms' incoming tide (v0.9.99).
//
// WHY IT EXISTS: `.deck-enter` (the shell's choreography) animates a page's
// top-level blocks on MOUNT. The long rooms — usage, logs, providers, the
// media fleet — are taller than a screen, so everything below the fold has
// already finished animating before it is ever seen, and simply exists by
// the time it scrolls into view. There is no arrival for the lower half.
//
// WHY THE CLASS IS ADDED HERE AND NEVER IN JSX: `.reveal` is what HIDES an
// element (opacity 0 + a rise). If a room wrote `className="reveal"` into
// its markup, that element would be invisible on any client where this
// hook never ran — no-JS, a hydration failure, a route that never mounts it.
// So the contract is inverted: markup declares INTENT (`data-reveal`), and
// the hook is what arms the hiding. An element without the hook is a normal,
// visible element. This is the whole safety story, and it is why `data-reveal`
// is the only thing a page should carry.
//
// `--reveal-i` carries the element's place among its reveal-siblings, capped
// at the same eighth position `.deck-enter` caps at — past eight, a stagger
// is latency with better manners.
//
// Anything already inside the viewport is revealed in the SAME tick as its
// arming, so nothing that is on screen is ever painted hidden first, and no
// transition fires for it (both classes land before the first style recalc).

import { useEffect } from "react";

/** True when the visitor has asked their system for stillness. */
function prefersStillness() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const STAGGER_CAP = 7;

export function useReveal({
  rootMargin = "0px 0px -6% 0px",
  threshold = 0.06,
  routeKey,
} = {}) {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll("[data-reveal]"));
    if (nodes.length === 0) return undefined;

    // No observer (or a stillness request): show everything, immediately.
    // Both classes land in one tick, so there is no transition and no
    // hidden paint — the content is simply present, which is the correct
    // reading of "still" for a reveal.
    if (typeof IntersectionObserver === "undefined" || prefersStillness()) {
      for (const el of nodes) el.classList.add("reveal", "is-in");
      return undefined;
    }

    let observer = null;
    const settle = (el) => {
      el.classList.add("is-in");
      observer?.unobserve(el);
    };

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) settle(entry.target);
        }
      },
      { rootMargin, threshold }
    );

    const above = [];
    for (const el of nodes) {
      // Its place among the reveal-siblings it shares a parent with — the
      // rows of a grid, the cards of a list. Falls back to 0 when it has
      // no parent to be counted within.
      const parent = el.parentElement;
      let index = 0;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) =>
          c.hasAttribute("data-reveal")
        );
        index = Math.max(siblings.indexOf(el), 0);
      }
      el.style.setProperty("--reveal-i", String(Math.min(index, STAGGER_CAP)));
      el.classList.add("reveal");

      const rect = el.getBoundingClientRect();
      const onScreen =
        rect.top < (window.innerHeight || 0) &&
        rect.bottom > 0 &&
        (rect.width > 0 || rect.height > 0);
      if (onScreen) above.push(el);
      else observer.observe(el);
    }

    // Same tick as the arming above: these never animate, they are simply
    // already here.
    for (const el of above) el.classList.add("is-in");

    return () => observer?.disconnect();
    // `routeKey` re-arms the scan on every navigation: the shell does not
    // remount between routes (only its content wrapper does), so without this
    // a newly rendered room's reveal markers would never be observed.
  }, [rootMargin, threshold, routeKey]);
}

export default useReveal;
