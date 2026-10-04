/**
 * boundedQueue.js — §6's backpressure-honest per-client queue.
 *
 * ── THE DEFECT THIS CLOSES (measured by the plan's own survey) ────────────
 *   The legacy `/translator/console-logs/stream` door pushes onto an
 *   unbounded array: a client that stops reading its socket grows that array
 *   until the process runs out of memory, and a slow consumer silently costs
 *   every OTHER client its logs. An unbounded queue is not "generous", it is a
 *   denial-of-service with a `console.log` in it.
 *
 * ── THE LAW ───────────────────────────────────────────────────────────────
 *   On overflow, drop the OLDEST and count it. The newest survives, because
 *   the newest is the failure the operator is mid-chase — §2's drop policy for
 *   the SAB ring, applied to the client queue for the same reason.
 *
 *   The count is never dropped on the floor: `drain()` returns what was lost
 *   and the stream door emits it as a `# missed N` frame. Backpressure that
 *   discards silently is the dishonest kind — the client cannot tell a gap
 *   from a quiet harbor, which is precisely the failure the Log Harbor is
 *   meant to end.
 *
 * This module holds NO I/O: no console, no database, no timers. That is what
 * lets `log-sse-backpressure` drive it with a FakeEventSource and prove the
 * overflow arithmetic without a browser or a server.
 */

/** The default ceiling: 1,000 rows buffered per client before dropping. */
export const DEFAULT_QUEUE_CAP = 1_000;

/**
 * @param {number} cap maximum buffered rows; a non-positive cap throws rather
 *   than silently becoming 0 (an unbounded queue with a bad number is how the
 *   defect came back).
 */
export function createBoundedQueue(cap = DEFAULT_QUEUE_CAP) {
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error("[logstream] bounded queue needs a positive finite cap");
  }
  const queue = [];
  let missed = 0;
  let droppedTotal = 0;

  return {
    get length() {
      return queue.length;
    },
    /** Frames lost to overflow, not yet reported to this client. */
    get missed() {
      return missed;
    },
    /** Every frame this queue has ever dropped — the stat `/stats` reads. */
    get droppedTotal() {
      return droppedTotal;
    },
    /**
     * Push one frame. Returns true when it was buffered, false when the queue
     * was already full and this frame took the newest slot after the oldest
     * was evicted.
     */
    push(frame) {
      if (queue.length >= cap) {
        queue.shift();
        missed += 1;
        droppedTotal += 1;
      }
      queue.push(frame);
      return queue.length < cap;
    },
    /**
     * Take everything buffered, and reset the missed counter.
     *
     * The reset is what makes the `# missed N` frame HONEST: a frame reports
     * exactly the losses since the last drain, and a client that sees
     * `missed: 0` knows nothing was dropped in that window rather than being
     * told a cumulative number it would double-count.
     */
    drain() {
      const out = queue.splice(0, queue.length);
      const report = { frames: out, missed };
      missed = 0;
      return report;
    },
    /** Drop everything WITHOUT reporting — a clear makes stale rows invalid. */
    reset() {
      const dropped = queue.length;
      queue.splice(0, queue.length);
      missed = 0;
      return dropped;
    },
  };
}
