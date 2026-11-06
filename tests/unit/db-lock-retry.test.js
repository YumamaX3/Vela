import { describe, it, expect } from "vitest";
import { withLockRetry, isLockProtocolError } from "@/lib/db/helpers/lockRetry.js";

describe("db lock-protocol retry", () => {
  it("retries SQLITE_PROTOCOL and succeeds, re-running the whole fn", () => {
    let calls = 0;
    const txn = withLockRetry((fn) => fn());
    const out = txn(() => {
      calls += 1;
      if (calls < 3) { const e = new Error("locking protocol"); e.code = "SQLITE_PROTOCOL"; throw e; }
      return "sailed";
    });
    expect(out).toBe("sailed");
    expect(calls).toBe(3);
  });

  it("retries by message shape even without a code", () => {
    let calls = 0;
    const txn = withLockRetry((fn) => fn());
    expect(txn(() => { calls += 1; if (calls === 1) throw new Error("database is locked (SQLITE_BUSY)"); return 7; })).toBe(7);
    expect(calls).toBe(2);
  });

  it("never retries non-lock errors", () => {
    let calls = 0;
    const txn = withLockRetry((fn) => fn());
    expect(() => txn(() => { calls += 1; throw new Error("UNIQUE constraint failed: x.key"); }))
      .toThrow(/UNIQUE constraint/);
    expect(calls).toBe(1);
  });

  it("gives up after the cap with the LAST error", () => {
    let calls = 0;
    const txn = withLockRetry((fn) => fn());
    expect(() => txn(() => { calls += 1; const e = new Error("locking protocol"); e.code = "SQLITE_PROTOCOL"; throw e; }))
      .toThrow(/locking protocol/);
    expect(calls).toBe(4);
  });

  it("classifies SQLITE_BUSY family as lock errors", () => {
    expect(isLockProtocolError({ code: "SQLITE_BUSY" })).toBe(true);
    expect(isLockProtocolError({ code: "SQLITE_PROTOCOL" })).toBe(true);
    expect(isLockProtocolError({ code: "SQLITE_CORRUPT" })).toBe(false);
    expect(isLockProtocolError(null)).toBe(false);
  });
});
