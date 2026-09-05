"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import Sidebar from "../Sidebar";
import Header from "../Header";

function getToastStyle(type) {
  if (type === "success") {
    return {
      wrapper: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
      icon: "check_circle",
    };
  }
  if (type === "error") {
    return {
      wrapper: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
      icon: "error",
    };
  }
  if (type === "warning") {
    return {
      wrapper: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      icon: "warning",
    };
  }
  return {
    wrapper: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    icon: "info",
  };
}

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  // The mobile sidebar is a real dialog: it covers the page, has a backdrop, and
  // traps the user's attention. It had none of the machinery that implies — no
  // Escape, no focus containment, no focus restore, no ARIA — so a keyboard user
  // who opened it could tab out into the page behind the backdrop and activate
  // controls they could not see, and a screen reader was never told it existed.
  //
  // `sidebarOpen` is the active flag; the desktop sidebar renders unconditionally
  // (hidden via lg:flex) and must NOT be trapped, which is why this is gated on
  // the state rather than on the element's mere presence.
  const { ref: drawerRef } = useFocusTrap(sidebarOpen);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onEscape = (e) => { if (e.key === "Escape") setSidebarOpen(false); };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [sidebarOpen]);

  return (
    /*
     * h-dvh, not h-screen. On iOS Safari and Chrome for Android the browser chrome
     * is part of 100vh but is overlaid by the URL bar, so an h-screen root scrolls
     * under the bar and its bottom content sits behind it — unreachable. dvh is the
     * *dynamic* viewport height and tracks the bar as it collapses.
     *
     * ⚠️ The fallback is NOT automatic, and a comment here once claimed it was.
     * Measured against the built CSS: Tailwind emits `.h-screen` AFTER `.h-dvh`, so
     * a class list carrying both would resolve to 100vh — and
     * `cn("h-screen h-dvh")` collapses to just `"h-dvh"` regardless, since twMerge
     * treats them as one group. An unsupported `100dvh` is also not a graceful
     * degradation: the declaration is invalid, dropped, and `height` falls back to
     * `auto` — which breaks this shell rather than merely aging it.
     *
     * The ordering RELATIONSHIP is the fact worth recording; the byte offsets are
     * not, because they move on every build. An earlier version of this comment
     * cited them, and they were already stale before it shipped.
     *
     * The real fallback lives in globals.css as `@supports not (height: 100dvh)`,
     * unlayered so it beats the utilities layer. That rule fixes every dvh
     * consumer, so nothing here needs to carry a second class.
     *
     * The three min-h-screen sites (callback/page.js x2, AuthLayout.js) are
     * deliberately left: those pages GROW past the viewport, so the dynamic unit
     * would let their centred content jump as the bar collapses. min-h on a
     * scrollable page is not the same defect as a fixed app shell.
     */
    <div className="flex h-dvh w-full overflow-hidden bg-bg">
      {/*
        role="status" + aria-live="polite": the toast container was invisible to
        assistive tech. A notification announcing "Rule deleted" or an error never
        reached a screen reader, because a DOM insertion inside a plain <div> is
        not announced. "polite" rather than "assertive" — these are confirmations
        and warnings, not interruptions worth stopping the user's current speech
        for. aria-atomic="false" so each toast is announced individually as it
        arrives rather than re-reading the whole stack on every change.
      */}
      <div
        className="fixed top-4 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2"
        role="status"
        aria-live="polite"
        aria-atomic="false"
      >
        {notifications.map((n) => {
          const style = getToastStyle(n.type);
          return (
            <div
              key={n.id}
              className={`rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm ${style.wrapper}`}
            >
              <div className="flex items-start gap-2">
                {/*
                  aria-hidden: this is a material-symbols LIGATURE, so its DOM text
                  is the icon name — "check_circle", "error", "warning", "info".
                  Without aria-hidden a screen reader announces the decoration as
                  content: "check_circle Rule deleted The rule was removed." The
                  severity already lives in the live region's own semantics
                  (role="status" is polite; errors are not raised to assertive), so
                  hiding the glyph loses nothing.

                  Matches the sibling overlays, which already do this:
                  Drawer.js:101 and Modal.js:113 both hide their close ligature.

                  The dismiss button's own "close" ligature does NOT need this: that
                  button carries aria-label="Dismiss notification", and an
                  aria-label overrides element content for the accessible name.
                */}
                <span
                  className="material-symbols-outlined text-[18px] leading-5"
                  aria-hidden="true"
                >
                  {style.icon}
                </span>
                <div className="min-w-0 flex-1">
                  {n.title ? <p className="text-xs font-semibold mb-0.5">{n.title}</p> : null}
                  <p className="text-xs whitespace-pre-wrap break-words">{n.message}</p>
                </div>
                {n.dismissible ? (
                  <button
                    type="button"
                    onClick={() => removeNotification(n.id)}
                    className="text-current/70 hover:text-current"
                    aria-label="Dismiss notification"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Desktop */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Sidebar - Mobile */}
      {/*
        `inert` while closed is the fix for a defect this layout has always had:
        the closed sidebar is moved off-screen with -translate-x-full, but it is
        NOT display:none — so every link and button inside it stayed in the tab
        order. A keyboard user pressing Tab from the header walked into a pile of
        invisible sidebar links before reaching the page content, with no way to
        see what they were activating. `inert` removes the whole subtree from the
        tab order and from assistive tech at once, and is what makes the focus trap
        below meaningful rather than decorative.

        React 19 (19.2.4 here) accepts `inert` as a real boolean. Deliberately NOT
        paired with aria-hidden: an aria-hidden subtree that can still receive
        focus is a hazard browsers warn about, and inert already covers the AT case
        without that risk.

        ref={drawerRef} arms useFocusTrap(sidebarOpen) — focus is contained while
        open and returned to whatever held it when the drawer closes. The hook
        excludes `[inert]` subtrees via closest(), so the closed state and the trap
        agree rather than fighting.
      */}
      <div
        ref={drawerRef}
        inert={!sidebarOpen}
        className={`fixed inset-y-0 left-0 z-50 transform lg:hidden transition-transform duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content */}
      <main className="flex flex-col flex-1 h-full min-w-0 relative transition-colors duration-300 isolate">
        {/* Faint grid background */}
        <div className="landing-grid absolute inset-0 pointer-events-none -z-10" aria-hidden="true" />
        <Header key={pathname} onMenuClick={() => setSidebarOpen(true)} />
        <div className={`flex-1 overflow-y-auto custom-scrollbar ${pathname === "/dashboard/basic-chat" ? "" : "p-6 lg:p-10"} ${pathname === "/dashboard/basic-chat" ? "flex flex-col overflow-hidden" : ""}`}>
          <div className={`${pathname === "/dashboard/basic-chat" ? "flex-1 w-full h-full flex flex-col" : "max-w-7xl mx-auto"}`}>{children}</div>
        </div>
      </main>
    </div>
  );
}
