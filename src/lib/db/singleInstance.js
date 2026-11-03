// SINGLE-INSTANCE GUARD for the SQLite primary (WR-a1).
//
// THE DEFECT THIS CLOSES — proven, not theorised:
//   checkpointOwner.js:33 holds checkpoint ownership in a MODULE-level
//   variable. Under worker_threads each thread gets an isolated module
//   registry, and across PROCESSES it cannot coordinate at all. There is no
//   file lock, no PID guard, no single-instance check anywhere in the tree —
//   `grep -rlE 'flock|LOCK_FILE|singleInstance'` finds only the MITM port-443
//   lock. The only cross-process serialisation is SQLite's own byte-range
//   locking under `PRAGMA busy_timeout = 5000`.
//
//   Measured consequence on this machine: FOUR Vela worktrees share one
//   %APPDATA%\vela/db/data.sqlite with nothing between them. A second process
//   opening the same file silently becomes a second writer; its exit-time
//   `wal_checkpoint(TRUNCATE)` (nodeSqliteAdapter.js:63-67, betterSqliteAdapter.js:50-53,
//   bunSqliteAdapter.js:45-49) runs unconditionally and waits up to busy_timeout
//   on any concurrent write transaction — the exact 5,495 ms main-thread freeze
//   checkpointOwner.js:4-8 documents. That is the shape behind the observed
//   boot-time `SQLITE_CORRUPT: database disk image is malformed`.
//
// THE FIX — ownership, not tuning, exactly as checkpointOwner's own header
// demands: an exclusive advisory lock on a sidecar file, acquired BEFORE the
// adapter opens. `fs.openSync(path, 'wx')` is atomic on POSIX and on Windows
// (CreateFileW with CREATE_NEW), so two processes cannot both win. A loser
// fails LOUD with the holder's PID and start time rather than silently racing.
//
// DELIBERATE SCOPES:
//   - The lock is OPT-IN per call site. The adapter opener takes it; the restore
//     drill's `getScratchAdapter()` must NOT (a scratch file is throwaway, and
//     taking a lock on it would be meaningless). The CLI is a process manager,
//     not a writer, and is unaffected.
//   - The lock is RELEASED on clean exit. A hard kill leaves a stale lockfile,
//     which is why `staleMs` exists: a lock whose PID is gone, or whose mtime
//     is older than the ceiling, is treated as abandoned and taken over. That
//     is the standard advisory-lock contract, and it is why this is safe to
//     leave behind after a crash.
//   - `VELA_DB_SINGLE_INSTANCE=0` disables it for the parity harness, which
//     deliberately drives multiple handles at one file.

import fs from "node:fs";
import path from "node:path";

const LOCK_NAME = "data.sqlite.single-instance";
const DEFAULT_STALE_MS = 60 * 60 * 1000; // 1h — kept fresh by the heartbeat below
const HEARTBEAT_MS = 60 * 1000; // 1min — the lockfile's mtime is refreshed well inside staleMs
// Live handles THIS process holds, keyed by resolved db path. A lock whose
// holder PID is ours is either (a) a live handle we still own — REFUSE, the
// WR-a1 contract's second-acquirer case, or (b) a discarded singleton whose
// release closure was garbage-collected with the state object it lived on —
// TAKEOVER. The registry is the only honest discriminator: a PID check alone
// cannot tell a live second acquirer from a dead one, and treating them alike
// either breaks the contract or deadlocks every in-process re-boot.
const liveHandles = new Map(); // dbPath -> { pid, at }

/** True when the process is alive. PID 0 / negative / unparseable → assume dead. */
function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0); // signal 0 = existence probe, no delivery
    return true;
  } catch (e) {
    // EPERM means the process exists but is not ours to signal — still alive.
    return e?.code === "EPERM";
  }
}

function lockPathFor(dbFile) {
  return path.join(path.dirname(dbFile), LOCK_NAME);
}

function readHolder(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Acquire the exclusive single-instance lock for one database file.
 *
 * @param {string} dbFile absolute path to data.sqlite
 * @param {{staleMs?: number, force?: boolean}} [opts]
 * @returns {{ok: true, release: () => void, holder: object} | {ok: false, reason: string, holder: object|null}}
 */
export function acquireSingleInstanceLock(dbFile, opts = {}) {
  if (process.env.VELA_DB_SINGLE_INSTANCE === "0") {
    return { ok: true, release: () => {}, holder: null, disabled: true };
  }

  const lockPath = lockPathFor(dbFile);
  const staleMs = Number.isFinite(opts.staleMs) ? opts.staleMs : DEFAULT_STALE_MS;
  const me = { pid: process.pid, host: process.platform, at: new Date().toISOString() };

  const attempt = () => {
    // 'wx' = CREATE_NEW: fails atomically if the file exists. This is the whole
    // race-freedom of the lock — there is no window between test and create.
    const fd = fs.openSync(lockPath, "wx");
    try {
      fs.writeFileSync(fd, JSON.stringify(me), "utf8");
    } finally {
      fs.closeSync(fd);
    }
  };

  let holder = readHolder(lockPath);
  if (holder) {
    const age = Date.now() - Date.parse(holder.at || 0);
    const sameHost = holder.host === process.platform;
    // THE 2026-11-04 CORRECTION (measured on the homelab wreck): a foreign-host
    // guard used to be taken over silently — pidAlive cannot resolve another
    // host's pid, so `alive` fell false and the lock was stolen. That guard
    // file may belong to a LIVE container on the NAS (pid namespaces make the
    // pid meaningless across hosts); a silent takeover is exactly the
    // second-writer window this lock exists to close. A foreign host now means
    // ALIVE-UNKNOWN: refuse loudly unless the caller forces it.
    if (!sameHost && !opts.force) {
      return {
        ok: false,
        reason: `lock held by another host (${holder.host}) — cannot verify liveness; ` +
          `if that host is provably down, remove ${path.basename(lockPath)} or pass { force: true }`,
        holder,
      };
    }
    const alive = pidAlive(holder.pid) && sameHost;
    // SELF-HEAL, NARROWLY: a lock whose holder PID is ours is a REFUSAL unless
    // no live handle in THIS process still owns it. A suite that simulates a
    // fresh boot does `delete global._dbAdapter; vi.resetModules()` — the old
    // state object and its release closure become garbage, so the lockfile
    // outlives its owner and the next boot would throw against itself. A live
    // second acquirer still fails LOUD: that is the cross-process guarantee
    // this whole file exists for.
    const ownStaleLock =
      holder.pid === process.pid &&
      sameHost &&
      !liveHandles.has(path.resolve(dbFile));
    // A stale mtime ALONE no longer authorises a takeover: a live holder
    // heartbeats (below), so an old mtime plus a DEAD pid is the only
    // staleness that proves abandonment.
    if (alive && !opts.force && !ownStaleLock) {
      return {
        ok: false,
        reason: `another Vela process already holds ${path.basename(dbFile)}`,
        holder,
      };
    }
    // Abandoned (dead PID on our host, own discarded singleton, or older than
    // the ceiling with a dead pid) — take over. Removing first keeps 'wx'
    // honest; a crash between the two is recovered on the next boot by the
    // same staleness rule.
    try { fs.unlinkSync(lockPath); } catch {}
  }

  try {
    attempt();
  } catch (e) {
    if (e?.code === "EEXIST") {
      holder = readHolder(lockPath);
      return {
        ok: false,
        reason: `lost the race for ${path.basename(dbFile)}`,
        holder,
      };
    }
    throw e;
  }

  let released = false;
  // Register BEFORE returning, so a second acquirer in this same process sees a
  // live handle and is refused — the WR-a1 contract's first case. The
  // heartbeat starts with it: the lockfile is rewritten every HEARTBEAT_MS so
  // the staleness ceiling can never misread a live holder as abandoned, and
  // `heartbeatTimer` is what release() clears.
  liveHandles.set(path.resolve(dbFile), me);
  const heartbeatTimer = heartbeat();
  return {
    ok: true,
    holder: me,
    release() {
      if (released) return;
      released = true;
      clearInterval(heartbeatTimer);
      // Unregister FIRST: a re-boot that races this release must find no live
      // handle, or it would be refused by a lock we are already giving up.
      const key = path.resolve(dbFile);
      if (liveHandles.get(key) === me) liveHandles.delete(key);
      // Only remove the lock if it is still OURS — never evict a newer holder.
      const cur = readHolder(lockPath);
      if (cur && cur.pid === me.pid && cur.at === me.at) {
        try { fs.unlinkSync(lockPath); } catch {}
      }
    },
  };

  function heartbeat() {
    // Keep the lockfile's at/mtime fresh so the staleness ceiling can never
    // misread a live holder as abandoned (the comment that claimed a live
    // server "heartbeats" before 2026-11-04 was a lie — nothing refreshed it).
    // unref'd: the beat must never hold the process open. Registration into
    // `liveHandles` happens at the call site, BEFORE this runs — registry and
    // beat start together, in the contract's required order.
    const timer = setInterval(() => {
      try {
        me.at = new Date().toISOString();
        fs.writeFileSync(lockPath, JSON.stringify(me), "utf8");
      } catch {}
    }, HEARTBEAT_MS);
    if (typeof timer.unref === "function") timer.unref();
    return timer;
  }
}

/** The current holder, or null. Diagnostic surface for logs and tests. */
export function readSingleInstanceHolder(dbFile) {
  return readHolder(lockPathFor(dbFile));
}
