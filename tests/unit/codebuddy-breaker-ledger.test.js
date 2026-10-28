// The ledger adapter, proven against a REAL sqlite — not a mock.
//
// The point of binding the CodeBuddy breaker to `circuitBreakerKeys` is that the
// cooldown lands in Vela's own store and survives a restart. A mocked repo would
// prove only that the mock was called, so this suite drives node:sqlite with the
// real table shape (migration 019's NOT NULL columns included) and then reads the
// rows back.
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  PersistentBreakerStore,
  BREAKER_STORE_VERSION,
} from "../../open-sse/shared/codebuddy/breakerStore.js";
import { createLedgerStorage, CODEBUDDY_BREAKER_POOL } from "../../open-sse/shared/codebuddy/breakerLedger.js";

function makeAdapter(handle) {
  return {
    run: (sql, params = []) => handle.prepare(sql).run(...params),
    get: (sql, params = []) => handle.prepare(sql).get(...params),
    all: (sql, params = []) => handle.prepare(sql).all(...params),
    exec: (sql) => handle.exec(sql),
    transaction: (fn) => fn(),
    close: () => handle.close(),
    raw: handle,
  };
}

let db;
let storage;

beforeEach(() => {
  const handle = new DatabaseSync(":memory:");
  db = makeAdapter(handle);
  db.exec(`
    CREATE TABLE circuitBreakerKeys (
      poolId TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'healthy',
      failureCount INTEGER NOT NULL DEFAULT 0,
      lastFailureAt TEXT,
      cooldownUntil INTEGER,
      retryAfterMs INTEGER,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (poolId, provider, model)
    )
  `);
  storage = createLedgerStorage(db);
});

const KEY = "conn-42";
const rows = () => db.all("SELECT * FROM circuitBreakerKeys");

describe("nothing known reads as nothing", () => {
  it("returns null on an empty ledger", () => {
    expect(storage.read()).toBe(null);
  });

  it("ignores other pools and other providers", () => {
    db.run(
      `INSERT INTO circuitBreakerKeys (poolId, provider, model, state, cooldownUntil, updatedAt)
       VALUES (?, ?, ?, 'open', ?, ?)`,
      ["another-pool", "codebuddy-intl", "k", Date.now() + 60_000, new Date().toISOString()],
    );
    db.run(
      `INSERT INTO circuitBreakerKeys (poolId, provider, model, state, cooldownUntil, updatedAt)
       VALUES (?, ?, ?, 'open', ?, ?)`,
      [CODEBUDDY_BREAKER_POOL, "openai", "k", Date.now() + 60_000, new Date().toISOString()],
    );
    expect(storage.read()).toBe(null);
  });
});

describe("a cooldown written survives a restart", () => {
  it("round-trips through the real table", () => {
    const until = Date.now() + 30_000;
    const store = new PersistentBreakerStore({ storage });
    expect(store.fail(KEY, { until, reason: "channel" })).toBe(true);

    const written = rows();
    expect(written.length).toBe(1);
    expect(written[0].poolId).toBe(CODEBUDDY_BREAKER_POOL);
    expect(written[0].model).toBe(KEY);
    expect(Number(written[0].cooldownUntil)).toBe(until);

    // A fresh store over the same ledger — the restart path.
    const revived = new PersistentBreakerStore({ storage });
    expect(revived.admit(KEY)).toBe(false);
    expect(revived.openUntil(KEY)).toBe(until);
  });

  it("clears the row on success", () => {
    const store = new PersistentBreakerStore({ storage });
    store.fail(KEY, { until: Date.now() + 30_000 });
    store.succeed(KEY);
    expect(rows().length).toBe(0);
    expect(new PersistentBreakerStore({ storage }).admit(KEY)).toBe(true);
  });

  it("removes a row the snapshot no longer names, so it cannot resurrect", () => {
    const store = new PersistentBreakerStore({ storage });
    store.fail(KEY, { until: Date.now() + 30_000 });
    store.fail("conn-99", { until: Date.now() + 30_000 });
    expect(rows().length).toBe(2);
    store.succeed(KEY);
    expect(rows().length).toBe(1);
    expect(rows()[0].model).toBe("conn-99");
  });
});

describe("the read shape is the store's own snapshot", () => {
  it("serializes to a document the store accepts", () => {
    const store = new PersistentBreakerStore({ storage });
    store.fail(KEY, { until: Date.now() + 30_000, reason: "channel" });
    const raw = storage.read();
    const doc = JSON.parse(raw);
    expect(doc.version).toBe(BREAKER_STORE_VERSION);
    expect(Object.keys(doc.accounts)).toEqual([KEY]);
    expect(typeof doc.accounts[KEY].failUntil).toBe("number");
  });

  it("refuses to write a snapshot with no accounts map", () => {
    expect(() => storage.write(JSON.stringify({ version: 1 }))).toThrow(/no accounts map/);
    expect(() => storage.write("not json")).toThrow();
  });
});
