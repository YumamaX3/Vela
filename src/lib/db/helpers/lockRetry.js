/**
 * lockRetry.js — the WAL lock protocol's second chance.
 *
 * SQLITE_PROTOCOL ("locking protocol") is not SQLITE_BUSY: it is the WAL
 * lock-state machine refusing a lock acquisition, and busy_timeout does NOT
 * cover it. It appears when two handles in one process (main thread + the
 * logshipper worker) meet at the OS lock level, and its frequency climbs on
 * filesystems whose advisory locking is shaky (WSL2 bind mounts, some Docker
 * Desktop mounts). Measured in the wild: bursts every ~60s — the main
 * thread's PASSIVE checkpoint interval — plus boot-time contention when the
 * worker opens while migrations run.
 *
 * The mend: retry the transaction a few times with a short backoff. A failed
 * transaction rolls its writes back, so re-running the whole fn is safe by
 * construction; non-lock errors are never retried.
 */
const LOCK_CODES = new Set(["SQLITE_PROTOCOL", "SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT"]);
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 25;

export function isLockProtocolError(error) {
  if (!error) return false;
  if (LOCK_CODES.has(error.code)) return true;
  return typeof error.message === "string" &&
    /locking protocol|SQLITE_PROTOCOL|SQLITE_BUSY|database is locked|database table is locked/i.test(error.message);
}

export function withLockRetry(transaction) {
  return (fn) => {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return transaction(fn);
      } catch (error) {
        lastError = error;
        if (!isLockProtocolError(error) || attempt === MAX_ATTEMPTS) throw error;
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * BASE_DELAY_MS);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
      }
    }
    throw lastError;
  };
}
