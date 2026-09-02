/**
 * STORM 3 — The Split Allowlist (v0.9.42 Wave 0)
 *
 * Three modules each declared their own idea of what a proxy pool could be:
 *
 *   - lib/constants/proxyTypes.js → six types (http, https, vercel, cloudflare,
 *     deno, socks5), imported by NOBODY.
 *   - api/proxy-pools/route.js   → a local 4-type literal, so a socks5:// pool
 *     URL — which proxyFetch.js has supported since v0.9.4 — could never be
 *     CREATED; the literal coerced it to "http".
 *   - api/proxy-pools/[id]/route.js → a local 3-type literal missing "deno", so
 *     a PUT on a deno relay silently rewrote its type to "http" and broke its
 *     relay routing (relays are probed through an envelope, not CONNECTed).
 *
 * The transport layer was ready for socks5; the front door refused to let it in.
 * This storm proves one shared constant now decides for both routes, and that
 * every declared type survives a create/update round-trip intact.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const modelMocks = vi.hoisted(() => ({
  createProxyPool: vi.fn(),
  updateProxyPool: vi.fn(),
  getProxyPoolById: vi.fn(),
  getProxyPools: vi.fn(),
  getProviderConnections: vi.fn(),
  deleteProxyPool: vi.fn(),
}));

vi.mock("@/models", () => modelMocks);

const { VALID_PROXY_TYPES } = await import("../../src/lib/constants/proxyTypes.js");
const poolsRoute = await import("../../src/app/api/proxy-pools/route.js");
const poolByIdRoute = await import("../../src/app/api/proxy-pools/[id]/route.js");

/** A minimal Request whose url + json() the routes actually read. */
function req(body, url = "http://localhost:32060/api/proxy-pools") {
  return { url, json: async () => body };
}

function params(id) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  modelMocks.getProviderConnections.mockResolvedValue([]);
  modelMocks.createProxyPool.mockImplementation(async (d) => ({ id: "new-1", ...d }));
  modelMocks.updateProxyPool.mockImplementation(async (id, d) => ({ id, ...d }));
});

describe("S3.1: the shared constant is the single source of truth", () => {
  it("declares all six types including socks5 and deno", () => {
    expect(VALID_PROXY_TYPES).toEqual(
      expect.arrayContaining(["http", "https", "vercel", "cloudflare", "deno", "socks5"])
    );
    expect(VALID_PROXY_TYPES).toHaveLength(6);
  });

  it("routes validate THROUGH the shared constant, not a local literal", async () => {
    // A negative regex here would be defeated by this file's own explanatory
    // prose (and by the routes' comments describing the wound). The real
    // invariant is positive: the type check must call VALID_PROXY_TYPES.includes.
    // That cannot be satisfied by a comment, and it is exactly the seam that was
    // severed — each route deciding for itself.
    const { readFileSync } = await import("node:fs");
    const listSrc = readFileSync(
      new URL("../../src/app/api/proxy-pools/route.js", import.meta.url), "utf8"
    );
    const byIdSrc = readFileSync(
      new URL("../../src/app/api/proxy-pools/[id]/route.js", import.meta.url), "utf8"
    );
    for (const [name, src] of [["route.js", listSrc], ["[id]/route.js", byIdSrc]]) {
      expect(src, `${name} must import VALID_PROXY_TYPES`).toContain("VALID_PROXY_TYPES");
      expect(src, `${name} must validate via the shared constant`).toMatch(
        /VALID_PROXY_TYPES\.includes\(/
      );
    }
  });
});

describe("S3.2: every declared type survives CREATE", () => {
  it.each(VALID_PROXY_TYPES)("creates a %s pool without coercion", async (type) => {
    const res = await poolsRoute.POST(req({
      name: `${type}-pool`,
      proxyUrl: type === "socks5"
        ? "socks5://192.168.1.20:1080"
        : type === "vercel" || type === "cloudflare" || type === "deno"
          ? "https://relay.example.workers.dev"
          : "http://192.168.1.20:8080",
      type,
    }));

    expect(res.status).toBe(201);
    const created = modelMocks.createProxyPool.mock.calls[0][0];
    // The load-bearing assertion: the type is NOT coerced to "http".
    expect(created.type).toBe(type);
  });

  it("specifically proves socks5 — the type the old 4-literal rejected", async () => {
    const res = await poolsRoute.POST(req({
      name: "socks-pool", proxyUrl: "socks5://192.168.1.20:1080", type: "socks5",
    }));
    expect(res.status).toBe(201);
    expect(modelMocks.createProxyPool.mock.calls[0][0].type).toBe("socks5");
  });

  it("coerces an UNKNOWN type to http (the fallback still guards)", async () => {
    const res = await poolsRoute.POST(req({
      name: "weird", proxyUrl: "http://192.168.1.20:8080", type: "gopher",
    }));
    expect(res.status).toBe(201);
    expect(modelMocks.createProxyPool.mock.calls[0][0].type).toBe("http");
  });

  it("rejects a missing name and a missing proxyUrl", async () => {
    expect((await poolsRoute.POST(req({ proxyUrl: "http://x" }))).status).toBe(400);
    expect((await poolsRoute.POST(req({ name: "n" }))).status).toBe(400);
  });
});

describe("S3.3: every declared type survives UPDATE", () => {
  it.each(VALID_PROXY_TYPES)("PUTs a %s pool without coercion", async (type) => {
    modelMocks.getProxyPoolById.mockResolvedValue({ id: "p1", name: "old", type: "http" });

    const res = await poolByIdRoute.PUT(req({ type }), params("p1"));

    expect(res.status).toBe(200);
    const updates = modelMocks.updateProxyPool.mock.calls[0][1];
    expect(updates.type).toBe(type);
  });

  it("specifically proves deno — the type the old 3-literal dropped", async () => {
    modelMocks.getProxyPoolById.mockResolvedValue({ id: "p2", name: "relay", type: "vercel" });
    const res = await poolByIdRoute.PUT(req({ type: "deno" }), params("p2"));
    expect(res.status).toBe(200);
    expect(modelMocks.updateProxyPool.mock.calls[0][1].type).toBe("deno");
  });

  it("a partial PUT that omits type leaves type untouched", async () => {
    modelMocks.getProxyPoolById.mockResolvedValue({ id: "p3", name: "keep", type: "socks5" });
    const res = await poolByIdRoute.PUT(req({ name: "renamed" }), params("p3"));
    expect(res.status).toBe(200);
    const updates = modelMocks.updateProxyPool.mock.calls[0][1];
    expect(updates).not.toHaveProperty("type");
    expect(updates.name).toBe("renamed");
  });

  it("PUT on an unknown pool 404s", async () => {
    modelMocks.getProxyPoolById.mockResolvedValue(null);
    expect((await poolByIdRoute.PUT(req({ type: "socks5" }), params("ghost"))).status).toBe(404);
  });
});

describe("S3.4: DELETE still guards bound connections", () => {
  it("refuses to delete a pool a connection is bound to", async () => {
    modelMocks.getProxyPoolById.mockResolvedValue({ id: "p4", type: "socks5" });
    modelMocks.getProviderConnections.mockResolvedValue([
      { id: "c1", providerSpecificData: { proxyPoolId: "p4" } },
    ]);

    const res = await poolByIdRoute.DELETE(req({}), params("p4"));

    expect(res.status).toBe(409);
    expect(modelMocks.deleteProxyPool).not.toHaveBeenCalled();
  });

  it("deletes an unbound pool", async () => {
    modelMocks.getProxyPoolById.mockResolvedValue({ id: "p5", type: "socks5" });
    modelMocks.getProviderConnections.mockResolvedValue([
      { id: "c1", providerSpecificData: { proxyPoolId: "other" } },
    ]);

    const res = await poolByIdRoute.DELETE(req({}), params("p5"));

    expect(res.status).toBe(200);
    expect(modelMocks.deleteProxyPool).toHaveBeenCalledWith("p5");
  });
});
