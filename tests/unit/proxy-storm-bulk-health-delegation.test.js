/**
 * PROXY STORM — BULK-HEALTH DELEGATION (milestone 0.6, LIVE-B)
 *
 * The wound: `src/app/api/proxy-pools/bulk-health/route.js` carried its OWN copy
 * of the health loop, forked before v0.9.42 and never reached by Wave 0 — which
 * repaired the engine (`checkAllPools` / `checkPoolHealth`) and had no reason to
 * look at a route that had already duplicated it. Three defects in twenty lines:
 *
 *   B1 `if (autoDisable && !result.ok)` deactivated a pool on ANY failure —
 *      timeout, 5xx, or a throw in the probe's own path. Wave 0's law: only a
 *      DETERMINISTIC verdict may deactivate. The law exists because the fleet
 *      once self-liquidated (a missing import threw, the throw read as
 *      `{ok:false}`, every pool was disabled, and it replicated to the live
 *      MariaDB twin).
 *   B2 No `indeterminate` bucket — three states collapsed to two, so an
 *      indeterminate probe was REPORTED as dead.
 *   B3 `checkPoolHealth(pool.id)` re-fetched a row the route already held — an
 *      N+1 across the whole fleet.
 *
 * The repair removed the second copy rather than fixing it (ADR §15.1's counsel
 * (a)): `checkAllPools` now returns the `results` array it had always built
 * internally, and the route is a thin pass-through. So what this storm must prove
 * is DELEGATION — that there is one loop, not two.
 *
 * ⚠️ WHY EVERY ASSERTION HERE IS BEHAVIOURAL, NOT A SOURCE GREP: the repaired
 * route file deliberately CONTAINS the strings `!result.ok`, `result.ok` and
 * `updateProxyPool` — inside the comment block explaining the wound it no longer
 * has. A negative-regex source guard ("the route must not mention result.ok")
 * would therefore fail on the documentation of the fix, and a positive one would
 * pass on the comment alone. That is the recorded `negative-regex-source-guard-
 * defeated-by-comment` lesson; the guard here is that the route touches neither
 * the pool listing nor the pool writer at all, which only real code can violate.
 *
 * Provenance: plans/vela-proxy-fleet-rebirth.md §15.1 (LIVE-B) and §15.4 (the
 * endpoint is dead today but milestone 6 wires it, so it must be correct first).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// The engine, mocked whole: this suite is about the ROUTE's shape and its
// delegation, not about classification (storm 1 owns that, against the real
// chain). Mocking the named export the route binds is also what makes the
// delegation assertion possible — a route with its own loop would never call it.
const fleetMocks = vi.hoisted(() => ({
  checkAllPools: vi.fn(),
  checkPoolHealth: vi.fn(),
}));

// The DB surface the OLD route reached for directly (`getProxyPools` at its :18,
// `updateProxyPool` at its :34-35). The new route imports neither. Mocking them
// anyway is the point: if a future edit re-grows the loop, these spies fire and
// S2/S3 go red.
const dbMocks = vi.hoisted(() => ({
  getProxyPools: vi.fn(),
  updateProxyPool: vi.fn(),
  getProxyPoolById: vi.fn(),
}));

vi.mock("@/lib/network/proxyFleet.js", () => fleetMocks);
vi.mock("@/lib/localDb", () => dbMocks);

// tests/unit/ → repo root is `../../`, matching storm 1's
// `await import("../../src/lib/network/proxyFleet.js")`.
const { POST } = await import("../../src/app/api/proxy-pools/bulk-health/route.js");

/** A real Request — the handler reads its body via `request.json()`. */
const post = (body) =>
  new Request("http://127.0.0.1:32060/api/proxy-pools/bulk-health", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** What the repaired engine returns — counts AND the per-pool array. */
const ENGINE_RESULT = {
  total: 3,
  alive: 1,
  dead: 1,
  indeterminate: 1,
  results: [
    { poolId: "alive-one", ok: true, verdict: "alive", elapsedMs: 40, error: null, status: 200 },
    { poolId: "dead-one", ok: false, verdict: "dead", elapsedMs: 12, error: "Bad Request", status: 400 },
    // The shape the OLD route could not express: not-ok, but NOT dead.
    { poolId: "unsure-one", ok: false, verdict: "indeterminate", elapsedMs: 8000, error: "ETIMEDOUT", status: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  fleetMocks.checkAllPools.mockResolvedValue(ENGINE_RESULT);
});

describe("S1 — the route delegates: one loop, not two", () => {
  it("S1.1 calls checkAllPools and passes the operator's options straight through", async () => {
    const res = await POST(post({ autoDisable: true, concurrency: 8 }));

    expect(fleetMocks.checkAllPools).toHaveBeenCalledTimes(1);
    expect(fleetMocks.checkAllPools).toHaveBeenCalledWith({ autoDisable: true, concurrency: 8 });
    expect(res.status).toBe(200);
  });

  it("S1.2 returns the engine's payload verbatim — no re-counting, no reshaping", async () => {
    const res = await POST(post({ autoDisable: false }));
    const body = await res.json();

    // Verbatim. A second copy of the loop would produce its own counts and its
    // own `results` entries (the old route pushed only {poolId, ok, elapsedMs}).
    expect(body).toEqual(ENGINE_RESULT);
    expect(body.results).toHaveLength(3);
    expect(body.results[2]).toMatchObject({ poolId: "unsure-one", verdict: "indeterminate" });
  });

  it("S1.3 defaults: autoDisable is false and concurrency is null (the engine's dynamic value)", async () => {
    await POST(post({}));

    // `concurrency: null` is the load-bearing half — the old default of 4 pinned
    // a 1,000-pool sweep to ~250s, while the scheduler has always used the
    // engine's min(16, max(4, ceil(N/50))).
    expect(fleetMocks.checkAllPools).toHaveBeenCalledWith({ autoDisable: false, concurrency: null });
  });

  it("S1.4 a bodyless POST does not 400 on JSON parsing — it uses the defaults", async () => {
    // The old route called `request.json()` unguarded, so an empty body threw
    // SyntaxError into the catch and reported a generic 500. `.catch(() => ({}))`
    // makes "no body" mean "no options".
    const res = await POST(post(undefined));

    expect(res.status).toBe(200);
    expect(fleetMocks.checkAllPools).toHaveBeenCalledWith({ autoDisable: false, concurrency: null });
  });
});

describe("S2 — the duplicate loop is GONE (the N+1 and the direct DB writes)", () => {
  it("S2.1 the route never lists pools itself — no row is fetched twice", async () => {
    // B3. The old route did `getProxyPools({isActive:true})` and then called
    // `checkPoolHealth(pool.id)` per pool, which re-fetched each row the route
    // already held. The engine passes the row instead; the route holds none.
    await POST(post({ autoDisable: true, concurrency: 5 }));

    expect(dbMocks.getProxyPools).not.toHaveBeenCalled();
    expect(dbMocks.getProxyPoolById).not.toHaveBeenCalled();
    expect(fleetMocks.checkPoolHealth).not.toHaveBeenCalled();
  });

  it("S2.2 the route never deactivates a pool itself, even with autoDisable on", async () => {
    // B1, proved from the caller's side: deactivation is the ENGINE's decision
    // now, gated on `verdict === "dead"`. The route has no path to a write, so
    // an indeterminate pool can never be liquidated through this endpoint.
    const res = await POST(post({ autoDisable: true }));

    expect(dbMocks.updateProxyPool).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    // And the engine was told the operator wanted auto-disable — the route
    // forwards the intent rather than acting on it.
    expect(fleetMocks.checkAllPools).toHaveBeenCalledWith(
      expect.objectContaining({ autoDisable: true }),
    );
  });

  it("S2.3 the indeterminate bucket reaches the wire — three states, not two", async () => {
    // B2. Under the old route this response was `{total:3, alive:1, dead:2}`:
    // the timed-out pool counted as dead whether or not it was disabled.
    const res = await POST(post({}));
    const body = await res.json();

    expect(body).toHaveProperty("indeterminate", 1);
    expect(body).toHaveProperty("dead", 1);
    expect(body).toHaveProperty("alive", 1);
    // The counts must reconcile — no pool counted twice or dropped.
    expect(body.alive + body.dead + body.indeterminate).toBe(body.total);
  });
});

describe("S3 — the loud-failure contract (silence is the original sin)", () => {
  it("S3.1 a null from the engine is a 500, never an empty 200", async () => {
    // `checkAllPools` catches internally and returns null when the pool listing
    // itself throws. Rendering that as `{total:0, alive:0, dead:0}` would read
    // as "the fleet is healthy" — the exact shape of silence that let the
    // self-liquidation run unnoticed for months.
    fleetMocks.checkAllPools.mockResolvedValue(null);

    const res = await POST(post({}));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "health check failed" });
  });

  it("S3.2 a throw out of the engine is a 500 with the generic message — no internals on the wire", async () => {
    fleetMocks.checkAllPools.mockRejectedValue(new Error("sqlite master table is locked"));

    const res = await POST(post({}));
    const body = await res.json();

    expect(res.status).toBe(500);
    // The operator's own message must not leak (rules/security.md — error
    // envelope discipline); the route logs it server-side instead.
    expect(body).toEqual({ error: "health check failed" });
    expect(JSON.stringify(body)).not.toMatch(/locked|sqlite/i);
  });
});

describe("S4 — the concurrency gate still guards the boundary", () => {
  // ⚠️ NaN is deliberately NOT in this list. `JSON.stringify({concurrency: NaN})`
  // emits `{"concurrency":null}`, so NaN cannot cross the wire — a body carrying
  // it arrives as null, which S4.3 proves is the documented "engine default" and
  // MUST be accepted. Listing NaN here would assert a 400 against a request the
  // route is correct to serve. Same for `undefined`: JSON drops the key, and the
  // destructuring default (`concurrency = null`) then applies.
  it.each([0, -1, 21, 1.5, "8", true])("S4.1 rejects an out-of-range or non-integer cap: %s", async (bad) => {
    const res = await POST(post({ concurrency: bad }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "concurrency must be 1-20" });
    // Rejected BEFORE any work — the engine is never reached.
    expect(fleetMocks.checkAllPools).not.toHaveBeenCalled();
  });

  it.each([1, 4, 20])("S4.2 accepts an explicit in-range cap: %s", async (good) => {
    const res = await POST(post({ concurrency: good }));

    expect(res.status).toBe(200);
    expect(fleetMocks.checkAllPools).toHaveBeenCalledWith({ autoDisable: false, concurrency: good });
  });

  it("S4.3 null is accepted as 'use the engine default' — it is not an out-of-range value", async () => {
    // `null` must reach the engine as null. Treating it as invalid would make
    // the documented default unreachable through an explicit body.
    const res = await POST(post({ concurrency: null }));

    expect(res.status).toBe(200);
    expect(fleetMocks.checkAllPools).toHaveBeenCalledWith({ autoDisable: false, concurrency: null });
  });

  it("S4.4 autoDisable is coerced, so a truthy non-boolean cannot reach the engine as-is", async () => {
    // `!!autoDisable` — the engine's `if (autoDisable && …)` would accept any
    // truthy value, and this is a deactivation switch on an operator's fleet.
    await POST(post({ autoDisable: "yes-please" }));

    expect(fleetMocks.checkAllPools).toHaveBeenCalledWith({ autoDisable: true, concurrency: null });

    await POST(post({ autoDisable: 0 }));
    expect(fleetMocks.checkAllPools).toHaveBeenLastCalledWith({ autoDisable: false, concurrency: null });
  });
});
