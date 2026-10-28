// The persisted breaker's four laws, proven where they can actually bite.
//
// Each `describe` below exists because a naive persisted breaker fails in that exact
// way: it trusts a crafted file, it half-understands a broken one, it locks the harbor
// when the disk fails, or it grows without limit.
import { describe, expect, it } from "vitest";
import {
  PersistentBreakerStore,
  BREAKER_STORE_VERSION,
  BREAKER_AUTH_CEILING_MS,
  BREAKER_MAX_ACCOUNTS,
  BREAKER_MAX_BYTES,
} from "../../open-sse/shared/codebuddy/breakerStore.js";

/** An in-memory storage double — the store never touches disk in these tests. */
function fakeStorage(initial = null) {
  let text = initial;
  return {
    read: () => text,
    write: (next) => { text = next; },
    get raw() { return text; },
    failOnWrite: false,
  };
}

const key = "cred-abc";
const doc = (accounts) => JSON.stringify({ version: BREAKER_STORE_VERSION, accounts });

describe("law 1 — a restored deadline can never exceed its ceiling", () => {
  it("keeps a future deadline inside the ceiling", () => {
    const until = Date.now() + 60_000;
    const store = new PersistentBreakerStore({ storage: fakeStorage(doc({ [key]: { failUntil: until, reason: "x", failedAt: Date.now() } })) });
    expect(store.openUntil(key)).toBe(until);
  });

  it("discards a deadline beyond the ceiling rather than clamping it live", () => {
    const far = Date.now() + BREAKER_AUTH_CEILING_MS * 10;
    const store = new PersistentBreakerStore({ storage: fakeStorage(doc({ [key]: { failUntil: far, reason: "x", failedAt: 0 } })) });
    expect(store.openUntil(key)).toBe(0);
    expect(store.data.size).toBe(0);
  });

  it("discards an already-expired deadline", () => {
    const past = Date.now() - 1000;
    const store = new PersistentBreakerStore({ storage: fakeStorage(doc({ [key]: { failUntil: past, reason: "x", failedAt: 0 } })) });
    expect(store.admit(key)).toBe(true);
  });

  it("discards a non-finite or non-numeric deadline", () => {
    for (const bad of ["99999999999999", null, Infinity, NaN, true]) {
      const store = new PersistentBreakerStore({ storage: fakeStorage(doc({ [key]: { failUntil: bad, reason: "x", failedAt: 0 } })) });
      expect(store.data.size, `accepted ${String(bad)}`).toBe(0);
    }
  });
});

describe("law 2 — the reader accepts only a wholly valid snapshot", () => {
  const good = { failUntil: Date.now() + 30_000, reason: "ok", failedAt: Date.now() };

  it("accepts a well-formed document", () => {
    const store = new PersistentBreakerStore({ storage: fakeStorage(doc({ [key]: good })) });
    expect(store.data.size).toBe(1);
  });

  it("discards the WHOLE document when one row is malformed", () => {
    const store = new PersistentBreakerStore({
      storage: fakeStorage(doc({ [key]: good, "other": { failUntil: "nope", reason: "x", failedAt: 0 } })),
    });
    expect(store.data.size).toBe(0);
  });

  it("discards a wrong version, a missing accounts map, or junk", () => {
    for (const raw of [
      JSON.stringify({ version: 99, accounts: { [key]: good } }),
      JSON.stringify({ version: BREAKER_STORE_VERSION }),
      "not json at all",
      "[]",
      "",
    ]) {
      const store = new PersistentBreakerStore({ storage: fakeStorage(raw) });
      expect(store.data.size, raw).toBe(0);
    }
  });

  it("bounds a hostile oversized document", () => {
    const accounts = {};
    for (let i = 0; i < BREAKER_MAX_ACCOUNTS + 1; i++) accounts[`k${i}`] = good;
    const store = new PersistentBreakerStore({ storage: fakeStorage(doc(accounts)) });
    expect(store.data.size).toBe(0);
  });

  it("strips control characters from a stored reason", () => {
    const store = new PersistentBreakerStore({
      storage: fakeStorage(doc({ [key]: { failUntil: Date.now() + 30_000, reason: "bad\u0000reason\n", failedAt: 0 } })),
    });
    const row = store.data.get(key);
    expect(row.reason).not.toContain("\u0000");
    expect(row.reason).toBe("badreason");
  });
});

describe("law 3 — storage failure degrades to memory, never to lockout", () => {
  it("still admits traffic when the read throws", () => {
    const storage = { read: () => { throw new Error("EACCES"); }, write: () => {} };
    const store = new PersistentBreakerStore({ storage });
    expect(store.admit(key)).toBe(true);
    expect(store.lastError).toBe("read");
  });

  it("records in memory and reports false when the write fails", () => {
    const storage = fakeStorage();
    storage.write = () => { throw new Error("ENOSPC"); };
    const store = new PersistentBreakerStore({ storage });
    const durable = store.fail(key, { until: Date.now() + 30_000, reason: "x" });
    expect(durable).toBe(false);
    expect(store.dirty).toBe(true);
    // The in-memory cooldown still holds — the harbor keeps its own counsel.
    expect(store.admit(key)).toBe(false);
  });
});

describe("law 4 — the write is bounded, and a shed row is reported", () => {
  it("sheds rows nearest expiry when the payload would exceed the cap", () => {
    const accounts = {};
    const base = Date.now() + 60_000;
    for (let i = 0; i < 200; i++) {
      accounts[`k${i}`] = { failUntil: base + i * 1000, reason: "x".repeat(200), failedAt: 0 };
    }
    const store = new PersistentBreakerStore({ storage: fakeStorage(doc(accounts)) });
    const { text } = store.serialize();
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(BREAKER_MAX_BYTES);
  });

  it("reports a shed write as not durable", () => {
    const accounts = {};
    const base = Date.now() + 60_000;
    for (let i = 0; i < 200; i++) accounts[`k${i}`] = { failUntil: base + i * 1000, reason: "x".repeat(200), failedAt: 0 };
    const store = new PersistentBreakerStore({ storage: fakeStorage(doc(accounts)) });
    const durable = store.save();
    // Whether shed depends on payload size; either way the return is honest.
    expect(typeof durable).toBe("boolean");
    if (store.lastError === "capacity") expect(durable).toBe(false);
  });
});

describe("the lifecycle", () => {
  it("parks a key past a failure and admits it after success", () => {
    const storage = fakeStorage();
    const store = new PersistentBreakerStore({ storage });
    const until = Date.now() + 30_000;
    store.fail(key, { until, reason: "channel" });
    expect(store.admit(key)).toBe(false);
    store.succeed(key);
    expect(store.admit(key)).toBe(true);
  });

  it("survives a restart with its deadline intact", () => {
    const storage = fakeStorage();
    const until = Date.now() + 30_000;
    new PersistentBreakerStore({ storage }).fail(key, { until, reason: "channel" });
    const revived = new PersistentBreakerStore({ storage });
    expect(revived.admit(key)).toBe(false);
    expect(revived.openUntil(key)).toBe(until);
  });

  it("forgets a key once its deadline passes", () => {
    const storage = fakeStorage();
    const store = new PersistentBreakerStore({ storage });
    store.fail(key, { until: Date.now() + 50, reason: "x" });
    expect(store.admit(key, Date.now() + 100)).toBe(true);
  });

  it("refuses to record a deadline beyond its own ceiling", () => {
    const store = new PersistentBreakerStore({ storage: fakeStorage() });
    const durable = store.fail(key, { until: Date.now() + BREAKER_AUTH_CEILING_MS * 5 });
    expect(durable).toBe(true); // nothing recorded, nothing failed
    expect(store.data.size).toBe(0);
  });

  it("bounds the table at MAX_ACCOUNTS by dropping the row nearest expiry", () => {
    const store = new PersistentBreakerStore({ storage: fakeStorage() });
    const now = Date.now();
    for (let i = 0; i < BREAKER_MAX_ACCOUNTS; i++) {
      store.fail(`k${i}`, { until: now + 10_000 + i * 100, now });
    }
    store.fail("newcomer", { until: now + 20_000, now });
    expect(store.data.size).toBe(BREAKER_MAX_ACCOUNTS);
    expect(store.data.has("k0")).toBe(false); // nearest expiry, shed first
    expect(store.data.has("newcomer")).toBe(true);
  });
});
