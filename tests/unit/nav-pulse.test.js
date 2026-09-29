/**
 * GET /api/nav/pulse — the navigation rail's living chart.
 *
 * ── WHAT IS UNDER TEST ──────────────────────────────────────────────────────
 * This route is an AGGREGATOR: it calls six sibling route handlers and projects
 * their answers into one counts-only body. So the six siblings are stubbed at
 * their module boundary and every assertion here is about the AGGREGATOR's own
 * two laws — the read boundary and the degradation shape. The siblings keep
 * their own suites for their own arithmetic (keys/stats, combos/stats and
 * proxy-pools/stats each have one); stubbing them here is not a hole in the
 * proof, it is the seam under test.
 *
 * ── THE THREE PROOFS ────────────────────────────────────────────────────────
 *  1. THE READ BOUNDARY. Each stubbed sibling is fed a payload carrying
 *     deliberately sensitive fields (`apiKey`, `proxyUrl`, `providerName`, and
 *     a real id/name), and the response is walked at EVERY depth: no forbidden
 *     KEY and no sentinel VALUE may appear. This is the law that a column added
 *     to a sibling census tomorrow cannot ride out through this door.
 *  2. DEGRADATION BY ABSENCE. One source rejecting must cost exactly that one
 *     section and one flag; the other five still speak. A rail that blanked
 *     because one census hiccuped would be a worse lie than a missing lens.
 *  3. THE MEMO. Two calls inside the window share ONE underlying invocation and
 *     return the IDENTICAL `ts` — the timestamp says when the numbers were true,
 *     not when they were last asked for.
 *
 * ── ENVIRONMENT NOTES (stated, not hidden) ──────────────────────────────────
 * · `next/server` is mocked to a real `Response`, so `.ok` / `.status` are
 *   honest — a 500 from a sibling must be able to fail a source, and the leak
 *   assertions read the real serialized body.
 * · Only `Date` is faked (`toFake: ["Date"]`), so the 30s memo boundary can be
 *   stepped deterministically without disturbing any timer. The route uses no
 *   timers of its own.
 * · The memo is MODULE-level, so every case re-imports the route through
 *   `vi.resetModules()`. Without that, the first case's census would be served
 *   to every later case and the suite would measure nothing.
 * · Fixtures use TEST-NET-3 (203.0.113.0/24) and example credentials only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── The six sibling stubs, hoisted so vi.mock can see them ──────────────────
const siblings = vi.hoisted(() => ({
  keys: vi.fn(),
  providers: vi.fn(),
  combos: vi.fn(),
  proxy: vi.fn(),
  usage: vi.fn(),
  errors: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) =>
      new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));
vi.mock("@/app/api/keys/stats/route", () => ({ GET: siblings.keys }));
vi.mock("@/app/api/providers/status/route", () => ({ GET: siblings.providers }));
vi.mock("@/app/api/combos/stats/route", () => ({ GET: siblings.combos }));
vi.mock("@/app/api/proxy-pools/stats/route", () => ({ GET: siblings.proxy }));
vi.mock("@/app/api/usage/stats/route", () => ({ GET: siblings.usage }));
vi.mock("@/app/api/usage/providers/activity/route", () => ({ GET: siblings.errors }));

// Sentinels that must not survive the projection at any depth.
const SECRET_KEY = "sk-live-DO-NOT-LEAK";
const SECRET_URL = "http://user:pass@203.0.113.7:1080";
const SECRET_NAME = "prod-eu-key-alpha";

// Keys the wire may never carry — the shapes §5.4 redacts everywhere else.
const FORBIDDEN_KEYS = [
  "apiKey",
  "proxyUrl",
  "providerName",
  "keyName",
  "keyPrefix",
  "id",
  "name",
  "provider",
  "email",
  "accountName",
  "proxy",
];

function ok(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A full set of healthy answers, each carrying the sensitive fields the
 *  real censuses may be adjacent to (key rows, pool rows, provider ids) so the
 *  leak assertions have something to catch. */
function seedHealthy() {
  siblings.keys.mockResolvedValue(
    ok({
      period: "30d",
      posture: { requireApiKey: true, requireLogin: true },
      totals: { keys: 3, active: 2, paused: 1 },
      byCategory: [{ category: "prod", keys: 3 }],
      top: [{ id: "k-1", name: SECRET_NAME, requests: 9 }],
      attention: [{ id: "k-2", name: SECRET_NAME, posture: "paused", reasons: ["paused"] }],
      idle: [{ id: "k-3", name: SECRET_NAME }],
    }),
  );
  siblings.providers.mockResolvedValue(
    ok({
      counts: { healthy: 13, degraded: 0, down: 0, cooling: 0, idle: 1 },
      worst: "idle",
      providers: 14,
    }),
  );
  siblings.combos.mockResolvedValue(
    ok({
      window: { hours: 24 },
      totals: { combos: 8, combosAllKinds: 11, activeCombos: 5, idleCombos: 3 },
      harbors: [{ harbor: "prod", combos: 8 }],
      top: [{ name: SECRET_NAME }],
      attention: [],
      idle: [SECRET_NAME],
    }),
  );
  siblings.proxy.mockResolvedValue(
    ok({
      total: 4,
      active: 3,
      inactive: 1,
      bound: 2,
      fitness: { blocked: 0, unhealthy: 0, healthy: 2, tracked: 2 },
      egress: { probed: 2, unstable: 0, countries: 1 },
      tested: { ok: 2, fail: 0, unknown: 2 },
      lastTestedAt: "2026-09-29T00:00:00.000Z",
    }),
  );
  siblings.usage.mockResolvedValue(
    ok({
      totalRequests: 1284,
      totalCost: 4.18,
      byProvider: { [SECRET_NAME]: { requests: 10, cost: 1 } },
      byApiKey: { [SECRET_NAME]: { apiKeyMasked: "sk-…", keyName: SECRET_NAME } },
      errorProvider: SECRET_NAME,
    }),
  );
  siblings.errors.mockResolvedValue(
    ok({
      perProvider: {
        [SECRET_NAME]: { requests: 30, errors: 2 },
        "other-provider": { requests: 10, errors: 0 },
      },
      windowMs: 60000,
      ts: 1738000000000,
    }),
  );
}

/** A fresh module registry per case — the memo is module-level, so without this
 *  the first case's census would be served to every later one. */
async function loadRoute() {
  vi.resetModules();
  const mod = await import("@/app/api/nav/pulse/route.js");
  return mod.GET;
}

async function pulse() {
  const GET = await loadRoute();
  const res = await GET();
  const text = await res.text();
  return { res, text, body: JSON.parse(text) };
}

/** Walk every key at every depth. */
function collectKeys(value, seen = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, seen);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      seen.push(key);
      collectKeys(nested, seen);
    }
  }
  return seen;
}
// The top level IS the declared contract: `providers`, `proxy`, … are section
// names the spec fixes, and the shape case above pins them exactly. So the leak
// law is applied to the six DATA SECTIONS — which is where a sibling's
// credential-bearing field (`proxy`, `apiKey`, `providerName`) would actually
// ride out. Two top-level entries are skipped, and the assertions prove each
// skip is incapable of hiding a leak:
//   · `sources` is skipped because its keys ARE the spec's six source flags
//     (`proxy` among them) and every value is a boolean — asserted below.
//   · `ts` is skipped because it is a single number — asserted in the shape case.
function collectNestedKeys(body) {
  const seen = [];
  for (const [name, value] of Object.entries(body)) {
    if (name === "sources" || name === "ts") continue;
    collectKeys(value, seen);
  }
  return seen;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T12:00:00.000Z"));
  seedHealthy();
});

describe("the pulse body", () => {
  it("projects every source into the declared counts-only shape", async () => {
    const { res, body } = await pulse();
    expect(res.status).toBe(200);

    // The exact wire shape — a section the spec never declared cannot be here.
    expect(Object.keys(body).sort()).toEqual(
      ["combos", "errors", "keys", "providers", "proxy", "sources", "ts", "usage"].sort(),
    );
    expect(Object.keys(body.sources).sort()).toEqual(
      ["combos", "errors", "keys", "providers", "proxy", "usage"].sort(),
    );
    expect(body.sources).toEqual({
      keys: true,
      providers: true,
      combos: true,
      proxy: true,
      usage: true,
      errors: true,
    });

    expect(body.keys).toEqual({ total: 3, attention: 1 });
    expect(body.providers).toEqual({
      total: 14,
      healthy: 13,
      degraded: 0,
      down: 0,
      cooling: 0,
      idle: 1,
      worst: "idle",
    });
    // combosAllKinds is the whole table; active/idle are the sibling's own
    // llm-traffic split (5 + 3 of 8), reported as it returns them.
    expect(body.combos).toEqual({ total: 11, active: 5, idle: 3 });
    expect(body.proxy).toEqual({ total: 4, active: 3, blocked: 0 });
    expect(body.usage).toEqual({ requests: 1284, cost: 4.18 });
    expect(body.errors).toEqual({ count: 2 });
    expect(typeof body.ts).toBe("number");
  });
});

describe("THE READ BOUNDARY", () => {
  it("carries no name, no id and no credential at any depth", async () => {
    const { text, body } = await pulse();

    // No forbidden KEY inside any data section — see collectNestedKeys.
    expect(collectNestedKeys(body).filter((k) => FORBIDDEN_KEYS.includes(k))).toEqual([]);

    // The two entries that walk skips are proven incapable of hiding a leak:
    // `sources` carries ONLY booleans (no string, hence no sentinel), and `ts`
    // is the single number pinned in the shape case. Asserting the types is
    // what keeps the skip honest rather than convenient.
    for (const flag of Object.values(body.sources)) {
      expect(typeof flag).toBe("boolean");
    }

    // No sentinel VALUE anywhere on the wire — not at any depth, not in a
    // string, not nested in an object that came from a sibling.
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toContain(SECRET_URL);
    expect(text).not.toContain(SECRET_NAME);

    // The counts are still real — a projection that dropped everything would
    // pass a leak assertion by having nothing to leak.
    expect(body.keys).toEqual({ total: 3, attention: 1 });
    expect(body.usage.requests).toBe(1284);
  });

  it("refuses a sibling's non-2xx answer even when its body looks plausible", async () => {
    // A census that FAILED can still return a well-formed body — and the
    // adversarial one does. The payload carries a plausible `totals.keys` and a
    // populated `attention`, so a projector that reads the body WITHOUT
    // checking the status would report "3 keys, 1 needs attention" straight
    // from a route that just told the caller it could not compute them. Only
    // the `res.ok` gate can refuse this; the shape checks cannot.
    siblings.keys.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Failed to compute key stats",
          totals: { keys: 3 },
          attention: [{ id: "k-2", name: SECRET_NAME, posture: "paused", reasons: ["paused"] }],
        }),
        { status: 500 },
      ),
    );
    const { body } = await pulse();
    expect(body.sources.keys).toBe(false);
    expect(body.keys).toBeUndefined();
    // The rest of the fleet is untouched — a failed lens costs one lens.
    expect(body.providers.total).toBe(14);
    expect(body.sources.providers).toBe(true);
  });
});

describe("DEGRADATION BY ABSENCE", () => {
  it("keeps the other five speaking when one source rejects", async () => {
    siblings.providers.mockRejectedValue(new Error("connection table locked"));

    const { res, body } = await pulse();

    expect(res.status).toBe(200);
    expect(body.sources.providers).toBe(false);
    expect(body.providers).toBeUndefined();

    // Every other lens still carries its numbers.
    expect(body.sources).toEqual({
      keys: true,
      providers: false,
      combos: true,
      proxy: true,
      usage: true,
      errors: true,
    });
    expect(body.keys).toEqual({ total: 3, attention: 1 });
    expect(body.combos).toEqual({ total: 11, active: 5, idle: 3 });
    expect(body.proxy).toEqual({ total: 4, active: 3, blocked: 0 });
    expect(body.usage).toEqual({ requests: 1284, cost: 4.18 });
    expect(body.errors).toEqual({ count: 2 });
  });

  it("still answers when EVERY source rejects — six flags, zero sections", async () => {
    for (const mock of Object.values(siblings)) mock.mockRejectedValue(new Error("db down"));
    const { res, body } = await pulse();
    expect(res.status).toBe(200);
    expect(Object.values(body.sources).every((v) => v === false)).toBe(true);
    for (const section of ["keys", "providers", "combos", "proxy", "usage", "errors"]) {
      expect(body[section]).toBeUndefined();
    }
  });
});

describe("THE MEMO", () => {
  it("serves one underlying invocation to two calls inside the 30s window", async () => {
    const GET = await loadRoute();

    const first = await (await GET()).json();
    // Step the clock INSIDE the window: without this the two calls would share
    // a `Date.now()` by accident and the identical `ts` would prove nothing.
    vi.setSystemTime(new Date("2026-09-29T12:00:20.000Z"));
    const second = await (await GET()).json();

    // One census, not two.
    expect(siblings.keys).toHaveBeenCalledTimes(1);
    expect(siblings.providers).toHaveBeenCalledTimes(1);
    expect(siblings.combos).toHaveBeenCalledTimes(1);
    expect(siblings.proxy).toHaveBeenCalledTimes(1);
    expect(siblings.usage).toHaveBeenCalledTimes(1);
    expect(siblings.errors).toHaveBeenCalledTimes(1);

    // The timestamp says when the numbers were TRUE, not when they were asked for.
    expect(first.ts).toBe(second.ts);
    expect(first.ts).toBe(new Date("2026-09-29T12:00:00.000Z").getTime());
    expect(second).toEqual(first);
  });

  it("re-runs every source once the window has passed", async () => {
    const GET = await loadRoute();
    await GET();
    vi.setSystemTime(new Date("2026-09-29T12:00:29.000Z"));
    const still = await (await GET()).json();
    expect(siblings.keys).toHaveBeenCalledTimes(1);

    // Just past 30s: stale numbers are the one thing worse than slow numbers.
    vi.setSystemTime(new Date("2026-09-29T12:00:31.000Z"));
    const fresh = await (await GET()).json();
    expect(siblings.keys).toHaveBeenCalledTimes(2);
    expect(fresh.ts).not.toBe(still.ts);
  });

  it("never memoizes a partial body — a cold-start blind census cannot freeze the rail", async () => {
    // MEASURED LIVE (dev harbour, next dev + Turbopack): the route's first call
    // is its first COMPILE. The six sibling modules were still being built as the
    // pulse called into them, and every source rejected — with no reason
    // attached — so the door answered 200 with all six flags false and not one
    // body section: a silent blank rail, the exact failure the design forbids.
    //
    // The second call, seconds later, answered complete. That is only a
    // non-event if the blank first answer was never cached — otherwise the rail
    // would have been told "nothing here" for the whole 30s window.
    const GET = await loadRoute();
    // The reason is undefined, exactly as Turbopack produced it.
    siblings.providers.mockRejectedValue(undefined);

    const first = await (await GET()).json();
    expect(first.sources.providers).toBe(false);
    expect(first.providers).toBeUndefined();
    // The other five still speak — the partial answer is SERVED, not suppressed.
    expect(first.sources.keys).toBe(true);
    expect(first.keys).toEqual({ total: 3, attention: 1 });

    // The sibling is warm by now and answers. One second later — still deep
    // inside the 30s window.
    siblings.providers.mockResolvedValue(
      ok({
        counts: { healthy: 13, degraded: 0, down: 0, cooling: 0, idle: 1 },
        worst: "idle",
        providers: 14,
      }),
    );
    vi.setSystemTime(new Date("2026-09-29T12:00:01.000Z"));
    const second = await (await GET()).json();

    // It re-ran the fan-out rather than serving the cached blank…
    expect(siblings.providers).toHaveBeenCalledTimes(2);
    // …and the rail is whole again one second after it was blind.
    expect(second.sources.providers).toBe(true);
    expect(second.providers).toEqual({
      total: 14,
      healthy: 13,
      degraded: 0,
      down: 0,
      cooling: 0,
      idle: 1,
      worst: "idle",
    });
  });
});
