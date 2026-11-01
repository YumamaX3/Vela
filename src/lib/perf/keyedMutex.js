// KEYED MUTEX — P2 of the Responsive Tide (plans/2026-11-01-responsive-tide-performance.md,
// suspect 2 → mend P2: "Break the selectionMutex — per-provider keyed mutexes").
//
// Before this module, src/sse/services/auth.js:23 held ONE module-level promise
// chain and every getProviderCredentials() call — for ANY provider — appended
// itself to it (auth.js:178-180). A single account selection for provider A
// blocked every selection for providers B, C, D at the same gate: concurrency
// became a process-wide FIFO. The chain was never wrong for one provider (the
// round-robin read-then-write must serialize — see auth.js's round-robin block),
// it was only wrong across providers.
//
// This module keeps exactly that guarantee, per key:
//
//   1. SAME KEY SERIALIZES — run(key, fn) never starts fn until the previous
//      fn for the same key (sync or async) has fully settled. Ordering within a
//      key is FIFO: the second waiter's fn starts only after the first's
//      finally has resolved its own lane.
//
//   2. DIFFERENT KEYS NEVER SERIALIZE — each key owns its own lane promise.
//      A slow fn under key "a" cannot delay a fn under key "b": run("b", …)
//      executes on this same synchronous turn while "a" is still awaiting.
//
//   3. NO LEAK — a lane whose owner is the last queued fn is deleted from the
//      map on release, so the map's size is bounded by the keys in flight, not
//      by the process's history. Nothing here times out or abandons a lane:
//      releasing happens in `finally`, so a throwing fn still frees its key.
//
//   4. FAIL-OPEN BY SHAPE — this module cannot throw on its own account. The
//      lane bookkeeping is synchronous; the only failure it can surface is the
//      caller's own throw, which propagates to that caller alone and leaves the
//      lane released.
//
// Zero dependencies, no timers, no async I/O — it is pure bookkeeping on the
// event loop, so adding it to a hot path costs a Map lookup and one promise.

/**
 * Create a keyed lane store.
 * @returns {{
 *   run<T>(key: string, fn: () => Promise<T> | T): Promise<T>,
 *   size(): number,
 *   clear(): void,
 * }}
 */
export function createKeyedMutex() {
  /** @type {Map<string, Promise<void>>} key → tail of that key's lane */
  const lanes = new Map();

  function run(key, fn) {
    const k = String(key);
    // The lane this call must wait behind: the previous tail, or a resolved
    // promise for a brand-new key (so the first call never yields to anything).
    const prior = lanes.get(k) || Promise.resolve();
    const result = prior.then(() => fn());

    // The new tail never rejects — a caller's throw must not poison the lane
    // for the next waiter (that throw still reaches the caller via `result`).
    const tail = result.then(
      () => {},
      () => {},
    );
    lanes.set(k, tail);

    // Release: only the LAST queued fn for this key may drop the lane, or a
    // waiter behind us would re-create an uncontended lane and run alongside
    // the next call. Identity check on the tail — no counters to drift.
    tail.then(() => {
      if (lanes.get(k) === tail) lanes.delete(k);
    });

    return result;
  }

  return {
    run,
    size: () => lanes.size,
    clear: () => lanes.clear(),
  };
}
