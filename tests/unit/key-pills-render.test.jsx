// @vitest-environment happy-dom
/**
 * The key fleet's smallest marks — the pills that the card lens, the table lens
 * and the detail drawer all compose (v0.9.90).
 *
 * WHY THIS SUITE EXISTS: v0.9.89 renamed the reserved `key` prop to `k` across
 * ScopePill and LimitPills, and finished that job in the signatures while
 * leaving one body reference to the old name. Every instrument the house had
 * was green — `npm run build` compiled, and the whole suite passed — because a
 * bare `key` identifier inside a component body is a RUNTIME ReferenceError,
 * not a compile error, and no test had ever rendered these components. Only a
 * real browser walking the real room saw it:
 *   `Runtime ReferenceError: key is not defined` at KeyBits.js:61 in ScopePill.
 * That is the second time this release line shipped a defect of exactly this
 * shape (a named import the bundler tolerated; a name React reserved), and both
 * times the room, not the build, was the instrument that saw it.
 *
 * So this suite renders the pills the way the room does and asserts the words
 * an operator actually reads. It is deliberately narrow: it guards the seam,
 * not the styling, the ordering, or the room.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// The room runs these through the i18n runtime; the assertions below read the
// English source strings, so the identity translation is the honest stand-in.
vi.mock("@/i18n/runtime", () => ({ translate: (s) => s }));

import {
  ScopePill,
  LimitPills,
} from "@/app/(dashboard)/dashboard/endpoint/components/keys/KeyBits";

const mounted = [];

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  const entry = { container, root };
  mounted.push(entry);
  return entry;
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("ScopePill", () => {
  it("counts the models a scoped key can reach", () => {
    const { container } = render(
      <ScopePill k={{ allowedModels: ["claude-sonnet-4-5", "gpt-5-codex", "glm-5.3-flash"] }} />,
    );
    expect(container.textContent).toContain("3");
    expect(container.textContent).toContain("models");
  });

  it("speaks in the singular for a one-model scope", () => {
    const { container } = render(<ScopePill k={{ allowedModels: ["glm-5.3-flash"] }} />);
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("model");
    expect(container.textContent).not.toContain("models");
  });

  it("names the scope in the pill's tooltip", () => {
    const { container } = render(
      <ScopePill k={{ allowedModels: ["claude-sonnet-4-5", "gpt-5-codex"] }} />,
    );
    const titled = container.querySelector("[title]");
    expect(titled?.getAttribute("title")).toBe("claude-sonnet-4-5, gpt-5-codex");
  });

  it("reports an absent scope as reaching everything, not as zero models", () => {
    const { container } = render(<ScopePill k={{ allowedModels: null }} />);
    expect(container.textContent).toContain("All models");
  });
});

describe("LimitPills", () => {
  it("renders one badge per ceiling the operator actually set", () => {
    const { container } = render(
      <LimitPills
        k={{ rateLimitRpm: 60, tokenBudgetDaily: 100000, spendCapDailyCents: 500 }}
      />,
    );
    const text = container.textContent;
    expect(text).toContain("60 RPM");
    expect(text).toContain("100K tok");
    expect(text).toContain("$5");
  });

  it("renders nothing when no ceiling is set", () => {
    const { container } = render(
      <LimitPills
        k={{
          rateLimitRpm: null,
          tokenBudgetDaily: null,
          spendCapDailyCents: null,
          ipAllowlist: null,
        }}
      />,
    );
    expect(container.textContent).toBe("");
  });
});
