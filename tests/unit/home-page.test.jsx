// @vitest-environment happy-dom
/**
 * Harbor Morning homepage — the greeting, the living sentence, the pulse,
 * the tiles, and the honest empty states. Rendered in happy-dom: every
 * number asserted is the live truth the mocked stream carries.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// The page rides this hook for its numbers — the mock IS the stream.
vi.mock("@/app/(dashboard)/dashboard/usage/hooks/useUsageStream", () => ({
  useUsageStream: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { useUsageStream } from "@/app/(dashboard)/dashboard/usage/hooks/useUsageStream";
import HomePageClient from "@/app/(dashboard)/dashboard/HomePageClient";

const BASE_STATS = {
  totalRequests: 1284,
  totalPromptTokens: 1_500_000,
  totalCompletionTokens: 600_000,
  totalCost: 3.42,
  totalCachedTokens: 400_000,
  activeRequests: [{ id: "a" }, { id: "b" }, { id: "c" }],
  last10Minutes: [
    { requests: 1 }, { requests: 3 }, { requests: 8 }, { requests: 5 }, { requests: 2 },
  ],
  recentRequests: [
    { id: "r1", model: "claude-sonnet-4", provider: "anthropic", promptTokens: 120, completionTokens: 80, costUsd: 0.004, timestamp: Date.now() - 5000 },
  ],
};

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}

const flush = async () => act(async () => {});

function mockStream(stats, loading = false) {
  useUsageStream.mockReturnValue({ stats, loading, fetching: false });
}

function mockEndpoints({ settings = null, version = "0.9.37", health = true } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/api/settings")) {
        return Promise.resolve({ ok: !!settings, json: async () => settings });
      }
      if (u.includes("/api/version")) {
        return Promise.resolve({ ok: true, json: async () => ({ version }) });
      }
      if (u.includes("/api/health")) {
        return Promise.resolve({ ok: health });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    })
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Harbor Morning masthead", () => {
  it("opens with the greeting, the date, and the version chip", async () => {
    mockStream(BASE_STATS);
    mockEndpoints();
    const { container } = render(<HomePageClient />);
    await flush();
    await flush();

    const h1 = container.querySelector("h1");
    expect(h1).toBeTruthy();
    expect(["Good morning.", "Good afternoon.", "Good evening."]).toContain(h1.textContent.trim());
    expect(container.textContent).toContain("v0.9.37");
    expect(container.textContent).toContain("Gateway live");
  });

  it("tells the day's story in one living sentence of live numbers", async () => {
    mockStream(BASE_STATS);
    mockEndpoints();
    const { container } = render(<HomePageClient />);
    await flush();
    await flush();

    const text = container.textContent;
    // The component speaks through Intl.NumberFormat — assert the same
    // tongue the environment renders (1,284 in en, 1.284 in id, etc.).
    expect(text).toContain(new Intl.NumberFormat().format(1284)); // requests
    expect(text).toContain("2.1M");    // tokens, compacted
    expect(text).toContain("$3.42");   // spend, honest money
    expect(text).toContain("3 live now");
  });

  it("speaks honestly when no traffic has moved", async () => {
    mockStream({ ...BASE_STATS, totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0, activeRequests: [], last10Minutes: [], recentRequests: [] });
    mockEndpoints();
    const { container } = render(<HomePageClient />);
    await flush();
    await flush();

    expect(container.textContent).toContain("quiet");
  });
});

describe("The Pulse — the focal point", () => {
  it("renders the live chart when traffic rides the stream", async () => {
    mockStream(BASE_STATS);
    mockEndpoints();
    const { container } = render(<HomePageClient />);
    await flush();
    await flush();

    expect(container.textContent).toContain("The Pulse");
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg.querySelector("path[stroke]")).toBeTruthy();
    // the 10-minute total rides the chart header
    expect(container.textContent).toContain("19");
  });

  it("shows still water when the last 10 minutes are empty", async () => {
    mockStream({ ...BASE_STATS, last10Minutes: [] });
    mockEndpoints();
    const { container } = render(<HomePageClient />);
    await flush();
    await flush();

    expect(container.textContent).toContain("The water is still.");
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("The accounting tiles and the watch below", () => {
  it("carries four tiles of live truth", async () => {
    mockStream(BASE_STATS);
    mockEndpoints();
    const { container } = render(<HomePageClient />);
    await flush();
    await flush();

    const text = container.textContent;
    expect(text).toContain("Requests");
    expect(text).toContain("Tokens");
    expect(text).toContain("Spend");
    expect(text).toContain("Cache rate");
    // cache rate: 400k / (2.1M + 400k) ≈ 16%
    expect(text).toContain("16%");
  });

  it("streams recent activity and fleet health", async () => {
    mockStream(BASE_STATS);
    mockEndpoints({
      settings: {
        providerStatuses: [
          { name: "anthropic", status: "ok", latencyMs: 42 },
          { name: "openai", status: "degraded", latencyMs: 900 },
        ],
      },
    });
    const { container } = render(<HomePageClient />);
    await flush();
    await flush();

    const text = container.textContent;
    expect(text).toContain("claude-sonnet-4");
    expect(text).toContain("anthropic");
    expect(text).toContain("openai");
    expect(text).toContain("1/2 providers ok");
  });

  it("offers a path home when no providers are configured", async () => {
    mockStream(BASE_STATS);
    mockEndpoints({ settings: { providerStatuses: [] } });
    const { container } = render(<HomePageClient />);
    await flush();
    await flush();

    expect(container.textContent).toContain("Connect a provider");
  });
});
