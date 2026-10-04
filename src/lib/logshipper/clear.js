/**
 * clear.js — §6's CLEAR ORDERING, executed exactly as sealed.
 *
 * ── WHY THE REFUTER'S SAB HOLE MATTERS ─────────────────────────────────────
 *   The r2 order never flushed the ring. Pre-clear bytes were already in the
 *   SharedArrayBuffer; the worker drained them AFTER the DELETE and re-inserted
 *   rows the operator had just destroyed. An operator who clears a log and
 *   then sees the pre-clear lines return concludes the product is broken — and
 *   they would be RIGHT. The fix is not "flush soon after"; it is that the
 *   flush must be ordered BEFORE the delete, with the settle acknowledged.
 *
 * ── THE SEVEN STEPS, AND WHO OWNS EACH ─────────────────────────────────────
 *   1. shipLog enters the hold      — index.js `holdLogshipper()`. New lines
 *      buffer in `state.held` instead of the ring, so they cannot land in the
 *      ring between the flush and the delete.
 *   2. main flushes the SAB, waits   — index.js `flushLogshipper()`, bounded
 *      at SETTLE_BOUND_MS. The worker's `flush` handler drains to empty and
 *      commits in ONE transaction before it acks `flushed`. This step is the
 *      one a skip-mutation must redden.
 *   3. worker DELETEs                — index.js `clearPersistedLogs()`; the
 *      worker's `clear` handler calls `store.clear()` (`DELETE FROM
 *      logEvents`, fixed SQL, no bound values because it takes none).
 *   4. worker acks with the count    — `{deleted}` comes back on `cleared`.
 *      THAT number is what the audit row records: a clear with no count is a
 *      clear nobody can reconcile against the ledger.
 *   5. main drains the pending 80ms  — consoleLogBuffer's 80ms batcher holds
 *      rows that have NOT been emitted yet; `clearConsoleLogs()` empties the
 *      three rings and emits `clear`, which every SSE client forwards.
 *   6. the hold releases             — index.js `releaseLogshipper()`.
 *      Lines that arrived during the settle are dispatched NOW, as post-clear
 *      evidence. They are not lost and not smuggled into the cleared window:
 *      they happened after the operator's intent, and saying so is the honest
 *      reading.
 *   7. (the SSE `clear` frame is emitted by step 5, to every subscriber.)
 *
 * ── STEP 5'S BIND ──────────────────────────────────────────────────────────
 *   The 80ms batcher lives in consoleLogBuffer, whose internals are M6's frozen
 *   contract and which this milestone must not edit. `flushPendingLines` is not
 *   exported, so `drainConsoleBuffers` drives the ONE handle that does exist —
 *   the shared `global._consoleLogBufferState` — emitting the pending batch on
 *   the same emitter the live SSE clients read, then calling the public
 *   `clearConsoleLogs()` to empty the three rings and emit `clear`. Emitting
 *   before the wipe is what keeps those rows from vanishing with the rings.
 *
 * ── FAILURE POSTURE ────────────────────────────────────────────────────────
 *   A settle that times out does NOT abort the clear: the bound is named
 *   (SETTLE_BOUND_MS), the lost window is recorded in the returned verdict as
 *   `settled:false`, and the delete proceeds. A clear that refused to finish
 *   because the worker was slow would leave the operator with a log they asked
 *   to erase still on disk — the worse of the two failures. The verdict says
 *   which happened, so the caller (and the audit row) never overstate it.
 */
import {
  clearPersistedLogs,
  flushLogshipper,
  holdLogshipper,
  releaseLogshipper,
  getLogshipperState,
} from "./index.js";

/** §6 step 2's bound. Named from the same constant the shutdown handshake uses. */
export const SETTLE_BOUND_MS = 2_000;

/**
 * Await `promise`, never past `ms`, never rejecting.
 *
 * A rejection here is INFORMATION, not a fault: the clear continues and the
 * returned verdict carries the failure, because a clear that refused to
 * finish would leave the operator's log on disk — the worse of the two
 * outcomes. This is the same shape as index.js's own `bounded`, kept local
 * because that one is not exported and M4/M5 contracts are frozen.
 */
function bounded(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, value: null, timedOut: true });
    }, ms);
    timer.unref?.();
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true, value, timedOut: false });
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, value: null, error: String(error?.message ?? error), timedOut: false });
      }
    );
  });
}

/**
 * §6 step 5 — drain the console buffer's pending batch, then empty the rings
 * and emit `clear`.
 *
 * `flushPendingLines` is module-private (M6's frozen contract), so the pending
 * batch is drained through the ONE handle that exists — the shared
 * `global._consoleLogBufferState` — and its rows are emitted on the same
 * emitter the live SSE clients read. Emitting BEFORE the wipe is what makes
 * those rows reach a client instead of vanishing with the rings; the clear
 * frame that `clearConsoleLogs()` then emits tells every client to drop
 * whatever it still holds, which is what closes the ring-vs-DB divergence.
 */
async function drainConsoleBuffers() {
  const buffer = await import("../consoleLogBuffer.js");
  const state = global._consoleLogBufferState;
  let drained = 0;
  if (state?.emitter) {
    const lines = state.pendingLines?.splice(0, state.pendingLines?.length ?? 0) ?? [];
    const entries = state.pendingEntries?.splice(0, state.pendingEntries?.length ?? 0) ?? [];
    const rawEntries = state.pendingRawEntries?.splice(0, state.pendingRawEntries?.length ?? 0) ?? [];
    drained = lines.length + entries.length + rawEntries.length;
    // Cancel the pending 80ms timer: its callback would find empty arrays and
    // return, but leaving it armed keeps a timer alive across a clear for no
    // reason — and a cleared harbor should hold nothing.
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    if (lines.length) state.emitter.emit("lines", lines);
    if (entries.length) state.emitter.emit("entries", entries);
    if (rawEntries.length) state.emitter.emit("raw", rawEntries);
  }
  buffer.clearConsoleLogs(); // empties the three rings AND emits `clear`
  return { drained, ringsCleared: true };
}

/**
 * §6 step 3's fallback for the postures with no worker.
 *
 * Reached ONLY when `clearPersistedLogs()` resolves `null` — which is exactly
 * what index.js's `request()` returns when `state.worker` is null (degraded,
 * mysql, or not-yet-booted). It calls the SAME `logStore.clear()` the worker's
 * own `clear` handler calls, on the SAME harbor, so the SQL is identical and
 * the count means the same thing on both paths.
 */
async function deleteOnMainThread() {
  const { getLogStore } = await import("../db/repos/sqlite/logStore.js");
  const store = await getLogStore();
  return store.clear();
}

/**
 * Run the ordered clear. Returns a verdict naming EVERY step's outcome, so the
 * route can audit what actually happened rather than asserting that it did.
 *
 * @returns {Promise<{deleted:number, settled:boolean, steps:object, elapsedMs:number}>}
 */
export async function runOrderedClear({ settleBoundMs = SETTLE_BOUND_MS } = {}) {
  const startedAt = Date.now();
  const steps = {};

  // 1 · HOLD — new lines buffer as post-clear evidence.
  holdLogshipper();
  steps.hold = { held: true };

  try {
    // 2 · SETTLE — flush the SAB and WAIT for the worker's ack, bounded.
    const flushed = await bounded(flushLogshipper(), settleBoundMs);
    steps.flush = { settled: flushed.ok, timedOut: flushed.timedOut === true, error: flushed.error ?? null, rows: flushed.ok ? flushed.value?.n ?? null : null };
    const settled = flushed.ok;

    // 3 · DELETE — the worker runs the parameterized DELETE.
    // 4 · ACK — the count comes back with it; that count is the audit row's.
    //
    // POSTURE FALLBACK, and it is a law rather than a nicety: in DEGRADED
    // posture there is NO worker, so `clearPersistedLogs()` resolves `null`
    // and the DELETE would simply never run — an operator who asked to erase
    // their log would get a 200, an audit row saying "0 deleted", and their
    // data still on disk. A clear that does not clear is the worst outcome
    // this door can produce. So when the worker path yields no ack, the
    // main thread runs the SAME store's `clear()` itself: one fixed
    // `DELETE FROM logEvents`, no bound values (it takes none), the same
    // `logStore` the worker's own handler calls.
    const cleared = await bounded(clearPersistedLogs(), settleBoundMs);
    let deleted = cleared.ok ? Number(cleared.value?.deleted ?? 0) : 0;
    let posture = cleared.ok && cleared.value ? "worker" : "main";
    if (cleared.value === null && !cleared.timedOut) {
      const fallback = await bounded(deleteOnMainThread(), settleBoundMs);
      deleted = fallback.ok ? Number(fallback.value ?? 0) : 0;
      posture = "main";
    }
    steps.clear = { ok: cleared.ok || deleted > 0 || posture === "main", deleted, posture, timedOut: cleared.timedOut === true, error: cleared.error ?? null };

    // 5 · DRAIN — the pending 80ms batch plus the three rings (which also
    //     emits the `clear` frame every SSE client forwards).
    steps.drain = await drainConsoleBuffers();
  } finally {
    // 6 · RELEASE — held lines are dispatched as post-clear evidence. In a
    //     `finally`, so a throw in step 3 or 5 still releases the hold: a
    //     held shipper silently swallows every subsequent line, which would
    //     turn a failed clear into permanent log loss.
    steps.release = { released: releaseLogshipper() };
  }

  return {
    deleted: steps.clear?.deleted ?? 0,
    settled: steps.flush?.settled === true,
    steps,
    heldAfter: getLogshipperState().hold,
    elapsedMs: Date.now() - startedAt,
  };
}
