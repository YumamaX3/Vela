"use client";

// useAmbient — the deck's motion budget, enforced (v0.9.99).
//
// WHY IT EXISTS: an infinite CSS animation repaints for as long as its
// element is on screen, whether or not anyone is looking at it. Before this
// tide the deck ran thirty-one of them at once at periods as short as 0.18s.
// On a 60Hz display that is a repaint roughly every eleventh frame, forever,
// on a panel a person opens forty times a day. The ambient ladder's two
// tokens (--motion-dur-ambient, --motion-dur-drift) make the LOOP slower;
// this hook is what makes it STOP when nobody can see it.
//
// THE CONTRACT: `[data-ambient="off"] * { animation-play-state: paused }` in
// globals.css. This module owns that attribute, and it is the single place
// the decision is made, so overlays cannot disagree about it.
//
// Three sources pause the deck, and each is deliberate:
//
//  · A covering surface — a modal or a drawer owns the screen. Wired by
//    whichever overlay is open calling `useAmbientPause(open)`: Modal, Drawer
//    and NineRemotePromoModal, each beside its existing useScrollLock. (This
//    line once claimed two of them already had it while none did — the claim
//    was measured false and the code mended to match it, never the reverse.)
//    A counter, not a boolean, because two overlays may
//    overlap (a drawer's confirm dialog) and the first to close must not
//    restart the tide while the other still covers the page.
//  · A background tab (`document.hidden`) — there is no viewer at all. This
//    is the same principle as usePageVisible, applied to paint instead of
//    fetch.
//  · A route transition — the deck is mid-crossing and the loops behind it
//    are being snapshotted into the transition's old-state texture.
//
// This is NOT prefers-reduced-motion. That setting stops animation entirely
// and is honoured separately, in CSS, for every consumer without a hook.
// This one only decides whether a loop that is already permitted may run
// while off-screen. Both apply, neither replaces the other.

import { useEffect, useState } from "react";

// Module scope, not React state: the counter must be readable by an overlay
// that mounts anywhere in the tree, and one shared number is the only way two
// overlapping overlays can agree.
let pauseCount = 0;
const listeners = new Set();

function notify() {
  for (const fn of listeners) fn(pauseCount);
}

/** Called by any overlay that covers the page while it is open. */
export function useAmbientPause(active) {
  useEffect(() => {
    if (!active) return undefined;
    pauseCount += 1;
    notify();
    return () => {
      pauseCount = Math.max(0, pauseCount - 1);
      notify();
    };
  }, [active]);
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Owned by the shell. Writes `data-ambient="off"` on <html> when the deck's
 * ambient loops must hold still, and removes it the moment they may run.
 */
export function useAmbientController({ transitioning = false } = {}) {
  const [paused, setPaused] = useState(false);

  useEffect(() => subscribe(setPaused), []);

  useEffect(() => {
    const sync = () => {
      const hidden =
        typeof document !== "undefined" && document.visibilityState === "hidden";
      const off = paused || hidden || transitioning;
      document.documentElement.dataset.ambient = off ? "off" : "on";
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      // Leave the deck running rather than paused: a shell that unmounts is
      // not a shell that should freeze the next page's tide.
      delete document.documentElement.dataset.ambient;
    };
  }, [paused, transitioning]);
}

export default useAmbientController;
