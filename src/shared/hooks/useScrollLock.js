"use client";

import { useEffect } from "react";

/**
 * useScrollLock — ref-counted body scroll lock for overlay layers.
 *
 * ── The bug this replaces ─────────────────────────────────────────────────────
 * Three components each wrote `document.body.style.overflow` directly:
 *   · Modal.js:26-34
 *   · Drawer.js:22-29
 *   · NineRemotePromoModal.js:21-27
 *
 * Modal and Drawer carry byte-for-byte identical effect blocks, and none of them
 * ref-counts. The unlock is a blind `overflow = ""`, so the LAST layer to close
 * unlocks the page even while another layer is still open.
 *
 * This is reachable today, not hypothetically. NineRemotePromoModal is mounted
 * from Sidebar.js:324, and Sidebar is mounted by DashboardLayout.js:81/90 — so
 * the promo modal exists on EVERY dashboard page. Sequence:
 *   1. open a page-level Modal          -> overflow = "hidden"
 *   2. Tab to the sidebar (Modal has no focus trap) and open the promo modal
 *                                         -> overflow = "hidden" (already was)
 *   3. close the promo modal            -> overflow = ""      <-- BUG
 * The page still scrolls behind the Modal that is still open.
 *
 * With a shared counter, step 3 decrements 2 -> 1 and leaves the lock in place.
 *
 * ── Design notes ─────────────────────────────────────────────────────────────
 *  · The counter is MODULE scope, not a ref: it must be shared across every
 *    component instance, including ones in different subtrees. That is the whole
 *    point — an instance-local counter would not see the other layer.
 *  · It resets to 0 rather than going negative, because an unmount during a
 *    close transition could otherwise leave the counter permanently skewed and
 *    the page permanently unscrollable — a worse failure than the one fixed.
 *  · The lock is applied on the transition 0 -> 1 only, and released on 1 -> 0
 *    only. Writing `overflow` on every mount would fight the browser's own
 *    scrollbar compensation repeatedly.
 *  · `document.body.style.overflow` is read and restored, not assumed to be "".
 *    If something else in the page set it (a print stylesheet toggle, say), this
 *    hook hands back what it found instead of blanking it.
 *  · SSR-safe: the effect only runs on the client, and the typeof guard covers a
 *    hook called during render on the server.
 *
 * @param {boolean} locked - true while this layer is open and needs the lock
 */

let lockCount = 0;
let previousOverflow = null;

export function useScrollLock(locked) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!locked) return;

    lockCount += 1;

    if (lockCount === 1) {
      // first layer takes the lock, remembering what it replaced
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    return () => {
      lockCount -= 1;
      if (lockCount <= 0) {
        lockCount = 0;
        document.body.style.overflow = previousOverflow ?? "";
        previousOverflow = null;
      }
    };
  }, [locked]);
}

/**
 * Test seam — lets a suite assert on (and reset) the counter between cases so a
 * leaked lock in one test cannot mask a bug in the next. Not part of the public
 * contract; exported because the counter is deliberately module-global and
 * therefore genuinely shared state that a test must be able to zero out.
 */
export function __resetScrollLockForTests() {
  lockCount = 0;
  previousOverflow = null;
}

export default useScrollLock;
