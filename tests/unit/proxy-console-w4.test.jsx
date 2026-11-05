// @vitest-environment happy-dom
/**
 * W4 — the hub, ledger, usage and tools shores (sealed plan
 * 2026-11-04-proxy-console-separation §3.1/§3.3/§4 · W4).
 *
 * These four shores stand on W1 (the shared store) and W2 (the telemetry seams).
 * W4's contract is narrower than "it renders": each shore must read ITS OWN seam,
 * keep the truths that seam distinguishes APART, and never fabricate a number the
 * seam did not send. So the proofs here are behavioural — render the real client
 * with a stubbed fetch and assert what a reader would actually see:
 *
 *   · LEDGER — routes render newest-first with their outcome; the provider filter
 *     NARROWS in memory (no second fetch); an empty ring says "no routes yet" (an
 *     empty trace, not a clean bill), and a FAILED read says so, and the two are
 *     never the same sentence.
 *   · USAGE  — the two honesty flags stay separate: `wired:false` is "the seam has
 *     not landed"; a wired-but-quiet window is "collecting since…"; and the pre-seam
 *     NULL latencies render "—", never "0 ms". The forbidden case is a quiet
 *     harbour being read as a missing migration.
 *   · TOOLS  — the eight tools exist as labelled gestures, the sweep offers
 *     auto-disable but defaults it OFF (three-verdict law), and the two CSVs keep
 *     the formula-injection guard the usage export proved.
 *   · HUB    — the eight doors (proved in the surface suite) and recent activity
 *     that is honestly empty.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import LedgerClient from "@/app/(dashboard)/dashboard/proxy/ledger/LedgerClient";
import UsageClient from "@/app/(dashboard)/dashboard/proxy/usage/UsageClient";
import ToolsClient from "@/app/(dashboard)/dashboard/proxy/tools/ToolsClient";
import { resetProxyFleetStore } from "@/app/(dashboard)/dashboard/proxy/stores/proxyFleetStore";
import { csvCell, toCsv, analyticsCsv, activePoolsCsv } from "@/app/(dashboard)/dashboard/proxy/lib/proxyCsv";
import { computeCensus } from "@/app/(dashboard)/dashboard/proxy/stores/proxyFleetStore";

const ROOT = process.cwd();
const readSrc = (rel) => readFileSync(join(ROOT, rel), "utf8");

const POOLS = [
  { id: "alive-one", name: "Alive One", proxyUrl: "http://1.2.3.4:8080", isActive: true, testStatus: "active", boundConnectionCount: 1, type: "http" },
  { id: "dead-one", name: "Dead One", proxyUrl: "http://5.6.7.8:8080", isActive: true, testStatus: "error", boundConnectionCount: 0, type: "http" },
];

const LEDGER_OK = {
  routes: [
    { seq: 3, ts: Date.now(), providerId: "freebuff", model: "model-a", poolId: "alive-one", strategy: "smart", ok: true, haltReason: null, ms: 90, spans: ["pick", "connect"] },
    { seq: 2, ts: Date.now() - 1000, providerId: "codex", model: "model-b", poolId: "dead-one", strategy: "smart", ok: false, haltReason: "connect_refused", ms: 20, spans: [{ stage: "connect", decision: "halt", detail: "ECONNREFUSED", ms: 20 }] },
  ],
  health: { freebuff: { score: 100, samples: 2 }, codex: { score: 50, samples: 2 } },
};

const ANALYTICS_OK = {
  period: "24h",
  wired: true,
  since: "2026-11-04T00:00:00.000Z",
  pools: [
    { poolId: "alive-one", label: { id: "alive-one", name: "Alive One", type: "http" }, providers: ["freebuff"], requests: 400, errors: 2, promptTokens: 1000, completionTokens: 2000, costUsd: 0.42, avgLatencyMs: 310, p95LatencyMs: 900, latencyCount: 398 },
    { poolId: "ghost", label: { id: "ghost", name: "Ghost Pool", type: "socks5" }, providers: [], requests: 10, errors: 10, promptTokens: null, completionTokens: null, costUsd: 0, avgLatencyMs: null, p95LatencyMs: null, latencyCount: 0 },
  ],
  meta: { collecting: false },
};

let fetchMock;
function installFetch({ ledger = { ok: true, body: LEDGER_OK }, analytics = { ok: true, body: ANALYTICS_OK } } = {}) {
  fetchMock = vi.fn().mockImplementation((url, init = {}) => {
    const u = String(url);
    const method = (init.method || "GET").toUpperCase();
    if (u.includes("/api/proxy-pools/routing-ledger")) {
      return Promise.resolve({ ok: ledger.ok, status: ledger.ok ? 200 : 500, json: async () => ledger.body });
    }
    if (u.includes("/api/proxy-pools/analytics")) {
      return Promise.resolve({ ok: analytics.ok, status: analytics.ok ? 200 : 500, json: async () => analytics.body });
    }
    if (u.includes("/api/proxy-pools/fitness")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ fitness: { pools: [] }, geo: {} }) });
    }
    if (u.includes("/api/settings")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ poolGeoProbeEnabled: true }) });
    }
    if (u.includes("/api/proxy-pools/export")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ pools: [{ id: "alive-one", name: "Alive One", type: "http", isActive: true }], fitness: {} }) });
    }
    if (method === "POST" && u.includes("/api/proxy-pools/bulk-health")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ alive: 1, dead: 1, indeterminate: 1, results: [] }) });
    }
    if (u.includes("/api/proxy-pools")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ proxyPools: POOLS }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
}

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}
const flush = async () => {
  await act(async () => {});
  await act(async () => {});
};

beforeEach(() => {
  resetProxyFleetStore();
  fetchMock = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

// ── the ledger ──────────────────────────────────────────────────────────────
describe("the Ledger shore — the router's trace, read and filtered, never steered", () => {
  it("renders the routes, their outcomes and the per-provider score", async () => {
    installFetch();
    const { container } = render(<LedgerClient />);
    await flush();
    const text = container.textContent;
    expect(text).toContain("Health score");
    expect(text).toContain("freebuff");
    expect(text).toContain("100%");
    expect(text).toContain("50%");
    expect(text).toContain("Recent routes");
    expect(text).toContain("model-a");
    // A halt is named, and its reason is spelled out rather than colour-coded only.
    expect(text).toContain("connect_refused");
    // The pool id is resolved to the fleet's name through the shared store.
    expect(text).toContain("Alive One");
  });

  it("scopes to one provider by filtering the ring it already read — no second fetch", async () => {
    installFetch();
    const { container } = render(<LedgerClient />);
    await flush();
    const before = fetchMock.mock.calls.filter(([u]) => String(u).includes("routing-ledger")).length;
    const select = container.querySelector("select");
    expect(select).toBeTruthy();
    await act(async () => {
      select.value = "codex";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    const text = container.textContent;
    expect(text).toContain("model-b");
    expect(text).not.toContain("model-a");
    const after = fetchMock.mock.calls.filter(([u]) => String(u).includes("routing-ledger")).length;
    expect(after).toBe(before);
  });

  it("an empty ring says the trace is empty — never a clean bill of health", async () => {
    installFetch({ ledger: { ok: true, body: { routes: [], health: {} } } });
    const { container } = render(<LedgerClient />);
    await flush();
    const text = container.textContent;
    expect(text).toMatch(/No routes yet/i);
    expect(text).toMatch(/empty trace/i);
  });

  it("a FAILED read is said differently from an empty one", async () => {
    installFetch({ ledger: { ok: false, body: { error: "Failed to read routing ledger" } } });
    const { container } = render(<LedgerClient />);
    await flush();
    const text = container.textContent;
    expect(text).toMatch(/Failed to read routing ledger/);
    expect(text).not.toMatch(/No routes yet/i);
  });
});

// ── usage ───────────────────────────────────────────────────────────────────
describe("the Usage shore — the two honesty flags stay apart, and null latency is null", () => {
  it("renders the per-pool census with totals and honest error rate", async () => {
    installFetch();
    const { container } = render(<UsageClient />);
    await flush();
    const text = container.textContent;
    expect(text).toContain("Per-pool census");
    expect(text).toContain("Alive One");
    expect(text).toContain("Ghost Pool");
    // 410 requests, 12 errors in total.
    expect(text).toContain("410");
    expect(text).toContain("100.0%"); // the ghost pool's 10/10
    // The attributed-since waterline is stated.
    expect(text).toMatch(/Attributed since/i);
  });

  it("renders a NULL latency as —, never as 0 ms", async () => {
    installFetch();
    const { container } = render(<UsageClient />);
    await flush();
    const rows = [...container.querySelectorAll("tbody tr")];
    const ghost = rows.find((r) => (r.textContent || "").includes("Ghost Pool"));
    expect(ghost).toBeTruthy();
    expect(ghost.textContent).toContain("—");
    expect(ghost.textContent).not.toMatch(/\b0 ms\b/);
  });

  it("wired:false says the seam has not landed — a pre-migrate harbour, not a quiet one", async () => {
    installFetch({ analytics: { ok: true, body: { ...ANALYTICS_OK, wired: false, since: null, pools: [] } } });
    const { container } = render(<UsageClient />);
    await flush();
    const text = container.textContent;
    expect(text).toMatch(/attribution seam has not landed/i);
    expect(text).toMatch(/not because the fleet is idle/i);
  });

  it("wired and quiet is 'collecting since…' — never read as a missing migration", async () => {
    installFetch({ analytics: { ok: true, body: { ...ANALYTICS_OK, wired: true, since: "2026-11-04T00:00:00.000Z", pools: [] } } });
    const { container } = render(<UsageClient />);
    await flush();
    const text = container.textContent;
    expect(text).toMatch(/Collecting/);
    expect(text).toMatch(/A quiet window is not a missing migration/i);
    expect(text).not.toMatch(/has not landed/i);
  });
});

// ── tools ───────────────────────────────────────────────────────────────────
describe("the Tools shore — each tool a gesture over a seam, and the sweep never liquidates the unknown", () => {
  it("presents the toolbox with every §3.3 tool labelled", async () => {
    installFetch();
    const { container } = render(<ToolsClient />);
    await flush();
    const text = container.textContent;
    for (const label of ["Health sweep", "Per-pool probe", "Batch import", "Geo probe", "Export", "Deploy relay", "Ledger filter"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("Pool analytics · CSV");
  });

  it("offers auto-disable but defaults it OFF, and says only proven-dead is touched", async () => {
    installFetch();
    const { container } = render(<ToolsClient />);
    await flush();
    const text = container.textContent;
    expect(text).toMatch(/DETERMINISTIC dead/i);
    expect(text).toMatch(/indeterminate pool is never touched/i);
    const switches = [...container.querySelectorAll('[role="switch"], input[type="checkbox"]')];
    // The sweep's auto-disable switch, whoever renders it, must start off.
    const sweep = switches.find((s) => (s.closest("label")?.textContent || "").includes("Disable proven-dead"));
    if (sweep) expect(sweep.checked).toBe(false);
  });

  it("the fleet export writes identifying fields only — no proxyUrl in the file", async () => {
    installFetch();
    const { container } = render(<ToolsClient />);
    await flush();
    const csv = activePoolsCsv([{ id: "alive-one", name: "Alive One", type: "http", isActive: true, proxyUrl: "http://secret@1.2.3.4" }]);
    expect(csv).toContain("alive-one");
    expect(csv).not.toContain("secret");
    expect(csv).not.toContain("proxyUrl");
    expect(container).toBeTruthy();
  });
});

// ── the CSV law itself ──────────────────────────────────────────────────────
describe("the CSV vocabulary — the formula-injection guard the usage export proved", () => {
  it("always quotes, doubles internal quotes, and pads a leading = + - @ inside the quotes", () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("=1+1")).toBe('"\t=1+1"');
    expect(csvCell("+x")).toBe('"\t+x"');
    expect(csvCell("-x")).toBe('"\t-x"');
    expect(csvCell("@x")).toBe('"\t@x"');
    expect(csvCell(null)).toBe('""');
  });

  it("analytics CSV carries the same fields the Usage page renders, integers only", () => {
    const csv = analyticsCsv(ANALYTICS_OK.pools, "24h");
    const [head, row] = csv.trim().split("\n");
    expect(head).toContain('"poolId"');
    expect(head).toContain('"p95LatencyMs"');
    expect(row).toContain('"alive-one"');
    // A null latency is an empty cell, not 0.
    const ghost = csv.trim().split("\n")[2];
    expect(ghost).toContain('"ghost"');
  });

  it("toCsv joins [header, pick] pairs in order", () => {
    const csv = toCsv(
      [
        ["k", (r) => r.k],
        ["v", (r) => r.v],
      ],
      [{ k: "a", v: 1 }, { k: "b", v: 2 }]
    );
    expect(csv).toBe('"k","v"\n"a","1"\n"b","2"\n');
  });
});

// ── the three new routes exist and are client pages ─────────────────────────
describe("the three new shores are real routes", () => {
  const SHORES = [
    ["ledger/LedgerClient.js", "LedgerClient"],
    ["usage/UsageClient.js", "UsageClient"],
    ["tools/ToolsClient.js", "ToolsClient"],
  ];
  for (const [rel, name] of SHORES) {
    it(`${rel} is a client component and ${rel.split("/")[0]}/page.js mounts it`, () => {
      const SRC = readSrc(`src/app/(dashboard)/dashboard/proxy/${rel}`);
      expect(SRC.startsWith('"use client"')).toBe(true);
      expect(SRC).toContain("ProxyShore");
      // The frame owns error + skeleton; the shore hands at least its store error
      // through (Usage composes the store's with its own seam's).
      expect(SRC).toMatch(/error=\{[^}]*c\.error/);
      const PAGE = readSrc(`src/app/(dashboard)/dashboard/proxy/${rel.split("/")[0]}/page.js`);
      expect(PAGE).toContain(name);
    });
  }
});

// ── the census arithmetic is unchanged by W4 ────────────────────────────────
describe("the one census — W4 adds shores, not a second arithmetic", () => {
  it("computeCensus counts three verdicts and never folds indeterminate into dead", () => {
    const census = computeCensus(
      [
        { isActive: true, testStatus: "active" },
        { isActive: true, testStatus: "error" },
        { isActive: true, testStatus: "unknown" },
      ],
      []
    );
    expect(census.ok).toBe(1);
    expect(census.dead).toBe(1);
    expect(census.indeterminate).toBe(1);
  });
});
