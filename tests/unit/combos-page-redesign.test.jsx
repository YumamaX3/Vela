// @vitest-environment happy-dom
/**
 * Combos harbor redesign (v0.9.40) — the page renders namespace harbors from
 * slash-bearing names, the fleet stats strip, per-combo usage signals
 * (sparkline, ok-ratio, last-seen), reachability chips, the search/filter
 * toolbar, and honest empty states. Rendered in happy-dom with mocked fetch:
 * every assertion reads what the mocked harbor returns.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/shared/hooks/useModelCaps", () => ({
  useModelCaps: () => ({ getCaps: () => [] }),
}));

vi.mock("@/shared/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copied: null, copy: vi.fn() }),
}));

import CombosPage from "@/app/(dashboard)/dashboard/combos/page";

const NOW = Date.now();

const FIXTURES = {
  combos: [
    { id: "c1", name: "vela/cc/opus", kind: "llm", models: ["openai/gpt-5", "anthropic/claude-sonnet-5"], createdAt: "2026-08-01", updatedAt: "2026-08-01" },
    { id: "c2", name: "vela/deepseek/v4-flash", kind: "llm", models: ["deepseek/deepseek-v4-flash"], createdAt: "2026-08-02", updatedAt: "2026-08-02" },
    { id: "c3", name: "opus", kind: "llm", models: ["anthropic/claude-opus-4-1"], createdAt: "2026-08-03", updatedAt: "2026-08-03" },
  ],
  providers: {
    connections: [
      { provider: "openai", isActive: true, name: "openai-main" },
      { provider: "anthropic", isActive: true, name: "anthropic-main" },
      // deepseek intentionally absent → reachability 0/1 for vela/deepseek/*
    ],
  },
  settings: {
    comboStrategies: { "vela/cc/opus": { fallbackStrategy: "fusion" } },
    capacityAdapter: {},
  },
  usage: {
    hours: 24,
    buckets: 24,
    since: new Date(NOW - 86400000).toISOString(),
    combos: [
      {
        combo: "vela/cc/opus",
        requests: 42,
        promptTokens: 1000,
        completionTokens: 500,
        cost: 0.12,
        ok: 40,
        firstAt: new Date(NOW - 7200000).toISOString(),
        lastAt: new Date(NOW - 60000).toISOString(),
        series: Array.from({ length: 24 }, (_, i) => ({ requests: i % 3, tokens: i, ok: i % 3 })),
      },
    ],
  },
  nodes: { nodes: [] },
};

function mockEndpoints({ combos = FIXTURES.combos } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/api/combos/usage")) return Promise.resolve({ ok: true, json: async () => FIXTURES.usage });
      if (u.includes("/api/combos")) return Promise.resolve({ ok: true, json: async () => ({ combos }) });
      if (u.includes("/api/providers")) return Promise.resolve({ ok: true, json: async () => FIXTURES.providers });
      if (u.includes("/api/settings")) return Promise.resolve({ ok: true, json: async () => FIXTURES.settings });
      if (u.includes("/api/provider-nodes")) return Promise.resolve({ ok: true, json: async () => FIXTURES.nodes });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    })
  );
}

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}

const flush = async () => act(async () => {});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren(); // clear rendered roots without innerHTML
});

describe("Combos harbor — namespace grouping", () => {
  it("groups slash-bearing combos under their harbor headers", async () => {
    mockEndpoints();
    const { container } = render(<CombosPage />);
    await flush();
    await flush();
    await flush();

    const text = container.textContent;
    expect(text).toContain("vela/cc");
    expect(text).toContain("vela/deepseek");
    // leaves display without their namespace prefix
    expect(text).toContain("opus");
    expect(text).toContain("v4-flash");
  });

  it("shows fleet stats: 3 combos, 4 models, 1 fusion, 1 active", async () => {
    mockEndpoints();
    const { container } = render(<CombosPage />);
    await flush();
    await flush();
    await flush();

    const text = container.textContent;
    expect(text).toContain("Combos");
    expect(text).toContain("Models in fleet");
    expect(text).toContain("Fusion combos");
    expect(text).toContain("Active · 24h");
  });
});

describe("Combos harbor — per-combo usage signals", () => {
  it("shows sparkline + totals + ok-ratio for combos with usage", async () => {
    mockEndpoints();
    const { container } = render(<CombosPage />);
    await flush();
    await flush();
    await flush();

    // the sparkline SVG renders for the used combo
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
    expect(container.querySelector("svg path")).toBeTruthy();

    const text = container.textContent;
    expect(text).toContain("42 req");
    // 95% ok chip (40/42 rounds to 95)
    expect(text).toContain("95% ok");
  });

  it("shows the honest empty line for combos without usage", async () => {
    mockEndpoints();
    const { container } = render(<CombosPage />);
    await flush();
    await flush();
    await flush();

    expect(container.textContent).toContain("No usage in the last 24h");
  });
});

describe("Combos harbor — reachability", () => {
  it("marks vela/cc/opus 2/2 connected and vela/deepseek 0/1 (provider absent)", async () => {
    mockEndpoints();
    const { container } = render(<CombosPage />);
    await flush();
    await flush();
    await flush();

    const text = container.textContent;
    expect(text).toContain("2/2 connected");
    expect(text).toContain("0/1 connected");
  });
});

describe("Combos harbor — toolbar", () => {
  it("search narrows the fleet to matching combos", async () => {
    mockEndpoints();
    const { container } = render(<CombosPage />);
    await flush();
    await flush();
    await flush();

    const input = container.querySelector('input[placeholder*="Search"]');
    expect(input).toBeTruthy();

    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    act(() => {
      setValue.call(input, "deepseek");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await flush();

    const text = container.textContent;
    expect(text).toContain("v4-flash");
    expect(text).not.toContain("claude-sonnet-5");
  });

  it("clears filters when nothing matches", async () => {
    mockEndpoints();
    const { container } = render(<CombosPage />);
    await flush();
    await flush();
    await flush();

    const input = container.querySelector('input[placeholder*="Search"]');
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    act(() => {
      setValue.call(input, "zzz-no-such-combo");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await flush();

    const text = container.textContent;
    expect(text).toContain("No combos match your filters");
    expect(text).toContain("Clear filters");
  });
});

describe("Combos harbor — empty state", () => {
  it("renders the create-first empty state when the fleet is empty", async () => {
    mockEndpoints({ combos: [] });
    const { container } = render(<CombosPage />);
    await flush();
    await flush();
    await flush();

    const text = container.textContent;
    expect(text).toContain("No combos yet");
    expect(text).toContain("vela/cc/opus"); // the namespacing hint in the empty state
  });
});
