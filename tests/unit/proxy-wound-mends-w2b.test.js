// Proxy Console Separation W2b — the two §2 wound mends.
//
// §2 #5  netlify-deploy's 201 used to emit the RAW unmasked pool row — the lone
//        §5.4 straggler among the four deploy routes. It now returns
//        relayDeployResponse: { poolId, deployUrl, relayVersion, reusedRow,
//        allowList } and NEVER the credential-bearing proxyUrl. This test drives
//        the route with a mocked pool creation carrying a credential and walks
//        the wire for it.
// §2 #6  export called JSON.parse(p.data) on a row whose readers already expose
//        FLAT fields — the parse threw and every export was a 500. The mend
//        projects flat fields; this test hands the repo a flat row exactly as
//        rowToPool returns it and asserts a 200 with the allow-list, no parse.
import { describe, it, expect, vi, beforeEach } from "vitest";

const CRED = "s3cretpass";
const HOST = "203.0.113.7";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) =>
      new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));
vi.mock("@/sse/utils/logger.js", () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }));

// ── netlify — the pool creation carries a credential that must not leak ──
const netlifyCreate = vi.hoisted(() => vi.fn());
vi.mock("@/models", () => ({ createProxyPool: netlifyCreate }));
vi.mock("@/lib/network/netlifyRelay.js", () => ({
  NETLIFY_API: "https://api.netlify.test",
  NETLIFY_FUNCTION_NAME: "relay",
  buildIndexFile: () => ({ content: "x", sha1: "sha1" }),
  buildRelayFunctionZip: () => ({ zip: Buffer.from(""), sha256: "sha256" }),
  buildRelayUrl: (siteUrl) => `${siteUrl}/.netlify/functions/relay`,
  netlifyHeaders: () => ({}),
  pollDeployReady: vi.fn(async () => {}),
}));
vi.mock("@/lib/network/relayDeploy.js", () => ({
  relayDeployResponse: ({ pool, deployUrl }) => ({
    poolId: pool?.id ?? null,
    deployUrl,
    relayVersion: "v1",
    reusedRow: false,
    allowList: { hostCount: 0, wildcard: false },
  }),
}));

// ── export — the repo returns FLAT fields (no .data blob) ──
const localDb = vi.hoisted(() => ({ getProxyPools: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProxyPools: localDb.getProxyPools }));
const fleet = vi.hoisted(() => ({ getFitnessSummary: vi.fn(() => ({ blocked: 0, healthy: 1, tracked: 1 })) }));
vi.mock("@/lib/network/proxyFleet.js", () => ({ default: fleet }));

const netlifyRoute = await import("@/app/api/proxy-pools/netlify-deploy/route.js");
const exportRoute = await import("@/app/api/proxy-pools/export/route.js");

beforeEach(() => {
  vi.clearAllMocks();
  // Stub the Netlify network dance — three fetch legs, each returning a usable shape.
  global.fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "site1", ssl_url: "https://relay.netlify.test" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "deploy1", required: [], required_functions: [] }) });
});

function body(model) {
  return new Request("http://localhost:32060/api/proxy-pools/netlify-deploy", {
    method: "POST", body: JSON.stringify({ netlifyToken: "netlify-token", projectName: "myrelay" }),
  });
}
const hasUrlShape = (t) => /[a-z][a-z0-9+.-]*:\/\//i.test(t);

describe("netlify-deploy returns the narrow relayDeployResponse (§2 #5)", () => {
  it("never emits the raw pool row or its credential", async () => {
    netlifyCreate.mockResolvedValue({
      id: "poolX", name: "myrelay", type: "netlify",
      proxyUrl: `http://user1:${CRED}@${HOST}:1080`,
      relayVersion: "v1",
    });
    const res = await netlifyRoute.POST(body());
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.poolId).toBe("poolX");
    expect(json.deployUrl).toContain("netlify.test");
    expect(json).not.toHaveProperty("proxyPool");
    const text = JSON.stringify(json);
    expect(text).not.toContain(CRED);
    expect(text).not.toContain(HOST);
    expect(text).not.toContain("proxyUrl");
    // only the deployUrl is url-shaped — no smuggled second url
    const urls = Object.values(json).filter((v) => typeof v === "string" && hasUrlShape(v));
    expect(urls.length).toBe(1);
  });
});

describe("export projects FLAT repo fields — no JSON.parse (§2 #6)", () => {
  it("200s with the identifying allow-list and never a credential", async () => {
    // A row EXACTLY as rowToPool returns it: flat fields, NO `.data` blob.
    localDb.getProxyPools.mockResolvedValue([
      { id: "poolA", name: "US-east", type: "http", isActive: true, proxyUrl: `http://u:${CRED}@${HOST}:1` },
      { id: "poolB", name: "EU", type: "socks5", isActive: true, proxyUrl: `socks5://u:${CRED}@${HOST}:2` },
    ]);
    const res = await exportRoute.GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pools).toEqual([
      { id: "poolA", name: "US-east", type: "http", isActive: true },
      { id: "poolB", name: "EU", type: "socks5", isActive: true },
    ]);
    expect(json.fitness).toBeTruthy();
    const text = JSON.stringify(json);
    expect(text).not.toContain(CRED);
    expect(text).not.toContain("proxyUrl");
  });

  it("tolerates a row missing name/type — null, never a throw", async () => {
    localDb.getProxyPools.mockResolvedValue([{ id: "poolC", isActive: true }]);
    const res = await exportRoute.GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pools[0]).toEqual({ id: "poolC", name: null, type: null, isActive: true });
  });
});
