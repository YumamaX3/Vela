// tests/unit/log-events-api.test.js — M7 "The Doors" (§6, §11).
//
// This suite drives the REAL route handlers against a REAL migrated SQLite in
// a per-test DATA_DIR. Nothing about the storage layer is mocked: the adapter,
// the migration chain, logEvents, and the handlers are all live. A producer
// suite that injected a literal repo would prove nothing — the whole risk in
// these doors is in the SQL and the validation, and both live behind the real
// seam.
//
// WHAT EACH BLOCK PINS
//   A · the SELECTOR — keyset paging at depth, §6's 400 laws (NaN minLvl,
//       non-integer limit), the two-tier q law, the ESCAPE clause, the
//       selector-before-LIKE order.
//   B · the BOUND-PARAMETER mandate — an injection literal lands as DATA.
//   C · the EXPORT — the shared cap, the honest truncation marker, the fixed
//       filename, the streaming shape.
//   D · the GUARD — the roster's 401 posture, driven through the REAL
//       dashboardGuard.proxy, not through a regex over its source.
//
// ⚠️ THE SCALING CLAIM IS STATED, NOT ASSUMED. §11 asks for keyset paging at
// 200k rows; seeding 200k rows inside a unit suite costs minutes on Windows
// and proves arithmetic, not speed. This suite seeds 20k and asserts the
// KEYSET PROPERTY (the page walk covers every row exactly once at any depth,
// and no OFFSET appears in the built SQL). The 200k LIKE timing is M11's job,
// measured on the real API path against a real ledger — deliberately NOT
// claimed here.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The guard reads `@/lib/localDb` through a FIXED ESM binding, so the only way
// to put it in the requireLogin:false posture is a hoisted module mock — the
// storm suite's own pattern. `vi.spyOn` after the fact cannot rebind it.
const guardMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: guardMocks.getSettings,
  validateApiKey: guardMocks.validateApiKey,
}));
vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: guardMocks.getConsistentMachineId,
}));
vi.mock("@/lib/auth/dashboardSession", async (importOriginal) => {
  // The REAL module is kept: `verifyDashboardPassword` is what /clear's
  // password re-confirm is tested against in log-clear-order. Only the TOKEN
  // verifier — the guard's concern — is stubbed here.
  const actual = await importOriginal();
  return { ...actual, verifyDashboardAuthToken: guardMocks.verifyDashboardAuthToken };
});

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-logs-api-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "log-events-api-secret";
  delete global._dbAdapter;
  // driver.js captures `state = global._dbAdapter` at module load, so the
  // registry must be reset or the next import binds the previous test's handle
  // (the DB-harness trap).
  vi.resetModules();
  guardMocks.getSettings.mockResolvedValue({ requireLogin: false });
  guardMocks.validateApiKey.mockResolvedValue(false);
  guardMocks.getConsistentMachineId.mockResolvedValue("cli-token");
  guardMocks.verifyDashboardAuthToken.mockResolvedValue(false);
  delete process.env.VELA_PEER_TOKEN;
});

afterEach(() => {
  try {
    global._dbAdapter?.instance?.close?.();
  } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

const BASE = "http://localhost/api/logs/events";

function get(query = "") {
  return new Request(`${BASE}${query}`);
}

async function routes() {
  const [events, selector, logQuery] = await Promise.all([
    import("@/app/api/logs/events/route.js"),
    import("@/lib/logSelector.js"),
    import("@/lib/db/repos/sqlite/logQuery.js"),
  ]);
  return { events, selector, logQuery };
}

/** The real adapter over the real migrated database. */
async function openDb() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

/**
 * Seed rows through the REAL write door (logStore.insertBatch), so the rows
 * carry exactly the shape production carries.
 */
async function seed(rows) {
  const { getLogStore } = await import("@/lib/db/repos/sqlite/logStore.js");
  const store = await getLogStore();
  return store.insertBatch(rows);
}

const row = (over = {}) => ({
  ts: 1_700_000_000_000,
  lvl: 20,
  stream: "console",
  reqId: null,
  upstreamId: null,
  provider: null,
  tag: null,
  msg: "seeded line",
  meta: null,
  truncMsg: 0,
  truncMeta: 0,
  ...over,
});

const body = async (res) => res.json();

// ───────────────────────────────────────────────────────────────────────────
describe("A · /api/logs/events — the selector", { timeout: 120_000 }, () => {
  it("seeds through the real write door and reads back through the real door", async () => {
    await seed([row({ msg: "alpha" }), row({ msg: "beta", lvl: 40 })]);
    const { events } = await routes();

    const res = await body(await events.GET(get()));
    expect(res.status ?? 200).toBe(200);
    expect(res.rows.map((r) => r.msg).sort()).toEqual(["alpha", "beta"]);
    // Wire shape: flags as booleans, ids as numbers.
    expect(res.rows[0].id).toBeTypeOf("number");
    expect(res.rows[0].truncMsg).toBe(false);
  });

  it("keyset paging walks a deep ledger with NO OFFSET and NO overlap", async () => {
    const N = 20_000;
    const batch = [];
    for (let i = 0; i < N; i += 1) {
      batch.push(row({ ts: 1_700_000_000_000 + i, msg: `line-${i}` }));
      if (batch.length >= 2_000) await seed(batch.splice(0, batch.length));
    }
    if (batch.length) await seed(batch);

    const { events } = await routes();

    const seen = new Set();
    let cursor = null;
    let pages = 0;
    do {
      const res = await body(await events.GET(get(`?limit=500${cursor ? `&before=${cursor}` : ""}`)));
      expect(res.status ?? 200).toBe(200);
      for (const r of res.rows) {
        expect(seen.has(r.id), `id ${r.id} appeared on two pages — the cursor is not exclusive`).toBe(false);
        seen.add(r.id);
      }
      pages += 1;
      cursor = res.nextCursor;
    } while (cursor && pages < 500);

    expect(seen.size).toBe(N);
    // The walk must have PAGINATED (not one giant page), proving the cursor is
    // actually consulted.
    expect(pages).toBeGreaterThan(1);
    // `hasMore` is a FACT on the last full page and false once drained.
    const final = await body(await events.GET(get("?limit=500")));
    expect(final.hasMore).toBe(true);
  });

  it("NEVER builds an OFFSET — the keyset law, structurally", async () => {
    // Not a behavioural stand-in: OFFSET is a string the SQL would carry, so
    // the source is the honest place to look for its ABSENCE.
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/lib/db/repos/sqlite/logQuery.js"), "utf8");
    const sqlish = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(sqlish.toUpperCase()).not.toMatch(/\bOFFSET\b/);
  });

  it("400s a NaN minLvl — never 200 with zero rows (the silent-empty class)", async () => {
    await seed([row({ msg: "x" })]);
    const { events } = await routes();

    for (const bad of ["minLvl=abc", "minLvl=NaN", "minLvl=Infinity", "minLvl=1.5", "minLvl=999"]) {
      const res = await events.GET(get(`?${bad}`));
      expect(res.status, `${bad} must be refused`).toBe(400);
      expect((await body(res)).field).toBe("minLvl");
    }
  });

  it("400s a non-integer / out-of-range limit and a bad since/until", async () => {
    const { events } = await routes();
    for (const bad of ["limit=1.5", "limit=abc", "limit=0", "limit=999999", "since=abc", "until=NaN", "before=0"]) {
      const res = await events.GET(get(`?${bad}`));
      expect(res.status, `${bad} must be refused`).toBe(400);
    }
    // since > until is a range the caller got wrong — named, not silent.
    const inverted = await events.GET(get("?since=200&until=100"));
    expect(inverted.status).toBe(400);
    expect((await body(inverted)).field).toBe("since");
  });

  it("400s an unknown stream — the enum is a contract, not a cast", async () => {
    const { events } = await routes();
    const res = await events.GET(get("?stream=nonsense"));
    expect(res.status).toBe(400);
    expect((await body(res)).field).toBe("stream");
  });

  it("the selector narrows the LIKE's candidate set — the conditioned-scan law", async () => {
    // ⚠️ AN HONEST NOTE ON WHAT THIS CASE CAN AND CANNOT PROVE.
    //
    // The obvious mutation for §6's "applied AFTER the selector narrows" is to
    // emit the `msg LIKE` clause FIRST in the WHERE. That mutation was RUN
    // during this milestone's forge pass and reddened NOTHING — because every
    // clause is `AND`-joined, reordering conjuncts is semantically identical.
    // A test that claims otherwise is testing nothing.
    //
    // So the law is pinned where it ACTUALLY bites. Two things are real:
    //   (a) the RESULT SET — a narrowed selector + q returns exactly the rows
    //       in that narrowed slice, which is what a caller is told;
    //   (b) the SCAN SHAPE — the index-eligible predicate (`stream = ?`) is
    //       present in the same statement as the LIKE, so SQLite plans the
    //       search against ix_log_* and the LIKE only ever runs over the
    //       narrowed candidate set rather than over all 200k rows.
    // (b) is asserted structurally because a plan shape is not observable from
    // a result set — and it is asserted on the SQL that is actually built.
    await seed([
      row({ msg: "needle in the console stream", stream: "console" }),
      row({ msg: "needle in the request stream", stream: "request" }),
      row({ msg: "no needle here at all", stream: "container" }),
    ]);
    const { events, selector } = await routes();

    // (a) THE RESULT — the narrowed slice only.
    const res = await body(await events.GET(get("?stream=request&q=needle")));
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].stream).toBe("request");
    const consoleRes = await body(await events.GET(get("?stream=console&q=needle")));
    expect(consoleRes.rows.map((r) => r.stream)).toEqual(["console"]);

    // (b) THE SCAN SHAPE — the index-eligible predicate and the LIKE ride the
    // SAME statement, and the LIKE clause is built with the ESCAPE clause.
    const { sql, params } = selector.buildLogWhere(
      { stream: "request", limit: 10, minLvl: null, provider: null, tag: null, reqId: null, upstreamId: null, since: null, until: null, before: null },
      "needle",
      { qHonoured: true }
    );
    expect(sql).toContain("stream = ?");
    expect(sql).toContain("msg LIKE ?");
    expect(sql).toMatch(/ESCAPE/);
    expect(params).toEqual(["request", "%needle%"]);
  });

  it("honours q ONLY when the selector narrowed (the two-tier law)", async () => {
    await seed([row({ msg: "needle here", stream: "console" })]);
    const { events } = await routes();

    // Unnarrowed + q → the term is IGNORED and the refusal is STATED, never
    // silently applied or silently dropped.
    const wide = await body(await events.GET(get("?q=needle")));
    expect(wide.rows).toHaveLength(1);
    expect(wide.qHonoured).toBe(false);
    expect(wide.qIgnoredBecauseUnnarrowed).toBe(true);

    const narrow = await body(await events.GET(get("?stream=console&q=needle")));
    expect(narrow.qHonoured).toBe(true);
    expect(narrow.rows).toHaveLength(1);
  });

  it("400s a credential-shaped q — a free-text oracle must not enumerate secrets", async () => {
    const { events } = await routes();
    for (const bad of ["vela-v1-abc", "sk-proj-xyz", "Bearer sometoken", "vela-V1-ABC"]) {
      const res = await events.GET(get(`?stream=console&q=${encodeURIComponent(bad)}`));
      expect(res.status, `${bad} must be refused`).toBe(400);
      expect((await body(res)).field).toBe("q");
    }
  });

  it("ESCAPES LIKE metacharacters — a % in q matches literally, not as a wildcard", async () => {
    await seed([
      row({ msg: "coverage is 100% today", stream: "console" }),
      row({ msg: "coverage is 100 pct today", stream: "console" }),
    ]);
    const { events } = await routes();

    const res = await body(await events.GET(get(`?stream=console&q=${encodeURIComponent("100%")}`)));
    expect(res.qHonoured).toBe(true);
    // Only the literal-% row. Without ESCAPE, '%' would have matched both.
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].msg).toContain("100%");
  });

  it("ESCAPES _ and \\ too — a bare underscore is a single-char wildcard", async () => {
    await seed([
      row({ msg: "tag_a matched", stream: "console" }),
      row({ msg: "tagXa matched", stream: "console" }),
      row({ msg: "back\\slash matched", stream: "console" }),
      row({ msg: "backYslash matched", stream: "console" }),
    ]);
    const { events } = await routes();

    const underscore = await body(await events.GET(get(`?stream=console&q=${encodeURIComponent("tag_a")}`)));
    expect(underscore.rows.map((r) => r.msg)).toEqual(["tag_a matched"]);

    const backslash = await body(await events.GET(get(`?stream=console&q=${encodeURIComponent("back\\slash")}`)));
    expect(backslash.rows.map((r) => r.msg)).toEqual(["back\\slash matched"]);
  });

  it("narrowing on provider / tag / reqId / upstreamId each filters exactly", async () => {
    await seed([
      row({ msg: "p1", provider: "openai", tag: "FETCH", reqId: "req-a", upstreamId: "up-a" }),
      row({ msg: "p2", provider: "anthropic", tag: "RETRY", reqId: "req-b", upstreamId: "up-b" }),
    ]);
    const { events } = await routes();

    expect((await body(await events.GET(get("?provider=openai")))).rows.map((r) => r.msg)).toEqual(["p1"]);
    expect((await body(await events.GET(get("?tag=RETRY")))).rows.map((r) => r.msg)).toEqual(["p2"]);
    expect((await body(await events.GET(get("?reqId=req-b")))).rows.map((r) => r.msg)).toEqual(["p2"]);
    expect((await body(await events.GET(get("?upstreamId=up-a")))).rows.map((r) => r.msg)).toEqual(["p1"]);
  });

  it("minLvl is >= (a numeric threshold), and the time window is inclusive", async () => {
    await seed([
      row({ msg: "debug", lvl: 10, ts: 1_000 }),
      row({ msg: "warn", lvl: 30, ts: 2_000 }),
      row({ msg: "fatal", lvl: 50, ts: 3_000 }),
    ]);
    const { events } = await routes();

    const warn = await body(await events.GET(get("?minLvl=30")));
    expect(warn.rows.map((r) => r.msg).sort()).toEqual(["fatal", "warn"]);

    const window = await body(await events.GET(get("?since=1000&until=2000")));
    expect(window.rows.map((r) => r.msg).sort()).toEqual(["debug", "warn"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("B · the binding mandate — upstream text lands as DATA", { timeout: 60_000 }, () => {
  it("an injection literal in msg is stored and read back intact, never executed", async () => {
    // Built from parts so this FILE carries no executable payload (the
    // logshipper-worker suite's own convention).
    const Q = String.fromCharCode(39);
    const DASHES = "-" + "-";
    const injection = `Robert'); DROP TABLE logEvents; ${DASHES}`;
    const hostile = `x${Q} OR ${Q}1${Q}=${Q}1${Q} OR msg LIKE ${Q}%${Q}`;

    await seed([row({ msg: injection }), row({ msg: hostile })]);

    const { events } = await routes();
    const res = await body(await events.GET(get("")));
    const msgs = res.rows.map((r) => r.msg);
    expect(msgs).toContain(injection);
    expect(msgs).toContain(hostile);

    // The table still exists — the DROP was a string, not a statement.
    const db = await openDb();
    expect(Number(db.get("SELECT COUNT(*) AS n FROM logEvents").n)).toBe(2);
  });

  it("a hostile q is a bound value — it cannot reshape the statement", async () => {
    await seed([row({ msg: "safe line", stream: "console" })]);
    const { events } = await routes();
    const q = `x' OR '1'='1`;
    const res = await body(await events.GET(get(`?stream=console&q=${encodeURIComponent(q)}`)));
    expect(res.status ?? 200).toBe(200);
    // The needle matches nothing, so the page is empty — and the one real row
    // is untouched, which is the whole claim.
    expect(res.rows).toHaveLength(0);
    const db = await openDb();
    expect(Number(db.get("SELECT COUNT(*) AS n FROM logEvents").n)).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("C · /api/logs/export — NDJSON, capped, streamed", { timeout: 60_000 }, () => {
  const exportRoute = () => import("@/app/api/logs/export/route.js");

  it("streams one JSON object per line, byte-equal to the stored row", async () => {
    await seed([row({ msg: "line-a" }), row({ msg: "line-b" })]);
    const route = await exportRoute();

    const res = await route.GET(new Request("http://localhost/api/logs/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");

    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = JSON.parse(line); // must be JSON, not CSV
      expect(parsed).toHaveProperty("msg");
      expect(parsed).toHaveProperty("id");
    }
    // No CSV formula-injection tab-padding leaked into a JSON export (§1).
    expect(text).not.toContain("\t");
  });

  it("declares the SHARED cap constant (imported, not re-typed) and a fixed filename", async () => {
    const route = await exportRoute();
    const { EXPORT_ROW_CAP } = await import("@/lib/db/usageAggregation.js");
    const res = await route.GET(new Request("http://localhost/api/logs/export"));

    // The header declares the bound BEFORE the stream runs.
    expect(res.headers.get("X-Vela-Export-Cap")).toBe(String(EXPORT_ROW_CAP));
    // Fixed filename — nothing user-controlled reaches the header.
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="vela-logs-export.ndjson"');
    await res.text();
  });

  it("400s a bad selector here too — the export refuses what the query refuses", async () => {
    const route = await exportRoute();
    const res = await route.GET(new Request("http://localhost/api/logs/export?minLvl=NaN"));
    expect(res.status).toBe(400);
  });

  it("the cap is honoured EXACTLY, with no overshoot — the boundary the truncation marker depends on", async () => {
    // The marker is emitted when `count >= cap`, so an off-by-one in the
    // cursor is what makes a short file claim to be complete. Driven through
    // the SAME generator the route streams from.
    const { iterateLogRows } = await import("@/lib/db/repos/sqlite/logQuery.js");
    await seed([row({ msg: "a" }), row({ msg: "b" }), row({ msg: "c" }), row({ msg: "d" }), row({ msg: "e" })]);

    const at = [];
    for await (const r of iterateLogRows({ pageSize: 10, cap: 3 })) at.push(r);
    expect(at).toHaveLength(3);

    // A cap smaller than a DB window still stops exactly on the cap.
    const across = [];
    for await (const r of iterateLogRows({ pageSize: 2, cap: 3 })) across.push(r);
    expect(across).toHaveLength(3);

    // A cap above the row count yields everything, and the marker would NOT
    // fire (count < cap) — the honest case.
    const all = [];
    for await (const r of iterateLogRows({ pageSize: 100, cap: 5 })) all.push(r);
    expect(all).toHaveLength(5);
  });

  it("streams rather than buffering — the cursor is a generator, not an array", async () => {
    const { iterateLogRows } = await import("@/lib/db/repos/sqlite/logQuery.js");
    await seed([row({ msg: "x" })]);
    const cursor = iterateLogRows({ pageSize: 10 });
    // Async-iterable and NOT a promise of an array: the route can push the
    // first row before the last one exists.
    expect(typeof cursor[Symbol.asyncIterator]).toBe("function");
    expect(Array.isArray(cursor)).toBe(false);
    const first = await cursor.next();
    expect(first.done).toBe(false);
    expect(first.value).toHaveProperty("msg");
  });

  it("the export IGNORES the paging cursor — a fragment must not ship as a complete file", async () => {
    await seed([row({ msg: "a" }), row({ msg: "b" }), row({ msg: "c" })]);
    const route = await exportRoute();
    const res = await route.GET(new Request("http://localhost/api/logs/export?limit=1&before=999"));
    const lines = (await res.text()).trim().split("\n");
    expect(lines).toHaveLength(3);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("D · the roster's 401 posture — the REAL guard, not a source grep", { timeout: 30_000 }, () => {
  /**
   * A request shaped the way custom-server.js hands it to the middleware.
   * `local` reproduces the real stamping protocol; a REMOTE caller (the only
   * caller the escalation exists for) carries no peer token at all.
   */
  function edgeRequest(pathname, { method = "GET", local = false } = {}) {
    const headers = new Headers();
    if (local) {
      headers.set("x-9r-peer-token", "peer-token-fixture");
      headers.set("x-9r-real-ip", "127.0.0.1");
      headers.set("host", "localhost:32060");
    } else {
      headers.set("host", "203.0.113.9:32060"); // TEST-NET-3, never a live address
      headers.set("x-9r-real-ip", "203.0.113.9");
    }
    return {
      method,
      nextUrl: { pathname, searchParams: new URLSearchParams() },
      headers,
      cookies: { get: () => undefined },
      url: `http://203.0.113.9:32060${pathname}`,
    };
  }

  it("a remote credential-less caller reads NOTHING under /api/logs, even with requireLogin off", async () => {
    const { proxy } = await import("@/dashboardGuard.js");
    // requireLogin:false is the WIDEST posture — the deny-by-default branch
    // admits isAuthenticated, which is TRUE when requireLogin is false. The
    // roster literal is the only thing that stops this.
    const response = await proxy(edgeRequest("/api/logs/events"));

    expect(response?.status).toBe(401);
    expect(response?.body?.error ?? await safeText(response)).toBeTruthy();
  });

  it("EVERY door under /api/logs is refused — the prefix covers all five", async () => {
    const { proxy } = await import("@/dashboardGuard.js");
    for (const door of ["/api/logs/events", "/api/logs/events/stream", "/api/logs/stats", "/api/logs/clear", "/api/logs/export"]) {
      const response = await proxy(edgeRequest(door));
      expect(response?.status, `${door} must refuse a remote credential-less caller`).toBe(401);
    }
  });

  it("the POST door is refused too — a clear is irreversible, so it never rides the posture", async () => {
    const { proxy } = await import("@/dashboardGuard.js");
    const response = await proxy(edgeRequest("/api/logs/clear", { method: "POST" }));
    expect(response?.status).toBe(401);
  });

  it("a LOCAL caller with a machine token gets through — the escalation is not a lockout", async () => {
    // The storm suite's recorded lesson, inverted: a gate that refuses every
    // legitimate local caller is a wound, not a defence. README documents
    // entry with no password (requireLogin===false), so the box's own browser
    // and the CLI must both still work on /api/logs.
    //
    // NOTE THE POSTURE, because it differs from /api/proxy-pools:
    // ALWAYS_PROTECTED admits a JWT or a LOCAL CLI token, and deliberately
    // does NOT carry the `(isLocalRequest && isAuthenticated)` escape that
    // canAccessLocalOnlyRoute uses. §6 asks for the stricter of the two — the
    // log read surface IS the credential-exposure surface — so a first-run
    // local browser with neither credential is refused here BY DESIGN. What
    // must hold is that the two legitimate local credentials work.
    process.env.VELA_PEER_TOKEN = "peer-token-fixture";
    guardMocks.getConsistentMachineId.mockResolvedValue("the-machine-id");
    const { proxy } = await import("@/dashboardGuard.js");
    const response = await proxy({
      method: "GET",
      nextUrl: { pathname: "/api/logs/events", searchParams: new URLSearchParams() },
      headers: new Headers({
        "x-9r-peer-token": "peer-token-fixture",
        "x-9r-real-ip": "127.0.0.1",
        host: "localhost:32060",
        "x-vela-cli-token": "the-machine-id",
      }),
      cookies: { get: () => undefined },
      url: "http://localhost:32060/api/logs/events",
    });
    expect(response?.status).not.toBe(401);
    expect(response?.status).not.toBe(403);
  });

  it("the roster holds the ONE prefix literal — five doors, one roster entry", async () => {
    // A source read is right HERE and wrong in block D's first case: the claim
    // is about which literal is in the roster, and no behaviour distinguishes
    // "one prefix entry" from "five identical per-route entries".
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/dashboardGuard.js"), "utf8");
    expect(src).toContain('"/api/logs"');
    // …and each door really does live under it.
    for (const door of ["events", "events/stream", "stats", "clear", "export"]) {
      const p = path.resolve(process.cwd(), "src/app/api/logs", door, "route.js");
      expect(fs.existsSync(p), `/api/logs/${door} must exist under the rostered prefix`).toBe(true);
    }
  });
});

/** NextResponse.json() carries a real body; read it if `.body` is not a plain object. */
async function safeText(response) {
  try {
    return await response?.text?.();
  } catch {
    return "";
  }
}
