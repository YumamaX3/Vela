// GET /api/proxy-pools/stats — the fleet census.
//
// The census exists so the dashboard, the API and any future client agree on ONE
// arithmetic. These cases pin that arithmetic against fixtures, and pin the two
// properties that make the route safe to sit on the posture-read allow-list:
//   • it emits no pool row — and therefore no `proxyUrl` — at all (the credential
//     can never cross this boundary, masked or otherwise); and
//   • a thrown dependency is a LOUD 500, never a zeroed census, because a census
//     that reads "0 pools" during a DB outage is indistinguishable from an empty
//     fleet to everything downstream.
//
// Fixtures use TEST-NET-3 (203.0.113.0/24) and example credentials only.
import { beforeEach, describe, expect, it, vi } from "vitest";

const models = vi.hoisted(() => ({
  getProxyPools: vi.fn(),
  getProviderConnections: vi.fn(),
}));
const fleetMock = vi.hoisted(() => ({ getFitnessSummary: vi.fn() }));
const geoMock = vi.hoisted(() => ({ poolGeoSnapshot: vi.fn() }));

// The route's only Next dependency is NextResponse.json — a real Response keeps
// .status / .json() / .text() honest for the leak assertions below.
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) =>
      new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));
vi.mock("@/models", () => models);
vi.mock("@/lib/network/proxyFleet.js", () => ({ default: fleetMock }));
vi.mock("@/lib/network/poolGeo.js", () => geoMock);

const { GET } = await import("@/app/api/proxy-pools/stats/route.js");

const CRED = "s3cretpass";
const HOST = "203.0.113.7";
// A pool row as the repo hands it over — credential in the userinfo, exactly the
// shape §5.4 masks at every OTHER read boundary. This route must never need that
// masker because it never emits the row.
function pool(over = {}) {
  return {
    id: "p",
    name: "pool",
    proxyUrl: `http://user1:${CRED}@${HOST}:1080`,
    type: "http",
    isActive: true,
    testStatus: "unknown",
    lastTestedAt: null,
    ...over,
  };
}
function connection(poolId) {
  return { id: `c-${poolId}`, providerSpecificData: { proxyPoolId: poolId } };
}
async function census() {
  const res = await GET();
  const text = await res.text();
  return { res, text, body: JSON.parse(text) };
}

beforeEach(() => {
  vi.clearAllMocks();
  models.getProxyPools.mockResolvedValue([]);
  models.getProviderConnections.mockResolvedValue([]);
  fleetMock.getFitnessSummary.mockReturnValue({ pools: [], count: 0 });
  geoMock.poolGeoSnapshot.mockReturnValue({});
});

describe("the census shape", () => {
  it("returns exactly the declared keys — nothing wider, nothing missing", async () => {
    const { body } = await census();
    expect(Object.keys(body).sort()).toEqual(
      [
        "active",
        "bound",
        "egress",
        "fitness",
        "inactive",
        "lastTestedAt",
        "relays",
        "tested",
        "total",
      ].sort()
    );
    expect(Object.keys(body.relays).sort()).toEqual(["cloudflare", "deno", "total", "vercel"].sort());
    expect(Object.keys(body.fitness).sort()).toEqual(["blocked", "healthy", "tracked", "unhealthy"].sort());
    expect(Object.keys(body.egress).sort()).toEqual(["countries", "probed", "unstable"].sort());
    expect(Object.keys(body.tested).sort()).toEqual(["fail", "ok", "unknown"].sort());
  });

  it("reads an empty fleet honestly as zeros, not as an error", async () => {
    const { res, body } = await census();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      total: 0,
      active: 0,
      inactive: 0,
      bound: 0,
      relays: { vercel: 0, cloudflare: 0, deno: 0, total: 0 },
      fitness: { blocked: 0, unhealthy: 0, healthy: 0, tracked: 0 },
      egress: { probed: 0, unstable: 0, countries: 0 },
      tested: { ok: 0, fail: 0, unknown: 0 },
      lastTestedAt: null,
    });
  });
});

// (a) total / active / inactive come from the pool table, and the three agree.
describe("total / active / inactive", () => {
  it("counts the whole table and splits it by isActive", async () => {
    models.getProxyPools.mockResolvedValue([
      pool({ id: "p1", isActive: true }),
      pool({ id: "p2", isActive: false }),
      pool({ id: "p3", isActive: true }),
      pool({ id: "p4", isActive: true }),
      pool({ id: "p5", isActive: true }),
      pool({ id: "p6", isActive: true }),
    ]);
    const { body } = await census();
    expect(body.total).toBe(6);
    expect(body.active).toBe(5);
    expect(body.inactive).toBe(1);
    // The partition is exact — this is the property a dashboard reads.
    expect(body.active + body.inactive).toBe(body.total);
  });

  it("treats a missing isActive as inactive rather than throwing", async () => {
    models.getProxyPools.mockResolvedValue([
      pool({ id: "p1", isActive: undefined }),
      pool({ id: "p2", isActive: true }),
    ]);
    const { body } = await census();
    expect(body.total).toBe(2);
    expect(body.active).toBe(1);
    expect(body.inactive).toBe(1);
  });
});

// (b) bound is the fleet-wide SUM of the shared usage map — the same map the
// sibling GET /api/proxy-pools uses for its per-pool boundConnectionCount.
describe("bound", () => {
  it("sums connections per pool from the usage map", async () => {
    models.getProxyPools.mockResolvedValue([pool({ id: "p1" }), pool({ id: "p2" })]);
    models.getProviderConnections.mockResolvedValue([
      connection("p1"),
      connection("p1"),
      connection("p2"),
    ]);
    const { body } = await census();
    expect(body.bound).toBe(3);
  });

  it("ignores bindings that point at a pool not in the census", async () => {
    models.getProxyPools.mockResolvedValue([pool({ id: "p1" })]);
    models.getProviderConnections.mockResolvedValue([
      connection("p1"),
      // A stale binding to a deleted pool must not inflate the count past total.
      connection("ghost"),
    ]);
    const { body } = await census();
    expect(body.bound).toBe(1);
  });
});

// (c) the fitness block — four buckets over (pool, provider) rows.
describe("fitness", () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const past = new Date(Date.now() - 3_600_000).toISOString();

  it("buckets rows into blocked / healthy / unhealthy and reports tracked", async () => {
    fleetMock.getFitnessSummary.mockReturnValue({
      pools: [
        // healthy: score at the dashboard's own "Fit" threshold.
        { poolId: "p1", provider: "freebuff", score: 0.9, unfit: 0, unfitUntil: null },
        // unhealthy: below the threshold and not blocked.
        { poolId: "p1", provider: "qoder", score: 0.2, unfit: 0, unfitUntil: null },
        // blocked: an OPEN unfit window.
        { poolId: "p2", provider: "freebuff", score: 0.95, unfit: 1, unfitUntil: future },
        // an EXPIRED window is not a block — it falls back to its score bucket.
        { poolId: "p2", provider: "qoder", score: 0.95, unfit: 1, unfitUntil: past },
      ],
      count: 4,
    });
    const { body } = await census();
    expect(body.fitness).toEqual({ blocked: 1, unhealthy: 1, healthy: 2, tracked: 4 });
  });

  it("treats an unfit row with no window as blocked, and a bad score as unhealthy", async () => {
    fleetMock.getFitnessSummary.mockReturnValue({
      pools: [
        { poolId: "p1", provider: "x", score: 0.5, unfit: 1, unfitUntil: null },
        { poolId: "p2", provider: "y", score: undefined, unfit: 0, unfitUntil: null },
      ],
      count: 2,
    });
    const { body } = await census();
    expect(body.fitness).toEqual({ blocked: 1, unhealthy: 1, healthy: 0, tracked: 2 });
  });
});

// The remaining tallies: relays, tested, egress, lastTestedAt.
describe("relays / tested / egress / lastTestedAt", () => {
  it("counts relay envelopes, verdict classes, and the latest test timestamp", async () => {
    models.getProxyPools.mockResolvedValue([
      pool({ id: "p1", type: "http", testStatus: "active", lastTestedAt: "2026-01-01T00:00:00.000Z" }),
      pool({ id: "p2", type: "vercel", testStatus: "error", lastTestedAt: "2026-06-01T00:00:00.000Z" }),
      pool({ id: "p3", type: "cloudflare", testStatus: "unknown" }),
      pool({ id: "p4", type: "deno", testStatus: null }),
    ]);
    const { body } = await census();
    expect(body.relays).toEqual({ vercel: 1, cloudflare: 1, deno: 1, total: 3 });
    expect(body.tested).toEqual({ ok: 1, fail: 1, unknown: 2 });
    // The MAX of the timestamps, not the first or the last row seen.
    expect(body.lastTestedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("scopes egress to counted pools and tallies unstable + distinct countries", async () => {
    models.getProxyPools.mockResolvedValue([pool({ id: "p1" }), pool({ id: "p2" })]);
    geoMock.poolGeoSnapshot.mockReturnValue({
      p1: { ip: "203.0.113.10", country: "JP", isUnstable: false },
      p2: { ip: "203.0.113.11", country: "JP", isUnstable: true },
      // A geo entry for a pool that is not in the census must not count.
      ghost: { ip: "203.0.113.12", country: "US", isUnstable: true },
    });
    const { body } = await census();
    expect(body.egress).toEqual({ probed: 2, unstable: 1, countries: 1 });
  });

  it("reports lastTestedAt null when no pool has ever been tested", async () => {
    models.getProxyPools.mockResolvedValue([pool({ id: "p1", lastTestedAt: null })]);
    const { body } = await census();
    expect(body.lastTestedAt).toBeNull();
  });
});

// (d) THE SECURITY ASSERTION — no pool row, and specifically no proxyUrl, ever
// reaches the wire. Every other posture-read entry emits masked pool objects; this
// one is safe BY CONSTRUCTION, and this is the case that proves it.
describe("no credential and no pool row on the wire", () => {
  it("emits no proxyUrl anywhere in the JSON, even when pools carry credentials", async () => {
    const pools = [
      pool({ id: "p1", proxyUrl: `http://user1:${CRED}@${HOST}:1080`, type: "http" }),
      pool({ id: "p2", proxyUrl: `socks5://user1:${CRED}@203.0.113.8:1080`, type: "socks5" }),
    ];
    models.getProxyPools.mockResolvedValue(pools);
    const { text, body } = await census();

    // The fixture is meaningful: it really did carry a credential.
    expect(pools[0].proxyUrl).toContain(CRED);
    // ...and none of it crossed the boundary.
    expect(text).not.toContain("proxyUrl");
    expect(text).not.toContain(CRED);
    expect(text).not.toContain("user1");
    expect(text).not.toContain(HOST);
    expect(text).not.toContain("socks5://");
    // Not even the pool id / name — the census is aggregate, not per-pool.
    expect(text).not.toContain("p1");

    // Belt and braces: walk the whole tree for a `proxyUrl` key or any
    // scheme://host string, so a future field cannot smuggle one in unnoticed.
    const offenders = [];
    (function walk(node, path) {
      if (typeof node === "string") {
        if (/[a-z][a-z0-9+.-]*:\/\//i.test(node)) offenders.push(`${path} = ${node}`);
        return;
      }
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "proxyUrl") offenders.push(`${path}.${k}`);
          walk(v, `${path}.${k}`);
        }
      }
    })(body, "$");
    expect(offenders).toEqual([]);
  });
});

// The route and the guard's allow-list must ship together: the census is
// posture-consistent ONLY if the guard admits it as a GET read. This is the same
// pair the storm suite pins; asserting it here keeps the two halves of this
// assignment from drifting apart.
describe("guard registration", () => {
  it("registers the census as a GET posture read — and only on GET", async () => {
    vi.doMock("next/server", () => ({ NextResponse: { json: (b) => b, next: () => "next" } }));
    vi.doMock("@/lib/localDb", () => ({ getSettings: vi.fn(), validateApiKey: vi.fn() }));
    vi.doMock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn() }));
    vi.doMock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: vi.fn(), AUTH_COOKIE_NAME: "t" }));
    const { __test__ } = await import("@/dashboardGuard.js");
    const { isProxyPoolsPostureRead, PROXY_POOLS_POSTURE_READS } = __test__;
    expect(PROXY_POOLS_POSTURE_READS.has("/api/proxy-pools/stats")).toBe(true);
    expect(isProxyPoolsPostureRead("/api/proxy-pools/stats", "GET")).toBe(true);
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(isProxyPoolsPostureRead("/api/proxy-pools/stats", m)).toBe(false);
    }
  });
});

// (e) a thrown dependency is a LOUD 500 — never a silent empty census.
describe("a thrown dependency returns 500, not a zeroed census", () => {
  it.each([
    ["getProxyPools", () => models.getProxyPools.mockRejectedValue(new Error("db is down"))],
    ["getProviderConnections", () => models.getProviderConnections.mockRejectedValue(new Error("db is down"))],
    ["getFitnessSummary", () => fleetMock.getFitnessSummary.mockImplementation(() => { throw new Error("fitness store gone"); })],
  ])("500s when %s throws", async (_name, arm) => {
    arm();
    const { res, body } = await census();
    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
    // The wound this guards: a census that reads as an empty fleet during an
    // outage. None of the census keys may appear.
    expect(body).not.toHaveProperty("total");
    expect(body).not.toHaveProperty("active");
    expect(body).not.toHaveProperty("relays");
  });
});
