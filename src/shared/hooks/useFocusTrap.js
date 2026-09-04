"use client";

import { useEffect, useRef } from "react";

/**
 * useFocusTrap — keeps keyboard focus inside an open overlay, and returns it to
 * whatever held focus before the overlay opened.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Neither Modal.js nor Drawer.js had ANY focus handling (verified: grep for
 * focus|tabIndex|Tab in Modal.js returned nothing). That has two consequences:
 *
 *  1. Keyboard users tab straight out of an open dialog into the page behind it,
 *     activating controls they cannot see. WCAG 2.4.3 (focus order) and the
 *     accessibility rule's "no keyboard traps" both require focus to stay with the
 *     dialog while it is modal.
 *
 *  2. It made the scroll-lock bug reachable in production. NineRemotePromoModal is
 *     mounted from Sidebar.js:324 and so exists on every dashboard page; with no
 *     trap, a tab-navigating user inside a page Modal could reach the sidebar,
 *     open the promo modal, and on closing it unlock scrolling behind the Modal
 *     that was still open. Closing the trap closes that path too.
 *
 * ── Design notes ─────────────────────────────────────────────────────────────
 *  · Focus restore uses `document.activeElement` captured at open time, NOT a
 *    stored trigger ref. That is what makes stacked overlays work: close B and
 *    focus returns to whatever was focused inside A, not to A's original trigger.
 *  · The container gets tabIndex={-1} programmatically if it is not focusable, so
 *    an overlay whose first child is inert (a heading, a paragraph) still receives
 *    focus and still has a home for it. Without this, "move focus into the dialog"
 *    silently does nothing for dialogs that open with text.
 *  · Visibility is checked, not just presence. `disabled`, the `hidden`
 *    attribute, an `inert` SUBTREE (via closest, not the element's own attribute),
 *    `aria-hidden="true"`, and zero client rects are all excluded. `inert` needed
 *    closest() because a button inside `<div inert>` is unfocusable even though
 *    the button itself carries no inert attribute — a defect caught by test.
 *  · A refused focus() is silent, so each candidate is tried and VERIFIED against
 *    document.activeElement before being accepted, and the container is the final
 *    fallback. Without that, the trap could open with focus still on the page
 *    behind it and nothing would report the failure.
 *  · Escape is deliberately NOT handled here. Modal.js, Drawer.js and
 *    NineRemotePromoModal.js each already own their Escape semantics, and two of
 *    them differ on purpose (the promo modal attaches only while open; the others
 *    attach always and guard inside). A trap that also closed the overlay would
 *    fire onClose twice. This hook does one thing.
 *  · SSR-safe: every DOM access is inside the effect.
 *
 * @param {boolean} active - true while the overlay is open
 * @param {{ initialFocus?: string, restoreFocus?: boolean }} [options]
 *   initialFocus — CSS selector inside the container to focus first (e.g. an input
 *                  in a form dialog). Falls back to the first focusable element,
 *                  then the container.
 *   restoreFocus — set false for a non-modal layer (a dropdown menu) whose trigger
 *                  should keep focus itself. Defaults to true.
 * @returns {{ ref: React.RefObject }} attach ref to the overlay container
 */

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable]:not([contenteditable=false])",
  '[tabindex]:not([tabindex="-1"])',
  "summary",
  "details",
].join(",");

function isFocusable(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.disabled) return false;
  if (el.hidden) return false;
  // `inert` applies to a SUBTREE, so checking the element's own attribute is not
  // enough — a button inside <div inert> is not focusable, and the browser
  // silently refuses focus() on it. This was a real defect caught by test: the
  // hook picked that button as its first focusable, focus() no-op'd, and
  // activeElement stayed on document.body. `closest` walks the ancestors.
  // (`el.inert` reflects only the element's OWN idl attribute, per spec.)
  if (el.closest("[inert]")) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  // offsetParent is null for display:none AND for position:fixed; a fixed element
  // is still focusable, so check getClientRects as the reliable visibility signal.
  if (!el.getClientRects().length) return false;
  return true;
}

export function useFocusTrap(active, options = {}) {
  const { initialFocus, restoreFocus = true } = options;
  const ref = useRef(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!active) return;

    const container = ref.current;
    if (!container) return;

    const previouslyFocused = document.activeElement;

    const getFocusable = () =>
      Array.from(container.querySelectorAll(FOCUSABLE)).filter(isFocusable);

    // Give the container a focus home when it is not itself focusable, so an
    // overlay that opens with a heading still traps focus somewhere real.
    const containerNeedsTabIndex =
      !container.hasAttribute("tabindex") && getFocusable().length === 0;
    if (containerNeedsTabIndex) container.setAttribute("tabindex", "-1");

    const focusInitial = () => {
      const candidates = [];
      if (initialFocus) {
        const target = container.querySelector(initialFocus);
        if (target && isFocusable(target)) candidates.push(target);
      }
      candidates.push(...getFocusable());

      // A refused focus() is SILENT — the browser does not throw, activeElement
      // simply stays where it was, and the dialog opens with focus outside itself.
      // That is exactly what the inert-subtree defect did. So each candidate is
      // tried and VERIFIED, rather than trusting the first one.
      for (const el of candidates) {
        el.focus();
        if (document.activeElement === el) return;
      }

      // Last resort: the container itself. Give it a focus home if it has none,
      // so focus lands somewhere inside the trap instead of escaping to the page.
      if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
      container.focus();
    };

    // Focus on the next frame: a dialog mounted in the same commit is not yet
    // focusable, and focusing synchronously is a no-op in that case.
    const raf = requestAnimationFrame(focusInitial);

    const onKeyDown = (e) => {
      if (e.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        // Nothing to cycle to. Hold focus on the container so Tab cannot escape
        // into the page behind the overlay.
        e.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (e.shiftKey) {
        if (current === first || !container.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last || !container.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
      if (containerNeedsTabIndex) container.removeAttribute("tabindex");
      if (restoreFocus && previouslyFocused && typeof previouslyFocused.focus === "function") {
        // Restore only if the element is still in the document; a trigger that was
        // unmounted while the overlay was open cannot receive focus back.
        if (document.contains(previouslyFocused)) {
          previouslyFocused.focus();
        }
      }
    };
  }, [active, initialFocus, restoreFocus]);

  return { ref };
}

export default useFocusTrap;
