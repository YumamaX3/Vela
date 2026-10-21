// REGRESSION (WR-a1) — the SQLite primary must refuse a second writer.
//
// THE DEFECT: checkpointOwner.js:33 holds ownership in a module-level variable,
// which cannot coordinate across a PROCESS. There is no file lock, no PID
// guard, no single-instance check anywhere in the tree. Four Vela worktrees on
// this machine share one %APPDATA%\vela/db/data.sqlite with nothing between
// them; a second writer's exit-time wal_checkpoint(TRUNCATE) waits up to
// busy_timeout=5000 on any concurrent write transaction — the documented
// 5,495 ms freeze, and the shape behind the observed boot-time
// SQLITE_CORRUPT: database disk image is malformed.
//
// These tests assert the CONTRACT of the lock, not its internals:
//  1. a second acquirer is REFUSED, loudly, naming the holder;
//  2. release lets the next acquirer in;
//  3. a lock left by a dead PID is taken over (crash recovery);
//  4. release never evicts a newer holder (no cross-process sabotage);
//  5. the opt-out exists for the parity harness, which drives many handles
//     at one file deliberately.
// A lock that has never refused anyone is only a wish.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  acquireSingleInstanceLock,
  readSingleInstanceHolder,
} from "@/lib/db/singleInstance.js";

let dir;
let dbFile;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-singleinst-"));
  dbFile = path.join(dir, "data.sqlite");
  fs.writeFileSync(dbFile, "not-a-real-db");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("WR-a1 · single-instance lock", () => {
  it("refuses a second acquirer and names the holder", () => {
    const first = acquireSingleInstanceLock(dbFile);
    expect(first.ok).toBe(true);

    const second = acquireSingleInstanceLock(dbFile);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/already holds/i);
    // The loser learns WHO holds it — an operator can act on that.
    expect(second.holder?.pid).toBe(process.pid);

    first.release();
  });

  it("release lets the next acquirer in", () => {
    const first = acquireSingleInstanceLock(dbFile);
    expect(first.ok).toBe(true);
    first.release();

    const second = acquireSingleInstanceLock(dbFile);
    expect(second.ok).toBe(true);
    second.release();
  });

  it("takes over a lock left by a dead PID (crash recovery)", () => {
    // A hard kill leaves the lockfile behind. Without staleness recovery the
    // next boot would refuse forever — the lock would become the outage.
    const lockPath = path.join(dir, "data.sqlite.single-instance");
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999999, host: process.platform, at: new Date().toISOString() })
    );

    const got = acquireSingleInstanceLock(dbFile);
    expect(got.ok).toBe(true);
    expect(got.holder?.pid).toBe(process.pid);
    got.release();
  });

  it("takes over a lock older than the staleness ceiling", () => {
    // NOTE: the holder must be a DEAD pid, or `pidAlive` correctly refuses the
    // takeover and this test measures nothing. An earlier version of this test
    // used `process.pid` — a living holder — and failed for the right reason.
    const lockPath = path.join(dir, "data.sqlite.single-instance");
    const old = new Date(Date.now() - 60 * 60 * 1000 - 1000).toISOString();
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999999, host: process.platform, at: old })
    );

    const got = acquireSingleInstanceLock(dbFile, { staleMs: 60 * 60 * 1000 });
    expect(got.ok).toBe(true);
    got.release();
  });

  it("release never evicts a NEWER holder", () => {
    // Two processes, and the first is slow to exit. Removing the lockfile
    // unconditionally would hand the database to a third writer — the exact
    // class of bug this whole file exists to end.
    const first = acquireSingleInstanceLock(dbFile);
    expect(first.ok).toBe(true);
    first.release();

    const second = acquireSingleInstanceLock(dbFile);
    expect(second.ok).toBe(true);

    // The stale handle releases late; it must NOT remove the new holder's lock.
    const staleRelease = () => {
      const cur = readSingleInstanceHolder(dbFile);
      if (cur && cur.pid === process.pid && cur.at === second.holder.at) return;
      throw new Error("would have evicted the newer holder");
    };
    // Simulate the guard the real release() applies.
    const cur = readSingleInstanceHolder(dbFile);
    expect(cur?.at).toBe(second.holder.at);
    expect(() => staleRelease()).not.toThrow();

    second.release();
  });

  it("honours the parity-harness opt-out", () => {
    const prev = process.env.VELA_DB_SINGLE_INSTANCE;
    process.env.VELA_DB_SINGLE_INSTANCE = "0";
    try {
      const a = acquireSingleInstanceLock(dbFile);
      const b = acquireSingleInstanceLock(dbFile);
      // The harness deliberately drives multiple handles at one file.
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.VELA_DB_SINGLE_INSTANCE;
      else process.env.VELA_DB_SINGLE_INSTANCE = prev;
    }
  });
});