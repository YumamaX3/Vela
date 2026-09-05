// @vitest-environment happy-dom
/**
 * DashboardLayout — the mobile drawer is a dialog, and is now treated as one.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * The mobile sidebar is hidden with `-translate-x-full`, which moves it off-screen
 * but does NOT remove it from the tab order — it is not `display:none`. So a
 * keyboard user pressing Tab from the header walked into every sidebar link and
 * button, in document order, while seeing nothing: focus was invisible and the
 * activated control was unguessable. The overlay also had no Escape, no focus
 * containment, and no ARIA — opening it told a screen reader nothing.
 *
 * The toast container was likewise a plain `<div>`, so a "Rule deleted" or error
 * notification was never announced.
 *
 * ── THE PRODUCER-COVERAGE LAW (v0.9.46) ─────────────────────────────────────
 * A test that renders `<Sidebar>` or calls `setSidebarOpen(true)` proves the
 * component and nothing about this file. So every behavioural assertion below
 * mounts the REAL DashboardLayout (with its real Header and real Sidebar — no
 * child mocks) and clicks the REAL menu button. Only the router, `next/link`, and
 * `fetch` are stubbed, because those are environment boundaries, not the unit
 * under test.
 *
 * ── ENVIRONMENT NOTES (stated, not hidden) ──────────────────────────────────
 * · happy-dom has no layout: `getClientRects()` returns [] for everything, so
 *   useFocusTrap's visibility check is stubbed in beforeEach. Without the stub the
 *   hook treats every element as invisible and falls back to the container, which
 *   would make the containment assertions pass for the wrong reason.
 * · Children of Header/Sidebar issue `fetch("/api/...")` on mount. fetch is stubbed
 *   to a resolved Response so those calls do not produce ECONNREFUSED noise; the
 *   stub is not load-bearing for any assertion.
 * · happy-dom implements `inert` as a reflected boolean attribute, which is what
 *   makes the inert assertions meaningful here (probe-verified: `inert={false}`
 *   omits the attribute entirely rather than emitting a presence-truthy `inert=""`
 *   — the opposite would have made the sidebar permanently unreachable).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a>,
}));

import DashboardLayout from "@/shared/components/layouts/DashboardLayout";
import { useNotificationStore } from "@/store/notificationStore";

let container;
let root;

/**
 * The real menu button, found the way a user finds it: by the icon it shows.
 * Header.js:227-232 renders `<button onClick={onMenuClick}>` containing a
 * material-symbols ligature span with the text "menu". It carries NO aria-label,
 * so its accessible name is that ligature text — which is why selecting by
 * `textContent` is both the honest selector and a check that the name exists.
 */
function menuButton() {
  const buttons = [...container.querySelectorAll("button")];
  return buttons.find((b) => (b.textContent || "").trim() === "menu") || null;
}

/** The mobile sidebar panel — the element that carries `inert` and the trap ref. */
function mobilePanel() {
  return container.querySelector("div.fixed.inset-y-0.left-0") || null;
}

async function mountLayout() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<DashboardLayout><div data-t="page-content">page</div></DashboardLayout>);
  });
}

async function clickMenu() {
  const btn = menuButton();
  expect(btn, "the real Header menu button was not found").toBeTruthy();
  await act(async () => { btn.click(); });
}

async function pressEscape() {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

beforeEach(() => {
  // happy-dom has no layout engine. Stub the one visibility signal the focus trap
  // reads so its candidate filtering is exercised rather than short-circuited.
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ width: 10, height: 10 }]);

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "",
  }));
});

afterEach(async () => {
  if (root) { await act(async () => { root.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useNotificationStore.setState({ notifications: [] });
});

// ────────────────────────────────────────────────────────────────
// The off-screen drawer must leave the tab order when closed
// ────────────────────────────────────────────────────────────────

describe("the closed mobile sidebar is inert", () => {
  it("carries the inert attribute on first render, while closed", async () => {
    await mountLayout();
    const panel = mobilePanel();
    expect(panel, "mobile sidebar panel not found").toBeTruthy();
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(panel.inert).toBe(true);
  });

  it("is NOT display:none at mobile widths — which is why inert is required", async () => {
    // Records the premise: `inert` is load-bearing only because the closed drawer is
    // still rendered and still in the tab order. If this ever becomes a bare
    // `hidden`, inert goes redundant and this test should change with it.
    //
    // The panel DOES carry `lg:hidden`, and that is correct rather than a
    // contradiction: at ≥1024px the mobile drawer must be display:none entirely,
    // because the desktop sidebar takes over. So the assertion has to distinguish a
    // BARE `hidden` (display:none at every width — would make inert pointless) from a
    // breakpoint-prefixed one. `\bhidden\b` cannot: `\b` sits between `-` and `h` in
    // `lg:hidden`, so it matches the prefixed form too. An earlier draft of this test
    // used exactly that and failed against correct code.
    await mountLayout();
    const panel = mobilePanel();
    const cls = panel.className;
    expect(cls).toContain("-translate-x-full");

    const bareHidden = /(^|\s)hidden(\s|$)/.test(cls);
    expect(bareHidden, "the closed drawer is display:none at every width").toBe(false);

    // and the breakpoint-scoped hide is the one that SHOULD be there
    expect(cls).toContain("lg:hidden");
  });

  it("keeps its links and buttons out of the focus-trap's candidate list", async () => {
    // The behavioural consequence: useFocusTrap excludes `[inert]` SUBTREES via
    // closest(), so a sidebar button is not focusable while the drawer is shut.
    await mountLayout();
    const panel = mobilePanel();
    const inner = panel.querySelectorAll("a, button");
    expect(inner.length, "the closed sidebar rendered no controls to exclude").toBeGreaterThan(0);
    for (const el of inner) {
      expect(el.closest("[inert]"), "a closed-sidebar control escaped the inert subtree").toBeTruthy();
    }
  });
});

describe("opening the drawer from the real Header button", () => {
  it("removes inert, so the sidebar becomes reachable", async () => {
    await mountLayout();
    await clickMenu();
    const panel = mobilePanel();
    expect(panel.hasAttribute("inert")).toBe(false);
    // React must OMIT the attribute, not emit inert="" — a presence-truthy empty
    // string would leave the drawer permanently unreachable. Probe-verified for
    // React 19.2.4; asserted here so a React downgrade or a JSX rewrite to
    // `inert={sidebarOpen ? undefined : ""}` cannot reintroduce it silently.
    expect(panel.getAttribute("inert")).toBeNull();
  });

  it("moves the panel on-screen", async () => {
    await mountLayout();
    await clickMenu();
    expect(mobilePanel().className).toContain("translate-x-0");
    expect(mobilePanel().className).not.toContain("-translate-x-full");
  });

  it("renders the backdrop that closes on click", async () => {
    await mountLayout();
    await clickMenu();
    const backdrop = container.querySelector("div.fixed.inset-0.bg-black\\/20");
    expect(backdrop, "no backdrop rendered").toBeTruthy();
    await act(async () => { backdrop.click(); });
    expect(mobilePanel().hasAttribute("inert")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// Focus containment — the property `ref={drawerRef}` exists to deliver
//
// A mutation harness found that dropping `ref={drawerRef}` left the whole suite
// green: `inert` and the live region were covered, but nothing proved focus ever
// moved INTO the drawer. That is the single most load-bearing behaviour in this
// file and it was untested. These cases close it.
// ────────────────────────────────────────────────────────────────

/** requestAnimationFrame-based initial focus needs the frame to run. */
async function runFrame() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/**
 * Press Tab. Returns true when the trap intercepted it (preventDefault), which is
 * how a containment is distinguished from the browser's own tab order.
 */
function pressTab(shift = false) {
  let prevented = false;
  const ev = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  const orig = ev.preventDefault.bind(ev);
  ev.preventDefault = () => { prevented = true; orig(); };
  document.dispatchEvent(ev);
  return prevented;
}

describe("focus moves into the drawer and stays there", () => {
  it("focuses something INSIDE the panel when opened from the real button", async () => {
    await mountLayout();
    const btn = menuButton();
    // Focus the trigger first: the trap captures document.activeElement at open
    // time, and that is what makes focus restore work.
    btn.focus();
    expect(document.activeElement).toBe(btn);

    await clickMenu();
    await runFrame();

    const panel = mobilePanel();
    expect(
      panel.contains(document.activeElement),
      `focus did not enter the drawer; activeElement is ${
        document.activeElement === document.body ? "<body>" : document.activeElement.outerHTML?.slice(0, 80)
      }`
    ).toBe(true);
  });

  it("wraps Tab from the last sidebar control back to the first", async () => {
    await mountLayout();
    menuButton().focus();
    await clickMenu();
    await runFrame();

    const panel = mobilePanel();
    const focusables = [...panel.querySelectorAll("a[href], button")].filter(
      (el) => !el.disabled && el.closest("[inert]") === null
    );
    expect(focusables.length, "the open drawer has too few controls to test wrapping").toBeGreaterThan(1);

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    expect(document.activeElement).toBe(last);
    expect(pressTab(), "Tab off the end was not intercepted — focus would escape to the page").toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("wraps Shift+Tab from the first sidebar control back to the last", async () => {
    await mountLayout();
    menuButton().focus();
    await clickMenu();
    await runFrame();

    const panel = mobilePanel();
    const focusables = [...panel.querySelectorAll("a[href], button")].filter(
      (el) => !el.disabled && el.closest("[inert]") === null
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    first.focus();
    expect(pressTab(true), "Shift+Tab off the start was not intercepted").toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("returns focus to the menu button when the drawer closes via Escape", async () => {
    await mountLayout();
    const btn = menuButton();
    btn.focus();
    await clickMenu();
    await runFrame();
    expect(mobilePanel().contains(document.activeElement)).toBe(true);

    await pressEscape();
    expect(document.activeElement, "focus was not restored to the trigger").toBe(btn);
  });

  it("returns focus to the menu button when the drawer closes via the backdrop", async () => {
    await mountLayout();
    const btn = menuButton();
    btn.focus();
    await clickMenu();
    await runFrame();

    const backdrop = container.querySelector("div.fixed.inset-0.bg-black\\/20");
    await act(async () => { backdrop.click(); });
    expect(document.activeElement, "backdrop close did not restore focus").toBe(btn);
  });

  it("leaves focus alone while the drawer is closed", async () => {
    // The desktop sidebar renders unconditionally and must NOT be trapped — the
    // hook is gated on sidebarOpen, not on the element's mere presence.
    await mountLayout();
    document.body.focus();
    const before = document.activeElement;
    await runFrame();
    expect(document.activeElement).toBe(before);
  });
});

// ────────────────────────────────────────────────────────────────
// Escape — the drawer had no keyboard exit at all
// ────────────────────────────────────────────────────────────────

describe("Escape closes the drawer", () => {
  it("closes when Escape is pressed while open", async () => {
    await mountLayout();
    await clickMenu();
    expect(mobilePanel().hasAttribute("inert")).toBe(false);
    await pressEscape();
    expect(mobilePanel().hasAttribute("inert")).toBe(true);
  });

  it("attaches the listener only while open, so it cannot leak", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    await mountLayout();

    const keydownAddsClosed = add.mock.calls.filter((c) => c[0] === "keydown").length;
    await clickMenu();
    const keydownAddsOpen = add.mock.calls.filter((c) => c[0] === "keydown").length;
    await pressEscape();
    const keydownRemoves = remove.mock.calls.filter((c) => c[0] === "keydown").length;

    // Opening adds at least one keydown listener (Escape); the focus trap adds
    // another. Closing must remove them.
    expect(keydownAddsOpen, "opening added no keydown listener").toBeGreaterThan(keydownAddsClosed);
    expect(keydownRemoves, "closing removed no keydown listener").toBeGreaterThan(0);
  });

  it("does not close anything on an unrelated key", async () => {
    await mountLayout();
    await clickMenu();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(mobilePanel().hasAttribute("inert")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// Toast announcements — a plain div is silent to assistive tech
// ────────────────────────────────────────────────────────────────

describe("the toast container is a live region", () => {
  it("declares role=status, aria-live=polite and aria-atomic=false", async () => {
    await mountLayout();
    const region = container.querySelector('[role="status"]');
    expect(region, "no live region in the layout").toBeTruthy();
    expect(region.getAttribute("aria-live")).toBe("polite");
    // polite, not assertive: these are confirmations and warnings, not interruptions
    // worth stopping the user's current speech for.
    expect(region.getAttribute("aria-live")).not.toBe("assertive");
    // atomic=false so each toast is announced as it arrives, rather than the whole
    // stack being re-read on every change.
    expect(region.getAttribute("aria-atomic")).toBe("false");
  });

  it("announces a real notification pushed through the store", async () => {
    // Producer coverage: drive the actual store the app uses, then read the live
    // region's text — not a hand-built fixture.
    await mountLayout();
    await act(async () => {
      useNotificationStore.getState().addNotification({
        type: "success",
        title: "Rule deleted",
        message: "The fallback rule was removed.",
        dismissible: true,
      });
    });
    const region = container.querySelector('[role="status"]');
    expect(region.textContent).toContain("Rule deleted");
    expect(region.textContent).toContain("The fallback rule was removed.");
  });

  it("gives the dismiss control an accessible name", async () => {
    await mountLayout();
    await act(async () => {
      useNotificationStore.getState().addNotification({
        type: "error",
        title: "Failed",
        message: "Upstream refused.",
        dismissible: true,
      });
    });
    const dismiss = container.querySelector('[aria-label="Dismiss notification"]');
    expect(dismiss, "no dismiss control").toBeTruthy();
    await act(async () => { dismiss.click(); });
    const region = container.querySelector('[role="status"]');
    expect(region.textContent).not.toContain("Upstream refused.");
  });

  it("the icon ligature is hidden from assistive tech", async () => {
    await mountLayout();
    await act(async () => {
      useNotificationStore.getState().addNotification({
        type: "info", title: "Note", message: "Hello", dismissible: false,
      });
    });
    // The type icon renders as a material-symbols ligature word ("info"). Without
    // aria-hidden a screen reader would announce "info Note Hello" and read the
    // decoration as content.
    const icon = container.querySelector('[role="status"] .material-symbols-outlined');
    expect(icon, "no icon rendered").toBeTruthy();
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  });
});

// ────────────────────────────────────────────────────────────────
// The app shell height — dvh, with the fallback living in CSS
// ────────────────────────────────────────────────────────────────

describe("the app shell uses the dynamic viewport unit", () => {
  it("sets h-dvh on the root and never pairs it with h-screen", async () => {
    await mountLayout();
    const shell = container.firstElementChild;
    expect(shell.className).toContain("h-dvh");
    // Pairing both would resolve to 100vh: Tailwind emits .h-screen AFTER .h-dvh in
    // the built CSS, and cn() collapses the pair to one anyway. So the fallback must
    // live in @supports, not in the class list.
    expect(shell.className).not.toContain("h-screen");
  });

  it("keeps overflow-hidden, which is what makes a fixed shell work", async () => {
    await mountLayout();
    expect(container.firstElementChild.className).toContain("overflow-hidden");
  });
});

// ────────────────────────────────────────────────────────────────
// The desktop sidebar must NOT be trapped or inerted
// ────────────────────────────────────────────────────────────────

describe("the desktop sidebar is untouched by the mobile drawer state", () => {
  it("is never inert, whatever the drawer is doing", async () => {
    await mountLayout();
    // Desktop sidebar is the `hidden lg:flex` wrapper around <Sidebar/>; the mobile
    // one is the `fixed inset-y-0` panel. There are exactly two Sidebar instances.
    const desktop = container.querySelector("div.hidden.lg\\:flex");
    expect(desktop, "desktop sidebar wrapper not found").toBeTruthy();
    expect(desktop.hasAttribute("inert")).toBe(false);

    await clickMenu();
    expect(desktop.hasAttribute("inert")).toBe(false);
    await pressEscape();
    expect(desktop.hasAttribute("inert")).toBe(false);
  });

  it("the page content stays reachable while the drawer is closed", async () => {
    await mountLayout();
    const content = container.querySelector('[data-t="page-content"]');
    expect(content.closest("[inert]")).toBeNull();
  });
});
