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
  UsageStrip,
} from "@/app/(dashboard)/dashboard/endpoint/components/keys/KeyBits";
import { tokenBudgetFill } from "@/app/(dashboard)/dashboard/endpoint/lib/keyFormat";

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

// ── the quota meter ─────────────────────────────────────────────────────────
// Wave-1 evidence: the strip rendered raw counts and never divided by
// tokenBudgetDaily. The meter is only honest when the usage shown was summed
// over the budget's own window (keyGate's spendStage sums over budgetScope;
// the strip shows usagePeriod) — so the law is tested both ways: it appears
// when the windows match, and today's strip returns unchanged when they do not.

const usage = { requests: 12, promptTokens: 30000, completionTokens: 20000, totalTokens: 50000, cost: 0.25 };

describe("tokenBudgetFill", () => {
  it("divides totalTokens by the budget when the period is the budget's scope", () => {
    expect(tokenBudgetFill({ usage, tokenBudgetDaily: 100000, budgetScope: "daily", period: "24h" })).toBe(0.5);
  });

  it("reads an absent scope as the app's own default, daily", () => {
    expect(tokenBudgetFill({ usage, tokenBudgetDaily: 200000, period: "24h" })).toBe(0.25);
    expect(tokenBudgetFill({ usage, tokenBudgetDaily: 200000, budgetScope: "", period: "24h" })).toBe(0.25);
    expect(tokenBudgetFill({ usage, tokenBudgetDaily: 200000, budgetScope: null, period: "24h" })).toBe(0.25);
  });

  it("is null without a budget, without usage, or for an unknown scope", () => {
    const daily = { usage, budgetScope: "daily", period: "24h" };
    expect(tokenBudgetFill({ ...daily, tokenBudgetDaily: null })).toBeNull();
    expect(tokenBudgetFill({ ...daily, tokenBudgetDaily: 0 })).toBeNull();
    expect(tokenBudgetFill({ ...daily, tokenBudgetDaily: 100000, usage: null })).toBeNull();
    // An unknown scope is not assumed to be daily — the meter stays silent.
    expect(tokenBudgetFill({ ...daily, tokenBudgetDaily: 100000, budgetScope: "fortnightly" })).toBeNull();
  });

  it("never divides across a window the gate did not sum", () => {
    const daily = { usage, tokenBudgetDaily: 100000, budgetScope: "daily" };
    // Every picker period other than 24h is a different span from a day.
    for (const period of ["7d", "30d", "60d", "all", undefined]) {
      expect(tokenBudgetFill({ ...daily, period })).toBeNull();
    }
    // And a calendar scope past a day is a longer window than any picker shows.
    for (const budgetScope of ["weekly", "monthly", "yearly"]) {
      expect(tokenBudgetFill({ ...daily, budgetScope, period: "24h" })).toBeNull();
      expect(tokenBudgetFill({ ...daily, budgetScope, period: "7d" })).toBeNull();
    }
  });

  it("clamps a key past its budget to a full bar", () => {
    expect(tokenBudgetFill({ usage: { totalTokens: 300000 }, tokenBudgetDaily: 100000, period: "24h" })).toBe(1);
  });

  it("returns a real zero when usage was observed and nothing was used", () => {
    expect(tokenBudgetFill({ usage: { totalTokens: 0 }, tokenBudgetDaily: 100000, period: "24h" })).toBe(0);
  });
});

describe("UsageStrip — the quota meter", () => {
  const meter = (c) => c.querySelector('[role="progressbar"]');

  it("renders the percentage and keeps the raw counts beside it", () => {
    const { container } = render(
      <UsageStrip usage={usage} k={{ tokenBudgetDaily: 100000, budgetScope: "daily" }} period="24h" />,
    );
    const bar = meter(container);
    expect(bar).not.toBeNull();
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect(bar.firstElementChild.style.width).toBe("50%");
    expect(container.textContent).toContain("50% of budget");
    expect(container.textContent).toContain("50K / 100K");
    // The counts the strip always carried are still there.
    expect(container.textContent).toContain("12");
    expect(container.textContent).toContain("30K in");
    expect(container.textContent).toContain("$0.25");
  });

  it("suppresses the bar at 0% (zero-suppression law)", () => {
    const { container } = render(
      <UsageStrip
        usage={{ ...usage, totalTokens: 0 }}
        k={{ tokenBudgetDaily: 100000, budgetScope: "daily" }}
        period="24h"
      />,
    );
    expect(meter(container)).toBeNull();
    expect(container.textContent).not.toContain("of budget");
  });

  it("renders exactly today's strip without a budget, without a period, or over another window", () => {
    const baseline = render(<UsageStrip usage={usage} />).container.innerHTML;
    for (const el of [
      <UsageStrip usage={usage} k={{ tokenBudgetDaily: null }} period="24h" />,
      <UsageStrip usage={usage} k={{ tokenBudgetDaily: 100000, budgetScope: "daily" }} />,
      <UsageStrip usage={usage} k={{ tokenBudgetDaily: 100000, budgetScope: "daily" }} period="7d" />,
      <UsageStrip usage={usage} k={{ tokenBudgetDaily: 100000, budgetScope: "daily" }} period="all" />,
      <UsageStrip usage={usage} k={{ tokenBudgetDaily: 100000, budgetScope: "weekly" }} period="7d" />,
    ]) {
      // Guard the guard: a non-empty baseline, or identity is proven on "".
      expect(baseline).toContain("50K total");
      expect(render(el).container.innerHTML).toBe(baseline);
    }
    // An absent scope beside 24h DOES draw (absent scope reads as daily).
    const shown = render(<UsageStrip usage={usage} k={{ tokenBudgetDaily: 100000 }} period="24h" />);
    expect(shown.container.querySelector('[role="progressbar"]')).not.toBeNull();
  });
});
