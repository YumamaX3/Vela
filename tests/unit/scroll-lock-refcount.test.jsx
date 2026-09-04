// @vitest-environment happy-dom
/**
 * useScrollLock — ref-counted body scroll lock.
 *
 * THE PRODUCER-COVERAGE LAW (v0.9.46): a hook test that calls useScrollLock(true)
 * proves the hook and nothing about whether the components actually share the
 * counter — which is the entire mechanism. The bug being fixed is that Modal.js,
 * Drawer.js and NineRemotePromoModal.js each wrote document.body.style.overflow
 * directly, so the last layer to close unlocked the page while another was still
 * open.
 *
 * So this suite mounts REAL components in two places:
 *  · "the stacking bug" — two real Modal instances, opened together, one closed.
 *    This is the regression that would have shipped silently under the old code.
 *  · "the hook contract" — direct hook use, for the edge cases (negative
 *    counting, restoring a pre-existing overflow) that no component exercises.
 *
 * Both are needed: the component test proves the components share state, the hook
 * test proves the state machine is correct.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

import Modal from "@/shared/components/Modal";
import Drawer from "@/shared/components/Drawer";
import { useScrollLock, __resetScrollLockForTests } from "@/shared/hooks/useScrollLock";

/** A minimal component that takes the lock, so a test can drive two
 *  independent layers without needing two different real components. */
function LockLayer({ locked, id }) {
  useScrollLock(locked);
  return <div data-testid={`layer-${id}`} />;
}

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}

const flush = async () => act(async () => {});
const overflow = () => document.body.style.overflow;

beforeEach(() => {
  __resetScrollLockForTests();
  document.body.style.overflow = "";
});

afterEach(() => {
  document.body.replaceChildren();
  __resetScrollLockForTests();
  document.body.style.overflow = "";
});

// ────────────────────────────────────────────────────────────────
// THE BUG: two real components stacked. This is what the old
// direct-write code got wrong, and it is reachable in the app today
// because NineRemotePromoModal is mounted from Sidebar.js:324 and
// Sidebar is on every dashboard page (DashboardLayout.js:81/90).
// ────────────────────────────────────────────────────────────────

describe("the stacking bug — two real overlay components", () => {
  it("keeps the page locked while one of two open Modals closes", async () => {
    let a = true;
    let b = true;
    const { root, container } = render(
      <>
        <Modal isOpen={a} onClose={() => { a = false; }} title="First">body a</Modal>
        <Modal isOpen={b} onClose={() => { b = false; }} title="Second">body b</Modal>
      </>
    );
    await flush();

    expect(overflow()).toBe("hidden");

    // close ONE layer by re-rendering with isOpen=false — the same thing a real
    // onClose does
    act(() => root.render(
      <>
        <Modal isOpen={false} onClose={() => {}} title="First">body a</Modal>
        <Modal isOpen={b} onClose={() => { b = false; }} title="Second">body b</Modal>
      </>
    ));
    await flush();

    // PRE-FIX this was "": the closing Modal's cleanup wrote overflow = ""
    // blindly and unlocked the page behind the Modal still open.
    expect(overflow()).toBe("hidden");

    // closing the second one releases
    act(() => root.render(
      <>
        <Modal isOpen={false} onClose={() => {}} title="First">body a</Modal>
        <Modal isOpen={false} onClose={() => {}} title="Second">body b</Modal>
      </>
    ));
    await flush();

    expect(overflow()).toBe("");
    expect(container).toBeTruthy();
  });

  it("keeps the lock when a Modal and a Drawer are both open and one closes", async () => {
    const { root } = render(
      <>
        <Modal isOpen={true} onClose={() => {}} title="A modal">m</Modal>
        <Drawer isOpen={true} onClose={() => {}} title="A drawer">d</Drawer>
      </>
    );
    await flush();
    expect(overflow()).toBe("hidden");

    // Drawer closes, Modal stays — the Drawer must not unlock the Modal
    act(() => root.render(
      <>
        <Modal isOpen={true} onClose={() => {}} title="A modal">m</Modal>
        <Drawer isOpen={false} onClose={() => {}} title="A drawer">d</Drawer>
      </>
    ));
    await flush();
    expect(overflow()).toBe("hidden");

    act(() => root.render(
      <>
        <Modal isOpen={false} onClose={() => {}} title="A modal">m</Modal>
        <Drawer isOpen={false} onClose={() => {}} title="A drawer">d</Drawer>
      </>
    ));
    await flush();
    expect(overflow()).toBe("");
  });
});

// ────────────────────────────────────────────────────────────────
// The hook contract — edge cases no single component exercises.
// ────────────────────────────────────────────────────────────────

describe("useScrollLock contract", () => {
  it("locks on first layer and releases on last", async () => {
    const { root } = render(<LockLayer locked={false} id="1" />);
    await flush();
    expect(overflow()).toBe("");

    act(() => root.render(<LockLayer locked={true} id="1" />));
    await flush();
    expect(overflow()).toBe("hidden");

    act(() => root.render(<LockLayer locked={false} id="1" />));
    await flush();
    expect(overflow()).toBe("");
  });

  it("restores a pre-existing overflow value instead of blanking it", async () => {
    // If something else on the page set overflow (a print toggle, a third-party
    // widget), releasing must hand back what was found, not "".
    document.body.style.overflow = "scroll";
    const { root } = render(<LockLayer locked={true} id="1" />);
    await flush();
    expect(overflow()).toBe("hidden");

    act(() => root.render(<LockLayer locked={false} id="1" />));
    await flush();
    expect(overflow()).toBe("scroll");
  });

  it("never lets the counter go negative across an unmount-during-close", async () => {
    const { root, container } = render(<LockLayer locked={true} id="1" />);
    await flush();
    expect(overflow()).toBe("hidden");

    // unmount while locked — React runs the cleanup, decrementing to 0
    act(() => root.render(<></>));
    await flush();
    expect(overflow()).toBe("");

    // a SECOND unmount must not drive the count to -1 and break the next lock
    act(() => root.render(<></>));
    await flush();

    // the next layer must still be able to take the lock
    act(() => root.render(<LockLayer locked={true} id="2" />));
    await flush();
    expect(overflow()).toBe("hidden");

    act(() => root.render(<LockLayer locked={false} id="2" />));
    await flush();
    expect(overflow()).toBe("");
    expect(container).toBeTruthy();
  });

  it("counts three layers, releasing only when all three close", async () => {
    const { root } = render(
      <>
        <LockLayer locked={true} id="1" />
        <LockLayer locked={true} id="2" />
        <LockLayer locked={true} id="3" />
      </>
    );
    await flush();
    expect(overflow()).toBe("hidden");

    // close two of three
    act(() => root.render(
      <>
        <LockLayer locked={false} id="1" />
        <LockLayer locked={false} id="2" />
        <LockLayer locked={true} id="3" />
      </>
    ));
    await flush();
    expect(overflow()).toBe("hidden");

    act(() => root.render(
      <>
        <LockLayer locked={false} id="1" />
        <LockLayer locked={false} id="2" />
        <LockLayer locked={false} id="3" />
      </>
    ));
    await flush();
    expect(overflow()).toBe("");
  });
});

// ────────────────────────────────────────────────────────────────
// Static guard — the class of bug, not one instance. A component that
// writes body.style.overflow directly instead of taking the hook
// reintroduces the unlock-while-open bug.
// ────────────────────────────────────────────────────────────────

describe("no overlay component writes body.style.overflow directly", () => {
  /** Strip comments so prose ABOUT the forbidden pattern is not counted as the
   *  pattern. This is the inverse of a sealed defect (negative-regex-source-guard
   *  -defeated-by-comment): a POSITIVE guard tripped by its own documentation.
   *  Modal.js:28 carries the comment "Was an inline
   *  `document.body.style.overflow = …` effect" — accurate, useful, and not code.
   *  Naively it reads as a live writer.
   *
   *  Deliberately simple rather than a real JS parser: block comments, line
   *  comments, and the contents of single/double-quoted and template strings are
   *  removed in one pass. A string literal containing the pattern is not a write
   *  either, so removing string contents is correct here too. */
  function stripCommentsAndStrings(src) {
    return src.replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g,
      " "
    );
  }

  it("only the hook touches document.body.style.overflow in live code", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, relative } = await import("node:path");

    const HOOK = join(process.cwd(), "src", "shared", "hooks", "useScrollLock.js");
    const offenders = [];

    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(js|jsx)$/.test(entry)) continue;
        if (full === HOOK) continue; // the hook is the sanctioned owner
        const src = stripCommentsAndStrings(readFileSync(full, "utf8"));
        if (/body\.style\.overflow/.test(src)) {
          offenders.push(relative(process.cwd(), full));
        }
      }
    };

    walk(join(process.cwd(), "src"));
    // Modal.js, Drawer.js and NineRemotePromoModal.js were the three writers;
    // all three must be migrated or this fails.
    expect(offenders).toEqual([]);
  });

  it("the comment stripper still catches a REAL writer (guard against a guard that cannot fail)", async () => {
    // Proves stripCommentsAndStrings is not so aggressive that it hides live code.
    // Without this, the test above could pass forever even if it never saw
    // anything — the same class of defect as a mutation harness that fails to
    // restore, or a --check flag that was never implemented.
    const live = `
      import { useEffect } from "react";
      // a comment mentioning body.style.overflow
      export default function X() {
        useEffect(() => { document.body.style.overflow = "hidden"; });
      }`;
    expect(stripCommentsAndStrings(live)).toMatch(/body\.style\.overflow/);

    const commented = `
      // Was an inline \`document.body.style.overflow = "hidden"\` effect
      export default function X() { useScrollLock(isOpen); }`;
    expect(stripCommentsAndStrings(commented)).not.toMatch(/body\.style\.overflow/);

    const stringOnly = `const msg = "do not set body.style.overflow";`;
    expect(stripCommentsAndStrings(stringOnly)).not.toMatch(/body\.style\.overflow/);
  });
});
