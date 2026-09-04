// @vitest-environment happy-dom
/**
 * Six call sites passed `open=` to components that accept only `isOpen` and
 * early-return `null` on `!isOpen` (Modal.js:44, forwarded by ConfirmModal:128).
 * Four modals and two delete-confirmations could therefore NEVER render — and
 * the same two files selected `s.notify` from the notification store, a key that
 * does not exist, so every notify({...}) call would have thrown TypeError.
 *
 * Both defects are in fallback-rules/page.js and prompt-injectors/page.js.
 *
 * THE PRODUCER-COVERAGE LAW (v0.9.46): a test that renders <Modal isOpen={true}>
 * proves the component and nothing about the call site — which is exactly how
 * this survived. So every assertion below mounts the REAL page and clicks the
 * REAL button. Nothing here sets component state directly.
 *
 * Mutation-proven red: reverting any one `isOpen=` back to `open=` fails the
 * matching case; reverting `s.addNotification` to `s.notify` fails the two
 * confirm-and-notify cases.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

import FallbackRulesPage from "@/app/(dashboard)/dashboard/fallback-rules/page";
import PromptInjectorsPage from "@/app/(dashboard)/dashboard/prompt-injectors/page";
import { useNotificationStore } from "@/store/notificationStore";

// `/api/fallback-rules` returns a BARE ARRAY (the page does setRules(await res.json())),
// not a wrapped object. Fields are only those the row render actually reads.
const RULE = {
  id: "rule-1",
  sourceModel: "anthropic/claude-opus-4-1",
  targetModels: ["openai/gpt-5", "deepseek/deepseek-v4-flash"],
  triggerType: "contextWindow",
  conditionVal: "180000",
  priority: 100,
  isActive: 1,
};

// `/api/settings` → { userInjectors: [...] }; the page guards with Array.isArray.
const INJECTOR = {
  name: "Indonesian voice",
  prompt: "Always respond in Indonesian.",
  position: "append",
  applyTo: "llm",
  enabled: true,
  variables: {},
};

function mockApi({ deleteOk = true } = {}) {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url, opts = {}) => {
      const u = String(url);
      const method = opts.method || "GET";
      calls.push({ url: u, method });

      if (u.includes("/api/fallback-rules/") && method === "DELETE") {
        return Promise.resolve({ ok: deleteOk, json: async () => ({}) });
      }
      if (u.includes("/api/fallback-rules")) {
        return Promise.resolve({ ok: true, json: async () => [RULE] });
      }
      if (u.includes("/api/settings")) {
        return Promise.resolve({ ok: true, json: async () => ({ userInjectors: [INJECTOR] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    })
  );
  return calls;
}

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}

const flush = async () => act(async () => {});

/** Find a button by its exact trimmed label. Material Symbols ligatures would
 *  corrupt an exact match, so callers pass labels that carry no icon. */
function buttonByText(container, label) {
  return [...container.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === label
  );
}

/** The open modal's title, or null when no modal is mounted.
 *
 *  This is the collision-proof signal, and the reason it exists is a bug in my
 *  first draft: the prompt-injectors toolbar button is labelled "Add Injector"
 *  and the modal it opens is TITLED "Add Injector", so a textContent assertion
 *  could not tell them apart and my negative precondition failed on a page that
 *  was working correctly.
 *
 *  Modal renders its title as <h2> (Modal.js:87); Card renders <h3>
 *  (Card.js:48); neither page has an <h2> of its own (verified: grep -c "<h2"
 *  returns 0 for both). So h2 presence IS modal presence, and its text is the
 *  title — independent of every button label on the page. */
function modalTitle(container) {
  const h2 = container.querySelector("h2");
  return h2 ? h2.textContent.trim() : null;
}

/** The notifications the real zustand store has received this test. Reading the
 *  store is the proof that `notify` resolved to a real function. */
function toasts() {
  return useNotificationStore.getState().notifications;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  // clearAll leaves any pending auto-dismiss timer harmless: it filters an
  // already-empty array when it eventually fires.
  useNotificationStore.getState().clearAll();
});

// ────────────────────────────────────────────────────────────────
// fallback-rules — three of the six sites
// ────────────────────────────────────────────────────────────────

describe("fallback-rules — the modals open on a real button click", () => {
  it("opens the Add/Edit Fallback Rule modal from the Add Rule button", async () => {
    mockApi();
    const { container } = render(<FallbackRulesPage />);
    await flush(); await flush(); await flush();

    // the fixture rule must have rendered, so we know we are past loading
    expect(container.textContent).toContain("anthropic/claude-opus-4-1");
    expect(modalTitle(container)).toBeNull();

    act(() => buttonByText(container, "Add Rule").click());
    await flush();

    // pre-fix this stayed null forever: open={showFormModal} left isOpen undefined
    expect(modalTitle(container)).toBe("Add Fallback Rule");
    expect(container.textContent).toContain("Source model");
  });

  it("opens the Test-rule modal from the row's Test button", async () => {
    mockApi();
    const { container } = render(<FallbackRulesPage />);
    await flush(); await flush(); await flush();

    act(() => buttonByText(container, "Test").click());
    await flush();

    // Asserted WITHOUT the em dash on purpose: the title is `Test rule — <model>`,
    // and that dash is an R-02 Hard Gate violation Stage 2 will fix. Pinning it
    // would make this test fail on a change unrelated to what it guards.
    expect(modalTitle(container)).toMatch(/^Test rule/);
    expect(container.textContent).toContain("anthropic/claude-opus-4-1");
    expect(container.textContent).toContain("HTTP status");
  });

  it("opens the delete confirmation — the ConfirmModal site the first sweep missed", async () => {
    mockApi();
    const { container } = render(<FallbackRulesPage />);
    await flush(); await flush(); await flush();

    expect(modalTitle(container)).toBeNull();

    act(() => buttonByText(container, "Delete").click());
    await flush();

    expect(modalTitle(container)).toBe("Delete fallback rule");
    // proves the RIGHT row was passed, not merely that a modal appeared
    expect(container.textContent).toContain("anthropic/claude-opus-4-1");
    expect(buttonByText(container, "Confirm")).toBeTruthy();
    expect(buttonByText(container, "Cancel")).toBeTruthy();
  });

  it("confirms the delete: DELETE fires AND the success toast lands (the notify fix)", async () => {
    const calls = mockApi();
    const { container } = render(<FallbackRulesPage />);
    await flush(); await flush(); await flush();

    act(() => buttonByText(container, "Delete").click());
    await flush();
    await act(async () => buttonByText(container, "Confirm").click());
    await flush(); await flush();

    expect(calls).toContainEqual({
      url: "/api/fallback-rules/rule-1",
      method: "DELETE",
    });

    // THE COUPLED ASSERTION. The success toast is pushed by notify({...}) AFTER
    // the DELETE resolves. With the old `s.notify` selector notify was undefined,
    // so this line threw TypeError, fell into the catch, and threw again — no
    // success toast could ever exist. A green assertion here proves both fixes.
    const success = toasts().filter((t) => t.type === "success");
    expect(success).toHaveLength(1);
    expect(success[0].message).toBe("Rule deleted");
    expect(toasts().filter((t) => t.type === "error")).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────
// prompt-injectors — the other three sites
// ────────────────────────────────────────────────────────────────

describe("prompt-injectors — the modals open on a real button click", () => {
  it("opens the Add/Edit Injector modal from the Add Injector button", async () => {
    mockApi();
    const { container } = render(<PromptInjectorsPage />);
    await flush(); await flush(); await flush();

    expect(container.textContent).toContain("Indonesian voice");
    // The toolbar button is ALSO labelled "Add Injector" — which is why this
    // asserts on modalTitle (h2 presence) and never on textContent. textContent
    // contains "Add Injector" from the button alone, modal open or shut.
    expect(modalTitle(container)).toBeNull();

    act(() => buttonByText(container, "Add Injector").click());
    await flush();

    expect(modalTitle(container)).toBe("Add Injector");
    expect(container.textContent).toContain("Prompt");
  });

  it("opens the Injector presets modal from the Presets button", async () => {
    mockApi();
    const { container } = render(<PromptInjectorsPage />);
    await flush(); await flush(); await flush();

    expect(modalTitle(container)).toBeNull();

    act(() => buttonByText(container, "Presets").click());
    await flush();

    expect(modalTitle(container)).toBe("Injector presets");
  });

  it("opens the delete confirmation — the second ConfirmModal site the sweep missed", async () => {
    mockApi();
    const { container } = render(<PromptInjectorsPage />);
    await flush(); await flush(); await flush();

    expect(modalTitle(container)).toBeNull();

    act(() => buttonByText(container, "Delete").click());
    await flush();

    expect(modalTitle(container)).toBe("Delete injector");
    expect(container.textContent).toContain("Indonesian voice");
    expect(buttonByText(container, "Confirm")).toBeTruthy();
  });

  it("confirms the delete: PATCH fires AND the success toast lands (the notify fix)", async () => {
    const calls = mockApi();
    const { container } = render(<PromptInjectorsPage />);
    await flush(); await flush(); await flush();

    act(() => buttonByText(container, "Delete").click());
    await flush();
    await act(async () => buttonByText(container, "Confirm").click());
    await flush(); await flush();

    // persist() PATCHes the whole remaining list back to /api/settings.
    // Asserted exactly, not as "method !== GET" — a loose matcher would pass on
    // a POST/PUT rewrite and hide a regression in the verb itself.
    expect(calls).toContainEqual({ url: "/api/settings", method: "PATCH" });

    const success = toasts().filter((t) => t.type === "success");
    expect(success).toHaveLength(1);
    expect(success[0].message).toBe("Injector deleted");
    expect(toasts().filter((t) => t.type === "error")).toHaveLength(0);
  });

  it("paints at all — the {{model}} JSX-text ReferenceError guard", async () => {
    // A THIRD defect, found by this test rather than by the sweep: line 203 read
    // ({{model}}, {{date}}…) as JSX TEXT. In JSX text, {{model}} is an expression
    // container holding the object shorthand {model}, which dereferences an
    // undefined identifier — so the component threw ReferenceError on EVERY
    // render and the page could not paint a single pixel. That also means the two
    // `open=` bugs on this page were unreachable in practice: you cannot click a
    // button on a page that never rendered.
    //
    // This is why the fix order mattered. Correcting `open=` alone would have
    // left this page equally dead.
    mockApi();
    const { container } = render(<PromptInjectorsPage />);
    await flush(); await flush(); await flush();

    // The literal must reach the DOM as TEXT, not be parsed as an expression.
    expect(container.textContent).toContain("{{model}}");
    expect(container.textContent).toContain("{{date}}");
    // And the page must actually have painted its own content.
    expect(container.textContent).toContain("Prompt Injectors");
    expect(container.textContent).toContain("Indonesian voice");
  });
});

// ────────────────────────────────────────────────────────────────
// The static guard — cheap, and it catches the regression class even
// if the mount tests above are ever skipped or refactored away.
// ────────────────────────────────────────────────────────────────

describe("no page passes `open=` to Modal or ConfirmModal", () => {
  it("every Modal/ConfirmModal in src/ uses isOpen, never open", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, relative } = await import("node:path");

    const ROOT = join(process.cwd(), "src");
    const offenders = [];

    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(js|jsx)$/.test(entry)) continue;
        const src = readFileSync(full, "utf8");
        if (!/<(Modal|ConfirmModal)[\s>]/.test(src)) continue;
        // A JSX attribute `open=` immediately inside a Modal/ConfirmModal tag.
        // Deliberately narrow: Sidebar.js:252 passes `open=` to MediaAccordion,
        // whose own signature takes `open` — counting that would be a false
        // positive. The rule is which component owns the prop, not the prop name.
        const tagRe = /<(Modal|ConfirmModal)(\s[^>]*?)?>/g;
        let m;
        while ((m = tagRe.exec(src)) !== null) {
          const attrs = m[2] || "";
          if (/(^|\s)open=/.test(attrs)) {
            offenders.push(`${relative(process.cwd(), full)} → <${m[1]} open=`);
          }
        }
      }
    };

    walk(ROOT);
    expect(offenders).toEqual([]);
  });
});
