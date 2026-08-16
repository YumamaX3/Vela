import { getUsageStats, statsEmitter, getActiveRequests, getPerProviderFrame } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

// Usage Observatory W1-D (sealed plan item 7 + phase13 R5):
//   • perProvider frame rides a SERVER-SHARED memo (≤30s TTL in the repo
//     layer) — every SSE client consumes the same cached scan, so a busy
//     event stream or many subscribers never multiply the DB load.
//   • full stats recompute is COALESCED per client at ≥15s — a storm of
//     "update" events can never trigger more than one heavy getUsageStats()
//     per client per window; between windows the lightweight push carries
//     the live picture (activeRequests, recentRequests, perProvider).
const FULL_STATS_MIN_INTERVAL_MS = 15_000;

export async function GET() {
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, send: null, sendPending: null, cachedStats: null, lastFullAt: 0 };
  let controller = null; // bound when the ReadableStream starts

  const detach = () => {
    state.closed = true;
    statsEmitter.off("update", state.send);
    statsEmitter.off("pending", state.sendPending);
    if (state.keepalive) clearInterval(state.keepalive);
  };

  // Lightweight push — active/recent requests + the memoized perProvider
  // frame. Cheap enough to ride every "pending" event: this is what keeps
  // the topology halos + live tiles alive between full recomputes.
  const sendQuick = async () => {
    if (state.closed || !controller || !state.cachedStats) return;
    try {
      const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
      const perProvider = await getPerProviderFrame(); // memoized ≤30s, fail-open
      const quickStats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider, perProvider };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`));
    } catch { detach(); }
  };

  const stream = new ReadableStream({
    async start(c) {
      controller = c;

      // Full stats refresh (heavy) + immediate lightweight push.
      state.send = async () => {
        if (state.closed) return;
        try {
          // Coalesce: an "update" storm must not trigger more than one heavy
          // recompute per client per FULL_STATS_MIN_INTERVAL_MS. Inside the
          // window, serve the lightweight path instead — the live picture
          // rides activeRequests/recentRequests/perProvider, and the next
          // event after the window settles the full stats.
          const now = Date.now();
          if (state.cachedStats && now - state.lastFullAt < FULL_STATS_MIN_INTERVAL_MS) {
            await sendQuick();
            return;
          }
          // Outside the window (or first paint) — the heavy path. Push the
          // lightweight update first so the UI reflects changes fast.
          if (state.cachedStats) await sendQuick();
          const stats = await getUsageStats();
          state.cachedStats = stats;
          state.lastFullAt = Date.now();
          const perProvider = await getPerProviderFrame();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...stats, perProvider })}\n\n`));
        } catch {
          detach();
        }
      };

      // Lightweight push only: refresh activeRequests + recentRequests +
      // perProvider on pending changes (never the heavy full stats).
      state.sendPending = async () => {
        await sendQuick();
      };

      await state.send();

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.sendPending);

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          detach();
        }
      }, 25000);
    },

    cancel() {
      detach();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
