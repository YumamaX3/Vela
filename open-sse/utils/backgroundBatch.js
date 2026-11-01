/**
 * Responsive Tide P8 — the background batch, made to breathe.
 * (plans/2026-11-01-responsive-tide-performance.md §III, mend P8)
 *
 * THE TURBULENCE. Background sweeps ran their per-item work in batches that had
 * no ceiling and never paused — the auto-claim's plain `for … await`, which does
 * only each iteration's SYNC SLICE before the microtask checkpoint (and nothing
 * at all after an early `continue`), and the quota sweep's one uncapped
 * `Promise.allSettled`, which fires every item at once against a shared uplink.
 *
 * THE MEND. One loop shape for every sweep: at most CONCURRENCY items in flight,
 * a real macrotask yield after every `every` completions, fail-open per item.
 *
 * THE LATCH LAW (why this function reports instead of throwing). Every sweep tick
 * flips a module-level latch before its loop and MUST clear it in `finally`. A
 * helper that throws from inside that `try` would leave the latch set and the
 * sweep permanently wedged — a fail-open background job turned fail-closed. So
 * this never rejects: item errors are collected, and a yield that cannot be
 * scheduled stops further yields (the remaining items still run — synchronously).
 */

/**
 * Wait for one macrotask. `setImmediate` runs after the current poll phase, so
 * inbound I/O and due timers are serviced before this resolves — exactly the
 * responsiveness the sweeps owe the live loop.
 */
export function yieldToLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Walk `items`, running `onItem(item, index)` at most CONCURRENCY in flight and
 * yielding to the loop after each group of `every` completions.
 *
 * - An `onItem` that throws is counted in `failed`; the batch continues.
 * - `onError(item, index, err)` is called for each failure when given; it is
 *   itself guarded, so a reporting seam cannot abort the batch.
 * - If the yield cannot be scheduled (no `setImmediate`), the batch completes
 *   without yielding rather than leaving work undone.
 * - Resolves (never rejects) to `{ processed, failed, yields }`.
 *
 * @param {Array} items
 * @param {(item: any, index: number) => any} onItem
 * @param {{ concurrency?: number, every?: number, onError?: Function }} [opts]
 */
export async function runBoundedBatch(items, onItem, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Math.floor(Number(opts.concurrency) || 4));
  const every = Math.max(1, Math.floor(Number(opts.every) || 5));
  const onError = typeof opts.onError === "function" ? opts.onError : null;
  const canYield = typeof setImmediate === "function";

  const stats = { processed: 0, failed: 0, yields: 0 };
  let sinceYield = 0;

  for (let start = 0; start < list.length; start += concurrency) {
    const wave = list.slice(start, start + concurrency).map(async (item, offset) => {
      try {
        await onItem(item, start + offset);
        stats.processed += 1;
      } catch (err) {
        stats.failed += 1;
        if (onError) {
          try {
            onError(item, start + offset, err);
          } catch {
            // A reporting seam that throws must not abort the batch either.
          }
        }
      }
    });
    await Promise.all(wave);
    sinceYield += wave.length;
    if (canYield && sinceYield >= every) {
      sinceYield = 0;
      stats.yields += 1;
      await yieldToLoop();
    }
  }
  return stats;
}
