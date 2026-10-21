// FETCHGATE — pace outbound reads that a burst would otherwise fire at once.
//
// Ported from 9router-go `internal/fetchgate`. The failure it closes, measured
// on the quota tracker: the dashboard refreshes every visible connection in one
// tick (`Promise.all(connections.map(fetchQuota))`), so an operator with ten
// accounts behind one office IP sent ten reads inside a few milliseconds. The
// provider answered 429, and the chat path read that as real quota exhaustion,
// locking accounts whose tokens were still live.
//
// A gate hands out at most one slot per minimum gap. Slots are reserved in
// call order under a synchronous lock (JS is single-threaded, so the reserve is
// atomic), and an aborted caller still consumed its slot — otherwise a
// navigated-away dashboard would immediately collapse the queue back into the
// same instant it was trying to avoid.
//
// Jitter is ADDITIVE on top of minGap, never a window around it, so the floor
// stays a hard promise an operator (and a test) can rely on.
const MAX_TIMER_MS = 2 ** 31 - 1;

export class FetchGate {
  constructor(minGapMs = 0, maxJitterMs = 0) {
    this.minGapMs = Math.max(Number(minGapMs) || 0, 0);
    this.maxJitterMs = Math.max(Number(maxJitterMs) || 0, 0);
    this.next = 0; // epoch-ms when the next slot opens
  }

  /** Reserve the next slot; returns the wait in ms. */
  reserve(now = Date.now()) {
    const start = Math.max(this.next, now);
    const jitter = this.maxJitterMs > 0 ? Math.floor(Math.random() * (this.maxJitterMs + 1)) : 0;
    this.next = start + this.minGapMs + jitter;
    return Math.max(start - now, 0);
  }

  /**
   * Wait for this caller's slot. Resolves when the slot opens; rejects with an
   * AbortError (or the signal's reason) when the caller gives up first.
   */
  acquire(signal) {
    const wait = this.reserve();
    if (wait <= 0) return Promise.resolve();
    if (signal?.aborted) return Promise.reject(signal.reason ?? abortError());

    return new Promise((resolve, reject) => {
      const timer = setTimeout(finish, Math.min(wait, MAX_TIMER_MS));
      timer.unref?.();

      function finish() {
        cleanup();
        resolve();
      }
      function onAbort() {
        cleanup();
        reject(signal.reason ?? abortError());
      }
      function cleanup() {
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", onAbort);
      }
      signal?.addEventListener?.("abort", onAbort, { once: true });
    });
  }
}

function abortError() {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

/** The dashboard quota gate — 250ms floor, up to 120ms jitter (the Go numbers).
 *  Ten accounts still refresh inside a couple of seconds; a burst stops looking
 *  like a fleet sharing one egress IP. */
export const quotaFetchGate = new FetchGate(250, 120);
