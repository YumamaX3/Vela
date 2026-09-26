"use client";

// useCountUp — a measurement that just moved (v0.9.99).
//
// WHY IT EXISTS: a KPI painted as 4,812 reads as a number. The same KPI
// counting to 4,812 reads as a measurement that has just arrived — which is
// what it is when a poll returns. The effect is small and it is spent only
// where a number is the point.
//
// THE READS, all three deliberate:
//
//  · It renders 0 until a value arrives. That is correct for its actual use
//    (a client component whose data is fetched): the first finite value it
//    sees IS the arrival, so the count begins from zero exactly once. It is
//    NOT a drop-in for a server-rendered figure — a number that must be
//    correct in the first paint should not be wrapped in this.
//  · A value that is not finite renders 0 and never animates, so a loading
//    state needs no special case at the call site.
//  · A stillness request jumps straight to the value. Counting is motion,
//    and motion is exactly what that setting declines.
//
// A value that CHANGES after mount counts from wherever it currently reads
// — never from zero again — so a poll that nudges 4,812 to 4,815 shows
// those three and not four thousand more.

import { useEffect, useRef, useState } from "react";

function prefersStillness() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Cubic ease-out: fast off the mark, settling into the final figure. The
// same curve family as --motion-ease-out, expressed here because a rAF loop
// cannot read a cubic-bezier token.
const ease = (p) => 1 - Math.pow(1 - p, 3);

export function useCountUp(value, { duration = 900, decimals = 0 } = {}) {
  const target = Number(value);
  const finite = Number.isFinite(target);
  const [shown, setShown] = useState(0);

  // What is currently on screen. Kept in a ref rather than read from state
  // so the animation's start point never depends on a render having flushed.
  const shownRef = useRef(0);

  useEffect(() => {
    if (!finite) {
      shownRef.current = 0;
      setShown(0);
      return undefined;
    }
    if (prefersStillness() || duration <= 0) {
      shownRef.current = target;
      setShown(target);
      return undefined;
    }

    const from = shownRef.current;
    if (from === target) {
      setShown(target);
      return undefined;
    }

    let raf = 0;
    const started = performance.now();

    const step = (now) => {
      const p = Math.min((now - started) / duration, 1);
      const next = from + (target - from) * ease(p);
      shownRef.current = next;
      setShown(next);
      if (p < 1) raf = requestAnimationFrame(step);
      else {
        shownRef.current = target;
        setShown(target);
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, finite, duration]);

  if (!finite) return decimals > 0 ? (0).toFixed(decimals) : "0";
  return decimals > 0 ? shown.toFixed(decimals) : String(Math.round(shown));
}

export default useCountUp;
