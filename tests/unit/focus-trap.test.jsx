// @vitest-environment happy-dom
/**
 * useFocusTrap — keyboard containment and focus restore for overlay layers.
 *
 * Modal.js and Drawer.js had ZERO focus handling (verified: grep for
 * focus|tabIndex|Tab in Modal.js returned nothing). Two consequences, both
 * production-reachable:
 *   1. keyboard users tab out of an open dialog into the page behind it and
 *      activate controls they cannot see (WCAG 2.4.3 focus order);
 *   2. it made the scroll-lock bug reachable — with no trap, a tab-navigating
 *      user inside a page Modal could reach the sidebar, open
 *      NineRemotePromoModal (mounted from Sidebar.js:324, so present on every
 *      dashboard page), and on closing it unlock scrolling behind the still-open
 *      Modal.
 *
 * PRODUCER COVERAGE: the cases that matter are asserted through the REAL Drawer
 * component, not only through a bare hook, because the integration (does Drawer
 * attach the ref? does it still render its title and close button?) is where a
 * regression would actually land. The bare-hook cases cover the edge conditions
 * no component exercises.
 *
 * happy-dom limitations, stated rather than papered over: it has no layout, so
 * getClientRects() returns [] for every element and offsetParent is always null.
 * The visibility filter therefore cannot be exercised as a browser would — these
 * tests stub getClientRects to make elements "visible", which is the honest way
 * to test the filter under happy-dom, and is called out in each place it matters.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

import Drawer from "@/shared/components/Drawer";
import Modal from "@/shared/components/Modal";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";

// happy-dom gives every element an empty getClientRects(); without this stub the
// visibility filter rejects ALL elements and every trap looks broken. Stubbing is
// not cheating here — it stands in for the layout the test environment lacks.
beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => [{ width: 100, height: 40 }]);
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}

const flush = async () => act(async () => {});

/** requestAnimationFrame-based initial focus needs the frame to run. */
async function runFrame() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

// A real component, rendered via JSX — NOT a function called directly. Calling
// trapLayer({...}) runs useRef outside React's render and throws
// "Invalid hook call", which was my first draft's bug, not the hook's.
function TrapLayer({ active, initialFocus, restoreFocus, children }) {
  const { ref } = useFocusTrap(active, { initialFocus, restoreFocus });
  return <div ref={ref} data-testid="trap">{children}</div>;
}

function pressTab(shift = false) {
  const ev = new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true });
  act(() => { document.dispatchEvent(ev); });
  return ev.defaultPrevented;
}

// ────────────────────────────────────────────────────────────────
// Through the REAL Drawer — the integration that matters
// ────────────────────────────────────────────────────────────────

describe("Drawer — focus containment and ARIA, on the real component", () => {
  it("moves focus into the drawer on open and traps Tab at the ends", async () => {
    const outside = document.createElement("button");
    outside.textContent = "outside trigger";
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    const { root, container } = render(
      <Drawer isOpen={false} onClose={() => {}} title="Request details">
        <button>action one</button>
        <button>action two</button>
      </Drawer>
    );
    await flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    act(() => root.render(
      <Drawer isOpen={true} onClose={() => {}} title="Request details">
        <button>action one</button>
        <button>action two</button>
      </Drawer>
    ));
    await flush();
    await runFrame();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();

    // focus must have moved OUT of the page and INTO the dialog
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab from the last element must wrap to the first (preventDefault = trapped)
    const buttons = [...dialog.querySelectorAll("button")];
    const last = buttons[buttons.length - 1];
    last.focus();
    expect(pressTab()).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);

    // Shift+Tab from the first must wrap to the last
    buttons[0].focus();
    expect(pressTab(true)).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("restores focus to the trigger on close", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "open it";
    document.body.appendChild(trigger);
    trigger.focus();

    const { root } = render(
      <Drawer isOpen={true} onClose={() => {}} title="Details">
        <button>inside</button>
      </Drawer>
    );
    await flush();
    await runFrame();
    expect(document.activeElement).not.toBe(trigger);

    act(() => root.render(
      <Drawer isOpen={false} onClose={() => {}} title="Details">
        <button>inside</button>
      </Drawer>
    ));
    await flush();

    expect(document.activeElement).toBe(trigger);
  });

  it("carries role=dialog, aria-modal, aria-labelledby pointing at its own title, and a labelled close button", async () => {
    const { container } = render(
      <Drawer isOpen={true} onClose={() => {}} title="Request details">
        <p>body</p>
      </Drawer>
    );
    await flush();

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");

    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const heading = container.querySelector(`#${CSS.escape(labelledBy)}`);
    expect(heading).toBeTruthy();
    expect(heading.textContent).toBe("Request details");
    expect(heading.tagName).toBe("H2");

    // the close button is icon-only (Material Symbols ligature), so it needs a name
    const close = container.querySelector('button[aria-label="Close"]');
    expect(close).toBeTruthy();
    expect(close.querySelector("span").getAttribute("aria-hidden")).toBe("true");

    // and it must NOT have an accessible-name-colliding id from a module constant:
    // two drawers must not share an aria-labelledby target
    const { container: c2 } = render(
      <Drawer isOpen={true} onClose={() => {}} title="Other drawer"><p>x</p></Drawer>
    );
    await flush();
    const id2 = c2.querySelector('[role="dialog"]').getAttribute("aria-labelledby");
    expect(id2).not.toBe(labelledBy);
  });

  it("omits aria-labelledby when there is no title, rather than pointing at nothing", async () => {
    const { container } = render(
      <Drawer isOpen={true} onClose={() => {}}><p>body</p></Drawer>
    );
    await flush();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog.getAttribute("aria-labelledby")).toBeNull();
  });

  it("clamps to the viewport: max-w-full sits beside the width token, not replacing it", async () => {
    // THE MOBILE FIX. w-[600px] on a 375px viewport pushes 225px off-screen.
    // max-w-full clamps it. Both must be present — if max-w-full were merged away
    // by a conflict resolver that treated w- and max-w- as one group, the fix
    // would silently not exist. This is the assertion that ties the fix to
    // cn-conflict-resolution.test.js's "keeps w- and max-w-" case.
    for (const width of ["sm", "md", "lg", "xl", "full"]) {
      const { container } = render(
        <Drawer isOpen={true} onClose={() => {}} title="t" width={width}><p>b</p></Drawer>
      );
      await flush();
      const dialog = container.querySelector('[role="dialog"]');
      const cls = dialog.className;
      expect(cls).toContain("max-w-full");
      expect(cls).toContain("absolute");
      expect(cls).toContain("right-0");
      document.body.replaceChildren();
    }
    // and the lg call site specifically — both real call sites pass width="lg"
    const { container } = render(
      <Drawer isOpen={true} onClose={() => {}} title="t" width="lg"><p>b</p></Drawer>
    );
    await flush();
    const cls = container.querySelector('[role="dialog"]').className;
    expect(cls).toMatch(/w-\[600px\]/);
    expect(cls).toContain("max-w-full");
  });
});

// ────────────────────────────────────────────────────────────────
// The hook contract — edge cases no component exercises
// ────────────────────────────────────────────────────────────────

describe("useFocusTrap contract", () => {
  it("gives an overlay that opens with text a focus home (tabindex=-1 on the container)", async () => {
    // A dialog whose first child is a heading is not focusable, so "move focus
    // into the dialog" would silently do nothing. The hook must add tabindex=-1.
    const { container } = render(
      <TrapLayer active={true}><h2>Title</h2><p>Just text</p></TrapLayer>
    );
    await flush();
    await runFrame();

    const trap = container.querySelector('[data-testid="trap"]');
    expect(trap.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(trap);

    // Tab with nothing focusable must be held on the container, not escape
    expect(pressTab()).toBe(true);
    expect(document.activeElement).toBe(trap);
  });

  it("honours initialFocus for a form dialog", async () => {
    const { container } = render(
      <TrapLayer active={true} initialFocus='[name="email"]'>
        <button>Cancel</button>
        <input name="email" />
        <button>Save</button>
      </TrapLayer>
    );
    await flush();
    await runFrame();

    expect(document.activeElement).toBe(container.querySelector('input[name="email"]'));
  });

  it("falls back to the first focusable when initialFocus matches nothing", async () => {
    const { container } = render(
      <TrapLayer active={true} initialFocus="[name=does-not-exist]">
        <button>first</button>
        <button>second</button>
      </TrapLayer>
    );
    await flush();
    await runFrame();
    expect(document.activeElement).toBe(container.querySelector("button"));
  });

  it("does not restore focus when restoreFocus is false (a non-modal layer)", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const { root, container } = render(
      <TrapLayer active={true} restoreFocus={false}>
        <button>menu item</button>
      </TrapLayer>
    );
    await flush();
    await runFrame();
    expect(container.querySelector("button")).toBeTruthy();

    act(() => root.render(
      <TrapLayer active={false} restoreFocus={false}>
        <button>menu item</button>
      </TrapLayer>
    ));
    await flush();

    // a dropdown returns focus to its own trigger, not to whatever was focused
    expect(document.activeElement).not.toBe(trigger);
  });

  it("restores focus to the INNER layer's element when overlays are stacked", async () => {
    // The trap captures document.activeElement at open time, not a trigger ref.
    // So closing the inner overlay returns focus to whatever held focus inside
    // the outer one — which is what makes stacking behave.
    //
    // showTrafficLights={false} on purpose: a Modal otherwise renders TWO close
    // buttons (the desktop traffic light and the md:hidden X), both focusable
    // under happy-dom because it has no layout. Asserting on "the first
    // focusable" would then be ambiguous. Probing found this, not theory.
    //
    // The assertion is CONTAINMENT, not a specific element: the hook focuses the
    // first focusable inside the dialog, and which one that is depends on the
    // dialog's own markup. An earlier draft asserted `activeElement === the
    // "inner action" button` and was wrong — focus correctly landed on the
    // dialog's own close control. The property that matters is that focus moved
    // INTO the inner dialog and back OUT to the outer one.
    const outerTrigger = document.createElement("button");
    outerTrigger.textContent = "outer trigger";
    document.body.appendChild(outerTrigger);
    outerTrigger.focus();

    const { root } = render(
      <Modal isOpen={true} onClose={() => {}} title="Outer" showTrafficLights={false}>
        <button>outer action</button>
      </Modal>
    );
    await flush();
    await runFrame();

    const dialogs = () => [...document.querySelectorAll('[role="dialog"]')];
    expect(dialogs()).toHaveLength(1);
    // focus must have left the page trigger and entered the dialog
    expect(dialogs()[0].contains(document.activeElement)).toBe(true);

    const outerButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "outer action");
    expect(outerButton).toBeTruthy();
    outerButton.focus();
    expect(document.activeElement).toBe(outerButton);

    // stack a second overlay on top
    act(() => root.render(
      <>
        <Modal isOpen={true} onClose={() => {}} title="Outer" showTrafficLights={false}>
          <button>outer action</button>
        </Modal>
        <Modal isOpen={true} onClose={() => {}} title="Inner" showTrafficLights={false}>
          <button>inner action</button>
        </Modal>
      </>
    ));
    await flush();
    await runFrame();

    expect(dialogs()).toHaveLength(2);
    const [outerDialog, innerDialog] = dialogs();
    expect(outerDialog.querySelector("h2").textContent).toBe("Outer");
    expect(innerDialog.querySelector("h2").textContent).toBe("Inner");
    // focus must be inside the INNER dialog, not still in the outer one
    expect(innerDialog.contains(document.activeElement)).toBe(true);
    expect(outerDialog.contains(document.activeElement)).toBe(false);

    // close the inner one — focus must land back INSIDE the outer dialog, on the
    // element that held focus when the inner opened (the outer's "outer action"
    // button), NOT on the outer trigger and not left dangling on document.body
    act(() => root.render(
      <>
        <Modal isOpen={true} onClose={() => {}} title="Outer" showTrafficLights={false}>
          <button>outer action</button>
        </Modal>
        <Modal isOpen={false} onClose={() => {}} title="Inner" showTrafficLights={false}>
          <button>inner action</button>
        </Modal>
      </>
    ));
    await flush();

    expect(dialogs()).toHaveLength(1);
    expect(document.activeElement).toBe(outerButton);
  });

  it("does not throw when the container has no focusable elements and is unmounted while open", async () => {
    const { root } = render(<TrapLayer active={true}><p>text only</p></TrapLayer>);
    await flush();
    await runFrame();
    expect(() => act(() => root.render(<></>))).not.toThrow();
    await flush();
  });

  it("verifies focus actually moved, because a refused focus() is silent", async () => {
    // A DEFECT THIS PINS. The first implementation checked
    // `el.hasAttribute("inert")` — the element's OWN attribute. A button inside
    // <div inert> carries no inert attribute itself, so the hook selected it as
    // the first focusable, called focus(), and the browser silently refused:
    // activeElement stayed on document.body and the dialog opened with focus
    // still on the page behind it. Nothing threw, nothing logged.
    //
    // Two things close it, and this test pins both:
    //  · isFocusable walks ancestors via closest("[inert]")
    //  · focusInitial VERIFIES each candidate against document.activeElement and
    //    falls through to the next, then to the container, rather than trusting
    //    the first call it made
    //
    // happy-dom honours inert on subtree focus, so this reproduces the real
    // browser behaviour rather than modelling it.
    const { container } = render(
      <TrapLayer active={true}>
        <div inert><button>inside inert</button></div>
        <button>the only real one</button>
      </TrapLayer>
    );
    await flush();
    await runFrame();

    const trap = container.querySelector('[data-testid="trap"]');
    // focus must have landed on the REAL button — not on the inert one, and not
    // left on document.body (whose textContent would be the whole tree)
    expect(document.activeElement.textContent).toBe("the only real one");
    expect(document.activeElement.closest("[inert]")).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(trap.contains(document.activeElement)).toBe(true);
  });

  it("falls back to the container when every child refuses focus", async () => {
    // If nothing inside the trap will accept focus, the container must take it so
    // focus stays inside the dialog rather than escaping to the page.
    const { container } = render(
      <TrapLayer active={true}>
        <div inert><button>trapped inside inert</button></div>
      </TrapLayer>
    );
    await flush();
    await runFrame();

    const trap = container.querySelector('[data-testid="trap"]');
    expect(document.activeElement).toBe(trap);
    expect(trap.getAttribute("tabindex")).toBe("-1");
  });

  it("never even ATTEMPTS to focus an element inside an inert subtree", async () => {
    // WHY THIS TEST EXISTS — a mutation harness found that two of my defenses were
    // MUTUALLY COVERING and no assertion could tell them apart.
    //
    // useFocusTrap excludes inert descendants two ways: isFocusable() filters them
    // with closest("[inert]"), and focusInitial() VERIFIES each focus() call and
    // falls through to the next candidate when activeElement did not move. Under
    // happy-dom (which refuses focus on inert descendants, as browsers do) removing
    // EITHER one still produced the correct final activeElement — so both mutations
    // survived a suite that asserted only on outcomes.
    //
    // The difference is observable one level down: with the filter removed, the hook
    // still CALLS focus() on an element it should never have selected. So this
    // asserts on the attempt, not the result. It is a behavioural claim, not an
    // implementation detail — selecting an unfocusable element as a focus target is
    // the bug, whether or not a second mechanism happens to paper over it.
    const focused = [];
    const originalFocus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (...args) {
      focused.push(this.textContent || this.tagName);
      return originalFocus.apply(this, args);
    });

    try {
      const { container } = render(
        <TrapLayer active={true}>
          <div inert><button>inside inert</button></div>
          <button>the only real one</button>
        </TrapLayer>
      );
      await flush();
      await runFrame();

      expect(focused).not.toContain("inside inert");
      expect(focused).toContain("the only real one");
      expect(document.activeElement.textContent).toBe("the only real one");
      expect(container.querySelector('[data-testid="trap"]')).toBeTruthy();
    } finally {
      vi.restoreAllMocks();
      // the beforeEach getClientRects stub was restored too — reinstate it so the
      // remaining cases in this file still see a "visible" layout
      vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => [{ width: 100, height: 40 }]);
    }
  });

  it("moves to the next candidate when a focus() call is silently refused", async () => {
    // Pins the VERIFICATION loop independently of the inert filter — the other half
    // of the mutual-covering problem above. A browser refuses focus() for reasons
    // beyond inert (an element removed during the same frame, an off-screen
    // position:fixed node, a browser extension suppressing it), and the refusal is
    // SILENT: no throw, no log, activeElement simply does not move.
    //
    // Modelled directly by neutering the first button's focus() in its ref callback,
    // which runs before the trap's effect. That is the observable contract of a
    // refused focus, without depending on inert (which the filter already handles).
    const trap = render(
      <TrapLayer active={true}>
        <button ref={(el) => { if (el) el.focus = () => {}; }}>refuses focus</button>
        <button>accepts focus</button>
      </TrapLayer>
    );
    await flush();
    await runFrame();

    const [b1, b2] = [...trap.container.querySelectorAll("button")];
    expect(b1.textContent).toBe("refuses focus");
    expect(b2.textContent).toBe("accepts focus");

    // With verification, the refused first candidate is skipped and the second
    // takes focus. Without it, the hook would call focus() once, assume success,
    // and leave focus wherever it was — outside the trap, with nothing reported.
    expect(document.activeElement).toBe(b2);
    expect(trap.container.querySelector('[data-testid="trap"]').contains(document.activeElement)).toBe(true);
  });

  it("skips elements that are hidden, disabled, inert or aria-hidden", async () => {
    const { container } = render(
      <TrapLayer active={true}>
        <button disabled>disabled</button>
        <button hidden>hidden</button>
        <div inert><button>inside inert</button></div>
        <button aria-hidden="true">aria-hidden</button>
        <button>the only real one</button>
      </TrapLayer>
    );
    await flush();
    await runFrame();

    // and Tab must cycle only among real ones. NOTE: this fixture has exactly ONE
    // focusable element — disabled, hidden, inside-inert and aria-hidden are all
    // excluded — so "cycling" means wrapping to itself.
    //
    // Selected BY TEXT, not by a CSS selector. Two selector attempts failed here
    // and both failed the same way: `button:not([disabled])` returns the `hidden`
    // button, and `:not([disabled]):not([hidden]):not([aria-hidden])` still
    // returns the button inside <div inert>, because that button carries NONE of
    // those attributes itself — inert is an ANCESTOR property and a descendant
    // selector cannot express "not inside an inert subtree" portably. The hook
    // handles it with closest("[inert]"); a test selector cannot, so the test
    // picks the element by name and then asserts the inert exclusion separately.
    const onlyReal = [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "the only real one");
    expect(onlyReal).toBeTruthy();
    expect(onlyReal.closest("[inert]")).toBeNull();

    onlyReal.focus();
    expect(document.activeElement).toBe(onlyReal);
    expect(pressTab()).toBe(true);
    expect(document.activeElement).toBe(onlyReal);
    expect(pressTab(true)).toBe(true);
    expect(document.activeElement).toBe(onlyReal);
  });
});
