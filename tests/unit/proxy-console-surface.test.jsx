// @vitest-environment happy-dom
/**
 * The Proxy family — structural surface contracts (v0.9.75; retargeted by W3).
 *
 * The console was ONE page with four tabs. The separation (sealed plan
 * 2026-11-04-proxy-console-separation §3.1/§4) gave each lens its own route, and this
 * suite followed the subject onto the page that now owns it: the shell assertions
 * render `PoolsClient` (the page the Fleet lens lives on), and each lens's copies
 * render its own client. The two defects the merge was required to fix are unchanged
 * and still proved HERE, on the page a navigator can now reach by URL — a separation
 * that quietly dropped them would be a regression of the very thing the merge existed
 * to close.
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
import PoolsClient from "@/app/(dashboard)/dashboard/proxy/pools/PoolsClient";
import FitnessClient from "@/app/(dashboard)/dashboard/proxy/fitness/FitnessClient";
import EgressClient from "@/app/(dashboard)/dashboard/proxy/egress/EgressClient";
import RelayClient from "@/app/(dashboard)/dashboard/proxy/relay/RelayClient";
import HubClient from "@/app/(dashboard)/dashboard/proxy/hub/HubClient";
import { resetProxyFleetStore } from "@/app/(dashboard)/dashboard/proxy/stores/proxyFleetStore";
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

let POOLS_REFUSED = false;
let fetchMock;
function installFetch({ engineResult = ENGINE_RESULT } = {}) {
  fetchMock = vi.fn().mockImplementation((url, init = {}) => {
    const u = String(url);
    const method = (init.method || "GET").toUpperCase();
    // The refusal is scoped to the POOLS read on purpose: fitness and settings are
    // separate reads, and a failure that took the whole fetch down could not tell a
    // load error from a broken mock.
    if (POOLS_REFUSED && u.startsWith("/api/proxy-pools?")) {
      return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "db down" }) });
    }
    if (u.includes("/api/proxy-pools/bulk-health")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => engineResult });
    }
    if (u.includes("/api/proxy-pools/fitness")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ fitness: { pools: RECORDS }, geo: GEO }) });
    }
    // W4 — the hub's recent-routes card reads the routing ledger. A route is
    // modelled so the card renders its table, not its honest empty state; a
    // halt reason rides the second one so the failure copy is exercised too.
    if (u.includes("/api/proxy-pools/routing-ledger")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          routes: [
            { seq: 2, ts: Date.now(), providerId: "freebuff", model: "m-1", poolId: "alive-one", strategy: "smart", ok: true, haltReason: null, ms: 120, spans: ["pick", "connect"] },
            { seq: 1, ts: Date.now() - 1000, providerId: "codex", model: "m-2", poolId: "dead-one", strategy: "smart", ok: false, haltReason: "connect_refused", ms: 30, spans: [{ stage: "connect", decision: "halt", detail: "ECONNREFUSED", ms: 30 }] },
          ],
          health: { freebuff: { score: 96.5, samples: 20 }, codex: { score: 71.4, samples: 14 } },
        }),
      });
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
beforeEach(() => {
  // The fleet store outlives its subscribers BY DESIGN (that is the separation's
  // premise), and happy-dom shares one module graph across this file — so a store
  // loaded by one test would answer the next one from memory and the refusal test
  // could never see a fetch. Each test starts from a cold store.
  resetProxyFleetStore();
  POOLS_REFUSED = false;
  // The console remembers its lens in BOTH localStorage and the URL (`?tab=`), and
  // happy-dom shares one `window` across the tests in this file. A previous test's
  // tab switch must not decide which lens the next one lands on, so both are reset.
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

// ── the four shores: one page each, the census above every one of them ────────
describe("the separated shores — each lens on its own page, over one census", () => {
  it("the Pools page renders the fleet lens, not a tab bar", async () => {
    installFetch();
    const { container } = render(<PoolsClient />);
    await flush();
    // The console's tablist is GONE: a subject is chosen by navigating, not by a flip.
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('[role="tabpanel"]')).toBeNull();
    // The room is still the Fleet lens' room: the sweep and the create control.
    expect(container.textContent).toContain("Health Check");
    expect(container.textContent).toContain("Add Proxy Pool");
  });
  it("Fitness renders the census strip with the three-verdict counts", async () => {
    // The census follows the SUBJECT: Pools owns the pool list (its own badges already
    // carry the three verdicts), Fitness owns the block ledger, so the strip lives on
    // Fitness — the page whose "blocked pairs" number is its actual punchline.
    installFetch();
    const { container } = render(<FitnessClient />);
    await flush();
    const text = container.textContent;
    expect(text).toContain("Pools");
    expect(text).toContain("Proven dead");
    // The third state is named in the census, not folded into dead.
    expect(text).toContain("Indeterminate");
    expect(text).toContain("unknown, left active");
    expect(text).toContain("Blocked pairs");
  });
  // W4 widens the hub from four doors to eight (sealed plan §1: "links to every
  // lens"). The pin moves WITH the doors, never after: the eight door hrefs are
  // the exact set, in console order, and the hub's own route is not among them
  // (a door to itself is not a door). The ledger jump in the recent-routes card
  // is asserted separately so it cannot be mistaken for a door.
  it("the hub carries the same census and links all eight doors", async () => {
    installFetch();
    const { container } = render(<HubClient />);
    await flush();
    const hrefs = [...container.querySelectorAll('a[href^="/dashboard/proxy/"]')].map((a) => a.getAttribute("href"));
    // The recent-routes card's jump to the Ledger carries the ledger href too, so
    // compare the DISTINCT hrefs as a set — and then prove the door grid itself is
    // in console order, which the set alone cannot show.
    const distinct = [...new Set(hrefs)];
    expect(distinct.sort()).toEqual(
      [
        "/dashboard/proxy/pools",
        "/dashboard/proxy/fitness",
        "/dashboard/proxy/egress",
        "/dashboard/proxy/relay",
        "/dashboard/proxy/ledger",
        "/dashboard/proxy/usage",
        "/dashboard/proxy/tools",
      ].sort()
    );
    // The door grid is the link set inside the "Every lens" section; its hrefs are
    // in console order. Anchoring on the section (not on copy) keeps this stable
    // when a blurb is reworded.
    const lensSection = [...container.querySelectorAll("section")].find((s) => (s.textContent || "").includes("Every lens"));
    const grid = [...lensSection.querySelectorAll("a[href^='/dashboard/proxy/']")];
    expect(grid.map((a) => a.getAttribute("href"))).toEqual([
      "/dashboard/proxy/pools",
      "/dashboard/proxy/fitness",
      "/dashboard/proxy/egress",
      "/dashboard/proxy/relay",
      "/dashboard/proxy/ledger",
      "/dashboard/proxy/usage",
      "/dashboard/proxy/tools",
    ]);
    // The recent-routes card's jump to the Ledger is a deep link, not a door.
    expect(hrefs).toContain("/dashboard/proxy/ledger");
    // The hub reads the same arithmetic; indeterminate is a named number here too.
    expect(container.textContent).toContain("Indeterminate");
    expect(container.textContent).toContain("unknown, left active");
  });
  it("Fitness page shows the block ledger", async () => {
    installFetch();
    const { container } = render(<FitnessClient />);
    await flush();
    expect(container.textContent).toContain("Block ledger");
    expect(container.textContent).toContain("freebuff");
  });
  it("Egress page shows per-pool IP, country, stability and history", async () => {
    installFetch();
    const { container } = render(<EgressClient />);
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
  it("Relay page shows all three platforms as first-class rows", async () => {
    installFetch();
    const { container } = render(<RelayClient />);
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
  it("a failed load shows the banner and still renders the room and its doors", async () => {
    // The load refuses; the page must NOT vanish. An error banner sits above a room
    // that still links onward — a dead door is worse than an honest banner.
    POOLS_REFUSED = true;
    installFetch();
    const { container } = render(<HubClient />);
    await flush();
    expect(container.textContent).toMatch(/db down|Failed/i);
    expect(container.querySelector('a[href="/dashboard/proxy/pools"]')).toBeTruthy();
  });
});

// ── Defect 1 + Defect 2, proved through the real FleetTab ─────────────────────
describe("FleetTab health sweep, on the Pools page — one call, three verdicts", () => {
  async function openSweep(container) {
    act(() => selectAllCheckbox(container).click());
    await flush();
    clickButton(container, "Health Check");
    await flush();
    await flush();
  }

  it("POSTs bulk-health once and never the per-pool /test route", async () => {
    installFetch();
    const { container } = render(<PoolsClient />);
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
    const { container } = render(<PoolsClient />);
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
    const { container } = render(<PoolsClient />);
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

// ── the redirect law (§3.1) ───────────────────────────────────────────────────
describe("the old addresses land on the new routes", () => {
  it("proxy-pools/page.js redirects to the pools route", () => {
    const src = readSrc("src/app/(dashboard)/dashboard/proxy-pools/page.js");
    expect(src).toContain('from "next/navigation"');
    expect(src).toContain('redirect("/dashboard/proxy/pools")');
    // The old page body is gone — this is a redirect, not a page that also renders.
    expect(src).not.toContain("useState");
  });
  it("proxy-fitness/page.js redirects to the fitness route", () => {
    const src = readSrc("src/app/(dashboard)/dashboard/proxy-fitness/page.js");
    expect(src).toContain('from "next/navigation"');
    expect(src).toContain('redirect("/dashboard/proxy/fitness")');
    expect(src).not.toContain("useState");
  });
  it("the integrated console's ?tab= links land on the four routes, unknown goes hub", () => {
    const src = readSrc("src/app/(dashboard)/dashboard/proxy/page.js");
    for (const [tab, route] of [
      ["fleet", "/dashboard/proxy/pools"],
      ["fitness", "/dashboard/proxy/fitness"],
      ["egress", "/dashboard/proxy/egress"],
      ["relay", "/dashboard/proxy/relay"],
    ]) {
      expect(src).toMatch(new RegExp(`${tab}:\\s*"${route}"`));
    }
    expect(src).toContain('"/dashboard/proxy/hub"');
    expect(src).toContain('from "next/navigation"');
    // The console itself is a redirect now — no client, no tabs, no state.
    expect(src).not.toContain('"use client"');
  });
  it("the old console page is gone, not merely orphaned", () => {
    // A fifth copy of the four lenses would drift; the separation deletes it.
    expect(() => readSrc("src/app/(dashboard)/dashboard/proxy/ProxyConsoleClient.js")).toThrow();
  });
});

// ── each shore's own structural contract ──────────────────────────────────────
describe("each shore is a page over the shared facade, not a tab", () => {
  const SHORES = [
    ["pools/PoolsClient.js", "FleetTab", "lan"],
    ["fitness/FitnessClient.js", "FitnessTab", "monitor_heart"],
    ["egress/EgressClient.js", "EgressTab", "travel_explore"],
    ["relay/RelayClient.js", "RelayTab", "cloud_upload"],
  ];
  for (const [rel, lens, icon] of SHORES) {
    it(`${rel} binds the facade to ${lens} under the room's masthead`, () => {
      const SRC = readSrc(`src/app/(dashboard)/dashboard/proxy/${rel}`);
      expect(SRC).toContain("useProxyFleet");
      expect(SRC).toContain(lens);
      expect(SRC).toContain(icon);
      // The frame owns error + skeleton; the shore hands its error through.
      expect(SRC).toContain("ProxyShore");
      expect(SRC).toMatch(/error=\{c\.error\}/);
    });
  }
  it("every shore is reached by a route, and every client is a client component", () => {
    for (const [rel] of SHORES) {
      const SRC = readSrc(`src/app/(dashboard)/dashboard/proxy/${rel}`);
      expect(SRC.startsWith('"use client"')).toBe(true);
      const route = rel.split("/")[0];
      const PAGE = readSrc(`src/app/(dashboard)/dashboard/proxy/${route}/page.js`);
      expect(PAGE).toContain(rel.split("/")[1].replace(".js", ""));
    }
    // The hub has a route of its own too — /dashboard/proxy resolves to it.
    expect(readSrc("src/app/(dashboard)/dashboard/proxy/hub/page.js")).toContain("HubClient");
  });
  it("the shared frame does not mount the facade or own the census", () => {
    // Code, not prose: the frame's own header discusses what it declines to do, so a
    // whole-file grep would fire on the explanation. Strip the comments first.
    const SRC = readSrc("src/app/(dashboard)/dashboard/proxy/components/ProxyShore.js")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(SRC).not.toContain("useProxyFleet");
    expect(SRC).not.toContain("ProxyCensus");
    expect(SRC).not.toContain("hooks/");
    // It renders the room on error rather than gating it away.
    expect(SRC).toContain("onRetry");
  });
});
