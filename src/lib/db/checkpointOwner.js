/**
 * Checkpoint ownership (sealed plan r3 §2 — the refuter's FIRST fatal).
 *
 * MEASURED (Gate 15 refuter): with BOTH the main handle and the worker handle
 * running the nodeSqliteAdapter's 60s `PRAGMA wal_checkpoint(TRUNCATE)`, the
 * MAIN THREAD froze 5,495 ms — a TRUNCATE checkpoint WAITS on any concurrent
 * writer, and the worker holds a write transaction for the length of a batch.
 * No serving-path statement may ever wait on a checkpoint lock.
 *
 * The fix is OWNERSHIP, not tuning: the logshipper's worker handle owns
 * checkpointing; the main handle opts OUT. Ownership is an explicit,
 * module-level flag with a setter — never a heuristic, never a timing guess,
 * never "checkpoint less often".
 *
 * TWO halves, because the flag alone cannot reach a handle that already exists:
 *
 *  1. Adapters consult `checkpointOwner()` when they are created. A handle born
 *     while the worker owns the gate is created with `wal_autocheckpoint = 0`
 *     and NEVER registers its TRUNCATE interval.
 *  2. Every native handle that registers here is remembered, so a later
 *     `setCheckpointOwner("worker")` can retire the interval and zero the
 *     autocheckpoint on handles that were already open. This is why the
 *     adapters hand over CAPABILITY closures rather than the handle itself —
 *     this module never sees a database object.
 *
 * sql.js needs no half of this: it has no real WAL and checkpoints by writing
 * the whole file on a debounce, so it is not a participant in the collision.
 */

const OWNER_MAIN = "main";
const OWNER_WORKER = "worker";

let owner = OWNER_MAIN;

/** Open native handles, as capability closures — never database objects. */
const nativeHandles = new Set();

/**
 * @param {{ disableAutoCheckpoint: () => void, checkpointNow: () => void }} handle
 */
export function registerNativeHandle(handle) {
  nativeHandles.add(handle);
  // A handle born AFTER ownership flipped must already be born opted out.
  if (owner === OWNER_WORKER) {
    try { handle.disableAutoCheckpoint(); } catch {}
  }
  return () => nativeHandles.delete(handle);
}

/**
 * Hand checkpoint ownership over. `worker` suppresses the main handle's
 * TRUNCATE timer on every open native handle; `main` restores it for handles
 * created after this call (an already-suppressed handle is never re-armed —
 * re-arming mid-life would reintroduce the freeze this module exists to end).
 */
export function setCheckpointOwner(next) {
  if (next !== OWNER_MAIN && next !== OWNER_WORKER) {
    throw new Error(`[DB] unknown checkpoint owner "${next}" — expected main | worker`);
  }
  owner = next;
  if (next !== OWNER_WORKER) return;
  for (const handle of nativeHandles) {
    try { handle.disableAutoCheckpoint(); } catch {}
  }
}

export function checkpointOwner() {
  return owner;
}

/** True when the logshipper worker owns checkpointing. */
export function workerOwnsCheckpointing() {
  return owner === OWNER_WORKER;
}

/** Test/diagnostic seam — the live handle count. */
export function openNativeHandleCount() {
  return nativeHandles.size;
}