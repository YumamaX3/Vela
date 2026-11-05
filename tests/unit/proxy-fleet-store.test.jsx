// @vitest-environment happy-dom
/**
 * W1 — the shared proxy fleet store (sealed plan 2026-11-04-proxy-console-separation §3.1).
 *
 * The separation turns four tabs into eight routes. A route change is a NAVIGATION,
 * and navigation unmounts page state — so the store moved above the routes. This suite
 * pins the four promises that make the separation honest:
 *
 *   1 · ONE LOAD. Eight consumers mounting converge on a single fetch cycle; the
 *       second mount after a successful load issues zero requests. A failed load
 *       does NOT stick — the next mount retries.
 *   2 · ONE ARITHMETIC. Every consumer reads the same census object; indeterminate
 *       is never folded into dead (the fleet's self-liquidation wound).
 *   3 · STORE OUTLIVES SUBSCRIBERS. Unmounting every lens (a navigation) keeps the
 *       data; remounting does not refetch.
 *   4 · MUTATIONS refetch on the engine's success word, and the geo toggle rolls
 *       back a failed optimistic write.
 *
 * Proved behaviourally — with `fetch` stubbed and calls counted — not by grepping
 * source, because the only thing that can prove "one request" is the call log.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  useProxyFleetStore,
  computeCensus,
  resetProxyFleetStore,
} from "@/app/(dashboard)/dashboard/proxy/stores/proxyFleetStore";
import { useProxyFleet } from "@/app/(dashboard)/dashboard/proxy/hooks/useProxyFleet";

const ROOT = process.cwd();
const readSrc = (rel) => readFileSync(join(ROOT, rel), "utf8");

const POOLS = [
  { id: "p-ok", name: "Ok Pool", isActive: true, testStatus: "active", boundConnectionCount: 2, type: "http" },
  { id: "p-dead", name: "Dead Pool", isActive: false, testStatus: "error", boundConnectionCount: 0, type: "http" },
  { id: "p-unknown", name: "Unsure Pool", isActive: true, testStatus: "unknown", boundConnectionCount: 1, type: "http" },
  { id: "relay-v", name: "Vercel Relay", isActive: true, testStatus: "active", boundConnectionCount: 0, type: "vercel" },
];
const RECORDS = [
  { poolId: "p-unknown", provider: "freebuff", unfit: 1, unfitUntil: new Date(Date.now() + 3.6e6).toISOString() },
];

let fetchMock;
function installFetch({ poolsOk = true } = {}) {
  fetchMock = vi.fn().mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/api/proxy-pools/fitness")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ fitness: { pools: RECORDS }, geo: {} }) });
    }
    if (u.includes("/api/settings")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ poolGeoProbeEnabled: true }) });
    }
    if (u.includes("/api/proxy-pools")) {
      return Promise.resolve({
        ok: poolsOk,
        status: poolsOk ? 200 : 500,
        json: async () => (poolsOk ? { proxyPools: POOLS } : { error: "database offline" }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
}
const poolReads = () =>
  fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/proxy-pools?")).length;

/** A minimal lens: subscribes through the real facade and renders its census. */
function Lens({ label }) {
  const c = useProxyFleet();
  return (
    <span data-label={label}>
      {`total:${c.census.total} ok:${c.census.ok} dead:${c.census.dead} ind:${c.census.indeterminate} relays:${c.relays.length}`}
    </span>
  );
}

function mountLens(label) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Lens label={label} />));
  return { container, root, unmount: () => act(() => root.unmount()) };
}

const flush = async () => act(async () => {});

beforeEach(() => {
  resetProxyFleetStore();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

// ── 1 · one load ──────────────────────────────────────────────────────────────
describe("one load — eight consumers, one fetch cycle", () => {
  it("collapses concurrent first mounts into a single pools read", async () => {
    installFetch();
    const lenses = ["pools", "fitness", "egress", "relay", "ledger", "usage", "tools", "hub"].map(mountLens);
    await flush();
    await flush();
    expect(poolReads()).toBe(1);
    // Every lens saw the same fleet.
    for (const l of lenses) expect(l.container.textContent).toContain("total:4");
  });

  it("issues zero requests when a second shore mounts after the load landed", async () => {
    installFetch();
    mountLens("pools");
    await flush();
    await flush();
    const before = fetchMock.mock.calls.length;
    mountLens("usage");
    await flush();
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("keeps the data and the request count across a full navigate-away-and-back", async () => {
    installFetch();
    const a = mountLens("pools");
    await flush();
    await flush();
    a.unmount(); // a navigation: the route's subtree is gone
    expect(useProxyFleetStore.getState().pools).toHaveLength(4); // the store outlived it
    const b = mountLens("pools");
    await flush();
    expect(poolReads()).toBe(1);
    expect(b.container.textContent).toContain("total:4");
  });

  it("does not let a failed load stick — the next mount retries and can heal", async () => {
    installFetch({ poolsOk: false });
    const a = mountLens("pools");
    await flush();
    await flush();
    expect(useProxyFleetStore.getState().error).toBe("database offline");
    expect(useProxyFleetStore.getState().loaded).toBe(false);
    a.unmount();

    vi.unstubAllGlobals();
    installFetch({ poolsOk: true });
    const b = mountLens("pools");
    await flush();
    await flush();
    expect(useProxyFleetStore.getState().error).toBeNull();
    expect(b.container.textContent).toContain("total:4");
  });
});

// ── 2 · one arithmetic ────────────────────────────────────────────────────────
describe("one arithmetic — every shore reads the same census", () => {
  it("computes the three verdicts honestly, never folding indeterminate into dead", () => {
    const census = computeCensus(POOLS, RECORDS);
    expect(census).toMatchObject({
      total: 4,
      active: 3,
      ok: 2,
      dead: 1,
      indeterminate: 1,
      bound: 3,
      blocked: 1,
      relayCount: 1,
    });
  });

  it("gives every subscriber the same numbers", async () => {
    installFetch();
    const a = mountLens("pools");
    const b = mountLens("ledger");
    await flush();
    await flush();
    expect(a.container.textContent).toBe(b.container.textContent);
    expect(a.container.textContent).toBe("total:4 ok:2 dead:1 ind:1 relays:1");
  });
});

// ── 3 · mutations ─────────────────────────────────────────────────────────────
describe("mutations refetch on the engine's word", () => {
  it("refetches after a successful create, and not after a refusal", async () => {
    installFetch();
    mountLens("pools");
    await flush();
    await flush();
    const base = poolReads();

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 400, json: async () => ({ error: "bad url" }) })
    );
    const refused = await act(() => useProxyFleetStore.getState().createPool({ name: "x" }));
    expect(refused.ok).toBe(false);
    expect(poolReads()).toBe(base);

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, status: 201, json: async () => ({ proxyPool: {} }) })
    );
    const accepted = await act(() => useProxyFleetStore.getState().createPool({ name: "y" }));
    expect(accepted.ok).toBe(true);
    expect(poolReads()).toBe(base + 1);
  });

  it("rolls the geo toggle back when the PATCH fails", async () => {
    installFetch();
    mountLens("pools");
    await flush();
    await flush();
    expect(useProxyFleetStore.getState().geoEnabled).toBe(true);

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
    );
    await act(() => useProxyFleetStore.getState().saveGeoToggle(false));
    expect(useProxyFleetStore.getState().geoEnabled).toBe(true);

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    );
    await act(() => useProxyFleetStore.getState().saveGeoToggle(false));
    expect(useProxyFleetStore.getState().geoEnabled).toBe(false);
  });
});

// ── 4 · the structural contract (the layout is what makes it shared) ─────────
describe("layout wiring — the provider outlives the routes", () => {
  const LAYOUT = readSrc("src/app/(dashboard)/dashboard/proxy/layout.js");
  const PROVIDER = readSrc("src/app/(dashboard)/dashboard/proxy/ProxyProvider.js");

  it("mounts the provider in the proxy layout, above every shore", () => {
    expect(LAYOUT).toContain('from "./ProxyProvider"');
    expect(LAYOUT).toMatch(/<ProxyProvider>\{children\}<\/ProxyProvider>/);
  });

  it("the provider is a client component that wraps children in the store", () => {
    expect(PROVIDER).toContain('"use client"');
    expect(PROVIDER).toContain("useProxyFleetStore");
    expect(PROVIDER).toMatch(/return children/);
  });

  it("the facade exposes the full console surface the four lenses consume", () => {
    const FACADE = readSrc("src/app/(dashboard)/dashboard/proxy/hooks/useProxyFleet.js");
    for (const key of [
      "pools", "records", "geo", "loading", "error", "geoEnabled",
      "poolById", "relays", "census", "reload", "createPool", "updatePool",
      "deletePool", "testPool", "bulkHealth", "saveGeoToggle", "resetFitness",
      "clearAllFitness", "probeEgress", "deploy",
    ]) {
      expect(FACADE).toContain(key);
    }
  });
});
