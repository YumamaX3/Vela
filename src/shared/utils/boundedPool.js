// The bounded current — a small promise pool for the fleet operations that
// would otherwise run one entry at a time.
//
// WHY IT EXISTS — the bulk and import routes each walk N entries (≤200) with a
// sequential `for` + `await`. Every entry is an independent DB round trip, so
// the wall clock is the whole sum of them. A pool of W workers cuts that sum by
// W without ever letting more than W writes be in flight at once — which is the
// point: an unbounded `Promise.all` over 200 mints would open 200 concurrent
// transactions and fight SQLite's single writer, making the batch SLOWER than
// the loop it replaced.
//
// THE LAWS (each one is a test in tests/unit/bounded-pool.test.js):
//   1. ORDER — `results[i]` is always the verdict for `items[i]`, whatever
//      order the work finished in. A caller zips items with results and never
//      has to re-sort.
//   2. BOUND — at most `concurrency` workers are ever in flight.
//   3. ISOLATION — a throwing entry becomes an `{ ok: false, error }` at its own
//      index and the batch runs to the end. The pool only rejects when the
//      whole batch could not start (validateInput) or when an error is marked
//      `fatal` — the caller's own statement that continuing would be a lie.
//
// `work` must translate its own errors into verdicts when a per-entry failure
// has a meaning beyond "it threw" (e.g. "Update failed", or a limits error's
// joined sentences) — the pool is not a place to learn the domain's dialect.

export const DEFAULT_POOL_CONCURRENCY = 6;

/**
 * Run `work` over every item with at most `concurrency` calls in flight.
 *
 * @template T, R
 * @param {readonly T[]} items
 * @param {(item: T, index: number) => Promise<R>|R} work
 * @param {{ concurrency?: number, validateInput?: (item: T) => void }} [opts]
 * @returns {Promise<R[]>} one result per item, index-aligned with `items`
 */
export async function runPool(items, work, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const width = normalizeConcurrency(opts.concurrency);
  const results = new Array(total);

  // Pure checks first (argument shape, per-item input), before any worker is
  // started — so a caller's bad input cannot leave half the batch applied.
  if (opts.validateInput) for (const item of list) opts.validateInput(item);

  if (total === 0) return results;

  let next = 0;

  const worker = async () => {
    while (next < total) {
      const index = next;
      next += 1;
      try {
        results[index] = await work(list[index], index);
      } catch (error) {
        if (error && error.fatal === true) throw error;
        results[index] = {
          ok: false,
          error: error?.message || "Operation failed",
        };
      }
    }
  };

  // SPREAD THE START — every worker's first synchronous step runs in its own
  // tick. Several of this harbor's writes (the SQLite apiKeys repo, for one)
  // are `async` shells around synchronous statements: without this, the first
  // worker to reach `work()` would finish its whole assignment inside its own
  // microtask chain before worker #2 ever started. The bound would still hold,
  // but the current would never widen — and the pool's only reason to exist
  // is to widen it.
  const start = () => new Promise((resolve) => setTimeout(resolve, 0));

  await Promise.all(
    Array.from({ length: Math.min(width, total) }, () =>
      start().then(worker)
    )
  );
  return results;
}

/** Coerce a caller's width into a sane worker count (1…items-agnostic).
 *  A NaN, a zero or a negative width would otherwise start no worker at all
 *  and resolve an all-`undefined` batch — a silent lie. */
export function normalizeConcurrency(concurrency) {
  const n = Math.floor(Number(concurrency));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_POOL_CONCURRENCY;
  return n;
}
