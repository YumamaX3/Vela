// @vitest-environment happy-dom
/**
 * The Proxy console — structural surface contracts (v0.9.75).
 *
 * This suite guards the shape of the merged console: four lenses over one fleet,
 * and the two defects the merge was required to fix.
 *
 * ── DEFECT 1: the sweep is ONE request, not N ───────────────────────────────
 * `proxy-pools/page.js` swept health by fanning out one `/api/proxy-pools/[id]/test`
 * call per pool, with a browser-side concurrency queue and its own alive/dead tally.
 * That is a second health loop living in the client — and the fleet's own history is
 * the argument against a second loop: bulk-health's route carried a copy of
 * `checkAllPools`, the copy drifted, and it disabled pools on `!result.ok`. The proof
 * here is BEHAVIOURAL, not a source grep: with fetch stubbed, clicking Health Check
 * must produce exactly one POST to `/api/proxy-pools/bulk-health` and ZERO calls to
 * any `/api/proxy-pools/<id>/test`. A future edit that re-grows the fan-out fires the
 * per-pool route and this goes red — and the mock's call log is the only thing that
 * can prove it, which is why it is not a regex over the source.
 *
 * ── DEFECT 2: three verdicts, and only PROVEN death is offered ───────────────
 * The old page had two states and offered to disable everything not-alive, which is
 * exactly how the fleet once self-liquidated. The bulk-health response carries
 * `alive`/`dead`/`indeterminate` and a per-pool `results[]`; the console must report
 * all three, and the disable dialog must offer ONLY the `verdict === "dead"` subset,
 * leaving the indeterminate pools active. Proved by rendering the real FleetTab with
 * a mixed-verdict response and asserting (a) the dialog's copy names all three and
 * (b) confirming issues a PUT for the dead pool and NONE for the indeterminate one.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ProxyConsoleClient from "@/app/(dashboard)/dashboard/proxy/ProxyConsoleClient";
import { runBulkHealth } from "@/app/(dashboard)/dashboard/proxy/lib/proxyApi";
import {
  VERDICT,
  verdictFromTestStatus,
  verdictFromResult,
  verdictOfPool,
  VERDICT_META,
} from "@/app/(dashboard)/dashboard/proxy/lib/proxyFormat";

const ROOT = process.cwd();
const readSrc = (rel) => readFileSync(join(ROOT, rel), "utf8");

const POOLS = [
  { id: "alive-one", name: "Alive One", proxyUrl: "http://1.2.3.4:8080", isActive: true, testStatus: "active", boundConnectionCount: 1, type: "http" },
  { id: "dead-one", name: "Dead One", proxyUrl: "http://5.6.7.8:8080", isActive: true, testStatus: "error", boundConnectionCount: 0, type: "http" },
  { id: "unsure-one", name: "Unsure One", proxyUrl: "http://9.9.9.9:8080", isActive: true, testStatus: "unknown", boundConnectionCount: 0, type: "http" },
  { id: "relay-v", name: "Vercel Relay 1", proxyUrl: "https://relay-v.vercel.app", isActive: true, testStatus: "active", boundConnectionCount: 2, type: "vercel" },
];

const GEO = {
  "alive-one": { ip: "1.2.3.4", country: "US", city: "Ashburn", region: "VA", ts: Date.now(), ipCount: 1, isUnstable: false },
  "unsure-one": {
    ip: "9.9.9.9",
    country: "DE",
    ts: Date.now(),
    ipCount: 3,
    isUnstable: true,
    ipHistory: [
      { ip: "8.8.8.8", ts: Date.now() - 60000 },
      { ip: "7.7.7.7", ts: Date.now() - 120000 },
    ],
  },
};

const RECORDS = [
  {
    poolId: "unsure-one",
    provider: "freebuff",
    unfit: 1,
    unfitReason: "country_blocked",
    unfitUntil: new Date(Date.now() + 3.6e6).toISOString(),
    egressIp: "9.9.9.9",
    egressCountry: "DE",
  },
];

/** The repaired engine's answer — three buckets AND the per-pool array. */
const ENGINE_RESULT = {
  total: 3,
  alive: 1,
  dead: 1,
  indeterminate: 1,
  results: [
    { poolId: "alive-one", ok: true, verdict: "alive", elapsedMs: 40, error: null, status: 200 },
    { poolId: "dead-one", ok: false, verdict: "dead", elapsedMs: 12, error: "Bad Request", status: 400 },
    { poolId: "unsure-one", ok: false, verdict: "indeterminate", elapsedMs: 8000, error: "ETIMEDOUT", status: null },
  ],
};

let fetchMock;
function installFetch({ engineResult = ENGINE_RESULT } = {}) {
  fetchMock = vi.fn().mockImplementation((url, init = {}) => {
    const u = String(url);
    const method = (init.method || "GET").toUpperCase();
    if (u.includes("/api/proxy-pools/bulk-health")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => engineResult });
    }
    if (u.includes("/api/proxy-pools/fitness")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ fitness: { pools: RECORDS }, geo: GEO }) });
    }
    if (u.includes("/api/settings")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ poolGeoProbeEnabled: true }) });
    }
    if (method === "PUT" || method === "DELETE") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ proxyPool: {} }) });
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
const flush = async () => act(async () => {});

function clickButton(container, text) {
  const el = [...container.querySelectorAll("button")].find((b) => (b.textContent || "").includes(text));
  if (!el) throw new Error(`no button whose text includes "${text}"`);
  act(() => el.click());
  return el;
}
function selectAllCheckbox(container) {
  const cb = [...container.querySelectorAll('input[type="checkbox"]')].find((c) =>
    (c.closest("label")?.textContent || "").includes("Select all")
  );
  if (!cb) throw new Error("no Select all checkbox");
  return cb;
}
function tab(container, id) {
  return container.querySelector(`[role="tab"]#tab-${id}`);
}

beforeEach(() => {
  // The console remembers its lens in BOTH localStorage and the URL (`?tab=`), and
  // happy-dom shares one `window` across the tests in this file. A previous test's
  // tab switch must not decide which lens the next one lands on, so both are reset.
  try {
    window.localStorage.removeItem("vela.proxy.tab");
  } catch {
    /* storage unavailable */
  }
  try {
    window.history.replaceState(null, "", "/dashboard/proxy");
  } catch {
    /* history unavailable */
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

// ── the verdict vocabulary (Defect 2, unit-level) ─────────────────────────────
describe("verdict vocabulary — three states, and indeterminate is never death", () => {
  it("maps the persisted testStatus to all three verdicts", () => {
    expect(verdictFromTestStatus("active")).toBe(VERDICT.OK);
    expect(verdictFromTestStatus("error")).toBe(VERDICT.DEAD);
    // "unknown" is the persisted shape of "the probe could not decide".
    expect(verdictFromTestStatus("unknown")).toBe(VERDICT.INDETERMINATE);
  });
  it("maps an unknown/absent status to indeterminate, never to dead", () => {
    expect(verdictFromTestStatus(undefined)).toBe(VERDICT.INDETERMINATE);
    expect(verdictFromTestStatus("")).toBe(VERDICT.INDETERMINATE);
    expect(verdictFromTestStatus("anything-else")).toBe(VERDICT.INDETERMINATE);
    expect(verdictOfPool({})).toBe(VERDICT.INDETERMINATE);
  });
  it("maps a probe result to a verdict, and only a deterministic dead is death", () => {
    expect(verdictFromResult({ verdict: "alive" })).toBe(VERDICT.OK);
    expect(verdictFromResult({ verdict: "dead" })).toBe(VERDICT.DEAD);
    expect(verdictFromResult({ verdict: "indeterminate" })).toBe(VERDICT.INDETERMINATE);
    // A result with NO verdict (a throw's shape) is indeterminate, not dead.
    expect(verdictFromResult({ ok: false })).toBe(VERDICT.INDETERMINATE);
    expect(verdictFromResult(null)).toBe(VERDICT.INDETERMINATE);
  });
  it("gives every verdict a distinct, non-red indeterminate presentation", () => {
    expect(Object.keys(VERDICT_META).sort()).toEqual(["dead", "indeterminate", "ok"]);
    expect(VERDICT_META[VERDICT.INDETERMINATE].label).toBe("indeterminate");
    // The indeterminate tone must NOT be the error/red tone — that is the whole point.
    expect(VERDICT_META[VERDICT.INDETERMINATE].variant).not.toBe(VERDICT_META[VERDICT.DEAD].variant);
    expect(VERDICT_META[VERDICT.INDETERMINATE].title).toMatch(/left active/i);
  });
});

// ── Defect 1: the bulk-health seam (unit-level) ───────────────────────────────
describe("runBulkHealth — one POST to the engine, never a fan-out", () => {
  it("issues exactly one request, to /api/proxy-pools/bulk-health", async () => {
    installFetch();
    const res = await runBulkHealth({ autoDisable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/proxy-pools/bulk-health");
    expect(init.method).toBe("POST");
    expect(res.ok).toBe(true);
    // The engine's three buckets reach the caller verbatim.
    expect(res.body).toMatchObject({ alive: 1, dead: 1, indeterminate: 1 });
  });
  it("forwards autoDisable as intent, never acting on it in the client", async () => {
    installFetch();
    await runBulkHealth({ autoDisable: true, concurrency: 8 });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ autoDisable: true, concurrency: 8 });
  });
});

// ── the shell: four lenses over one fleet ─────────────────────────────────────
describe("the console shell — census + four tabpanel lenses", () => {
  it("renders one tablist with exactly the four lens ids", async () => {
    installFetch();
    const { container } = render(<ProxyConsoleClient />);
    await flush();
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((t) => t.id);
    expect(tabs).toEqual(["tab-fleet", "tab-fitness", "tab-egress", "tab-relay"]);
    expect(container.querySelector('[role="tablist"]')).toBeTruthy();
  });
  it("renders a single role=tabpanel whose id follows the active tab", async () => {
    installFetch();
    const { container } = render(<ProxyConsoleClient />);
    await flush();
    const panel = container.querySelector('[role="tabpanel"]');
    expect(panel).toBeTruthy();
    expect(panel.id).toBe("panel-fleet");
    expect(panel.getAttribute("aria-labelledby")).toBe("tab-fleet");
    expect(container.querySelectorAll('[role="tabpanel"]').length).toBe(1);
  });
  it("shows the census strip with the three-verdict counts", async () => {
    installFetch();
    const { container } = render(<ProxyConsoleClient />);
    await flush();
    const text = container.textContent;
    expect(text).toContain("Pools");
    expect(text).toContain("Proven dead");
    // The third state is named in the census, not folded into dead.
    expect(text).toContain("Indeterminate");
    expect(text).toContain("unknown, left active");
    expect(text).toContain("Blocked pairs");
  });
  it("switches lenses on tab click — Fitness shows the block ledger", async () => {
    installFetch();
    const { container } = render(<ProxyConsoleClient />);
    await flush();
    act(() => tab(container, "fitness").click());
    await flush();
    expect(container.textContent).toContain("Block ledger");
    expect(container.textContent).toContain("freebuff");
    expect(container.querySelector('[role="tabpanel"]').id).toBe("panel-fitness");
  });
  it("Egress lens (new) shows per-pool IP, country, stability and history", async () => {
    installFetch();
    const { container } = render(<ProxyConsoleClient />);
    await flush();
    act(() => tab(container, "egress").click());
    await flush();
    const text = container.textContent;
    expect(text).toContain("Egress ledger");
    expect(text).toContain("1.2.3.4");
    expect(text).toContain("US");
    expect(text).toContain("stable");
    expect(text).toContain("flapping");
    expect(text).toContain("IP history");
    expect(text).toContain("8.8.8.8"); // a prior IP from the history
  });
  it("Relay lens (new) shows all three platforms as first-class rows", async () => {
    installFetch();
    const { container } = render(<ProxyConsoleClient />);
    await flush();
    act(() => tab(container, "relay").click());
    await flush();
    const text = container.textContent;
    expect(text).toContain("Edge relays");
    expect(text).toContain("Vercel Relay");
    expect(text).toContain("Cloudflare Relay");
    expect(text).toContain("Deno Relay");
    // The one deployed vercel relay appears as a row with its URL.
    expect(text).toContain("Vercel Relay 1");
    expect(text).toContain("relay-v.vercel.app");
  });
});

// ── Defect 1 + Defect 2, proved through the real FleetTab ─────────────────────
describe("FleetTab health sweep — one bulk-health call, three-verdict honesty", () => {
  async function openSweep(container) {
    act(() => selectAllCheckbox(container).click());
    await flush();
    clickButton(container, "Health Check");
    await flush();
    await flush();
  }

  it("POSTs bulk-health once and never the per-pool /test route", async () => {
    installFetch();
    const { container } = render(<ProxyConsoleClient />);
    await flush();
    await openSweep(container);

    const calls = fetchMock.mock.calls.map(([u, init]) => `${(init?.method || "GET")} ${String(u)}`);
    const bulk = calls.filter((c) => c.includes("/api/proxy-pools/bulk-health"));
    const perPool = calls.filter((c) => /\/api\/proxy-pools\/[^/]+\/test/.test(c));
    expect(bulk).toEqual(["POST /api/proxy-pools/bulk-health"]);
    expect(perPool).toEqual([]);
  });

  it("reports all three verdicts in the disable dialog's copy", async () => {
    installFetch();
    const { container } = render(<ProxyConsoleClient />);
    await flush();
    await openSweep(container);

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const text = dialog.textContent;
    expect(text).toContain("Alive: 1");
    expect(text).toContain("Dead: 1");
    expect(text).toContain("Indeterminate: 1");
    // The indeterminate pool is described as unknown and left active — not dead.
    expect(text).toMatch(/left active/i);
    expect(text).toMatch(/unknown/i);
    // Only the proven-dead subset is offered.
    expect(text).toMatch(/1 PROVEN-dead/i);
  });

  it("disabling on confirm touches ONLY the proven-dead pool, never the indeterminate one", async () => {
    installFetch();
    const { container } = render(<ProxyConsoleClient />);
    await flush();
    await openSweep(container);

    const dialog = container.querySelector('[role="dialog"]');
    const confirm = [...dialog.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Confirm");
    expect(confirm).toBeTruthy();
    act(() => confirm.click());
    await flush();
    await flush();

    const puts = fetchMock.mock.calls
      .filter(([, init]) => (init?.method || "").toUpperCase() === "PUT")
      .map(([u]) => String(u));
    expect(puts).toContain("/api/proxy-pools/dead-one");
    // The wound: an indeterminate result must never be disabled through this path.
    expect(puts).not.toContain("/api/proxy-pools/unsure-one");
    expect(puts.filter((u) => u.includes("/dead-one"))).toHaveLength(1);
  });
});

// ── the old pages survive as redirects ────────────────────────────────────────
describe("the two old pages redirect into the console", () => {
  it("proxy-pools/page.js redirects to the fleet lens", () => {
    const src = readSrc("src/app/(dashboard)/dashboard/proxy-pools/page.js");
    expect(src).toContain('from "next/navigation"');
    expect(src).toContain('redirect("/dashboard/proxy?tab=fleet")');
    // The old page body is gone — this is a redirect, not a page that also renders.
    expect(src).not.toContain("useState");
  });
  it("proxy-fitness/page.js redirects to the fitness lens", () => {
    const src = readSrc("src/app/(dashboard)/dashboard/proxy-fitness/page.js");
    expect(src).toContain('from "next/navigation"');
    expect(src).toContain('redirect("/dashboard/proxy?tab=fitness")');
    expect(src).not.toContain("useState");
  });
});

// ── the shell's own structural contract ───────────────────────────────────────
describe("the shell names its four lenses and wires one tabpanel", () => {
  const SRC = readSrc("src/app/(dashboard)/dashboard/proxy/ProxyConsoleClient.js");
  it("declares exactly the four tab ids", () => {
    expect(SRC).toMatch(/TAB_IDS\s*=\s*\["fleet",\s*"fitness",\s*"egress",\s*"relay"\]/);
  });
  it("uses the shared TabBar and a role=tabpanel panel", () => {
    expect(SRC).toContain('from "@/shared/components/TabBar"');
    expect(SRC).toContain('role="tabpanel"');
  });
  it("renders the census strip and all four lens components", () => {
    for (const name of ["ProxyCensus", "FleetTab", "FitnessTab", "EgressTab", "RelayTab"]) {
      expect(SRC).toContain(name);
    }
  });
});
