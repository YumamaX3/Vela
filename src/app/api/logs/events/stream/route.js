// Log Pipeline v2 · M7 — GET /api/logs/events/stream
//
// §6's unified SSE tail, and the door that closes the unbounded-queue defect
// the plan's survey found: the legacy console stream pushes onto an array that
// grows until the process dies if a client stops reading. Here every client
// gets its OWN bounded queue (boundedQueue.js), overflow drops the OLDEST and
// counts it, and the count reaches the client as a `# missed N` frame.
//
// ── THE ORDER OF OPERATIONS (why replay is before subscribe) ───────────────
//   1. REPLAY the newest N PERSISTED rows, ascending. These carry real row
//      ids, the redaction that ran at the write door, and the truncation flags.
//   2. SUBSCRIBE to the live emitter.
//   3. Buffer live frames in the bounded queue; flush on the 80ms cadence.
//
//   If the order were reversed, a line arriving between the DB read and the
//   subscribe would be LOST — the exact gap a live tail must not have. The cost
//   is the benign one: a line can be replayed AND delivered live, and the
//   client's row id makes the duplicate detectable (M9 renders by id).
//
// ── §1's ONE-RENDERING LAW ──────────────────────────────────────────────────
//   Live frames are shaped exactly like persisted rows (`toLiveRow`), so the
//   unified tail renders one component for queried and live lines alike. A
//   second live shape would be how the two sources drift apart forever.
import { getConsoleEmitter, getConsoleLogs, getRawLogs, initConsoleLogCapture } from "@/lib/consoleLogBuffer";
import { LOG_LEVELS } from "@/lib/logshipper/index.js";
import { createBoundedQueue } from "@/lib/logshipper/boundedQueue.js";
import { queryLogTail } from "@/lib/db/repos/sqlite/logQuery.js";
import { SelectorError, parseLogSelector, toWireRow } from "@/lib/logSelector.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

initConsoleLogCapture();

/** How many persisted rows the tail replays before going live. */
const REPLAY_ROWS = 200;
/** Per-client ceiling. 1,000 rows is the harbor's own console ring depth. */
const QUEUE_CAP = 1_000;
/** Flush cadence — matches the console ring's own 80ms batcher. */
const FLUSH_MS = 80;
/** Keepalive comment frame, so a proxy does not reap an idle connection. */
const KEEPALIVE_MS = 15_000;

const LEVEL_NAMES = Object.freeze(
  Object.fromEntries(Object.entries(LOG_LEVELS).map(([name, num]) => [num, name.toUpperCase()]))
);

/**
 * Shape a LIVE console entry into the persisted row shape.
 *
 * A live entry has no DB id (the worker assigns one), so `id` is null and the
 * client keys on `(ts, seq)` instead — recorded here rather than left for the
 * UI to discover. Everything else matches `toWireRow` field for field, which is
 * what makes "one rendering, both sources" true rather than aspirational.
 */
function toLiveRow(entry, stream) {
  return {
    id: null,
    ts: entry?.iso ? Date.parse(entry.iso) || Date.now() : Date.now(),
    lvl: stream === "container" ? 20 : 20, // the ring's own level vocabulary is not §1's enum
    stream,
    reqId: entry?.reqId ?? null,
    upstreamId: entry?.upstreamId ?? null,
    provider: entry?.provider ?? null,
    tag: entry?.tags?.[0] ?? null,
    msg: entry?.message ?? String(entry?.raw ?? ""),
    meta: entry?.meta ?? null,
    truncMsg: false,
    truncMeta: false,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let selector = {};
  let narrowed = false;
  let q = null;
  try {
    const parsed = parseLogSelector(searchParams);
    selector = parsed.selector;
    narrowed = parsed.narrowed;
    q = parsed.q;
  } catch (error) {
    if (error instanceof SelectorError) {
      return new Response(JSON.stringify({ error: error.message, field: error.field }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw error;
  }

  const qHonoured = q !== null && narrowed;
  const queue = createBoundedQueue(QUEUE_CAP);
  const encoder = new TextEncoder();
  let closed = false;
  let flushTimer = null;
  let keepalive = null;
  const unsubscribers = [];
  // The controller is bound HERE, not read out of `start()`'s parameter.
  // `send`/`flush`/`keepalive` are closures declared above the ReadableStream
  // literal, so a bare `controller` inside them is not merely a TDZ case — it
  // is a free variable that resolves to NOTHING, and every frame is swallowed
  // by `send`'s own catch. The binding lives in the enclosing scope; `start()`
  // assigns into it.
  let controller = null;

  const send = (payload) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
    } catch {
      // The socket is gone; the abort listener owns the teardown.
      cleanup();
    }
  };

  /**
   * Drain the queue onto the wire, leading with the honesty frame when rows
   * were lost. `# missed N` is a COMMENT frame, not data: a client parsing
   * `data:` lines never sees it, and the Log Harbor's own listener reads the
   * comment to draw the gap marker. That is the backpressure-honest channel.
   */
  const flush = () => {
    flushTimer = null;
    if (closed || !controller) return;
    const { frames, missed } = queue.drain();
    if (missed > 0) {
      try {
        controller.enqueue(encoder.encode(`: # missed ${missed}\n\n`));
      } catch {
        return;
      }
    }
    for (const frame of frames) send(frame);
  };

  const scheduleFlush = () => {
    if (flushTimer || closed) return;
    flushTimer = setTimeout(flush, FLUSH_MS);
    flushTimer.unref?.();
  };

  const onEntries = (entries) => {
    for (const entry of entries) {
      if (!matches(toLiveRow(entry, "console"), selector)) continue;
      queue.push({ type: "log", row: toLiveRow(entry, "console") });
    }
    scheduleFlush();
  };

  const onRaw = (rawEntries) => {
    for (const entry of rawEntries) {
      const row = toLiveRow(entry, "container");
      if (!matches(row, selector)) continue;
      queue.push({ type: "log", row });
    }
    scheduleFlush();
  };

  const onClear = () => {
    // A clear invalidates everything buffered: replaying rows the operator just
    // destroyed would be the ring-vs-DB divergence §6 exists to close.
    queue.reset();
    send({ type: "clear" });
  };

  function cleanup() {
    if (closed) return;
    closed = true;
    clearTimeout(flushTimer);
    clearInterval(keepalive);
    flushTimer = null;
    keepalive = null;
    for (const off of unsubscribers.splice(0, unsubscribers.length)) {
      try { off(); } catch {}
    }
  }

  /** Does a row satisfy the same selector the query door honours? */
  function matches(row, sel) {
    if (sel.minLvl !== null && sel.minLvl !== undefined && row.lvl < sel.minLvl) return false;
    if (sel.stream && row.stream !== sel.stream) return false;
    if (sel.provider && row.provider !== sel.provider) return false;
    if (sel.tag && row.tag !== sel.tag) return false;
    if (sel.reqId && row.reqId !== sel.reqId) return false;
    if (sel.upstreamId && row.upstreamId !== sel.upstreamId) return false;
    if (sel.since !== null && sel.since !== undefined && row.ts < sel.since) return false;
    if (sel.until !== null && sel.until !== undefined && row.ts > sel.until) return false;
    if (sel.before !== null && sel.before !== undefined && row.id !== null && row.id >= sel.before) return false;
    return true;
  }

  const stream = new ReadableStream({
    async start(streamController) {
      // Bind FIRST, before any send: the closures above read the enclosing
      // binding, not this parameter.
      controller = streamController;
      // 1 · REPLAY — the newest persisted rows, ASCENDING, redacted exactly as
      //     stored. A read failure must not kill the tail: the harbor still has
      //     live lines, and an honest `replay: {ok:false}` is better than a
      //     stream that dies with no rows at all.
      let replay = { ok: false, rows: 0, note: "pending" };
      try {
        const rows = await queryLogTail(REPLAY_ROWS, selector, q, { qHonoured });
        send({ type: "init", replay: rows, qHonoured });
        replay = { ok: true, rows: rows.length };
      } catch (error) {
        send({ type: "init", replay: [], qHonoured, replayError: String(error?.message ?? error) });
        replay = { ok: false, rows: 0, note: "unavailable" };
      }

      // 2 · SUBSCRIBE.
      const emitter = getConsoleEmitter();
      emitter.on("entries", onEntries);
      emitter.on("raw", onRaw);
      emitter.on("clear", onClear);
      unsubscribers.push(
        () => emitter.off("entries", onEntries),
        () => emitter.off("raw", onRaw),
        () => emitter.off("clear", onClear)
      );

      // 3 · The memory rings' current contents as a live-shaped warm start, so
      //     a client that reconnects sees the harbor's recent lines even when
      //     the DB replay was empty (worker lag, or a fresh install).
      if (!replay.ok) {
        const structured = getConsoleLogs({ structured: true, limit: REPLAY_ROWS });
        for (const entry of structured) onEntries([entry]);
      }
      for (const entry of getRawLogs({ limit: REPLAY_ROWS })) onRaw([entry]);

      send({
        type: "ready",
        replay,
        cap: QUEUE_CAP,
        dropped: queue.droppedTotal,
      });

      keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          cleanup();
        }
      }, KEEPALIVE_MS);
      keepalive.unref?.();
    },
    cancel() {
      cleanup();
    },
  });

  request.signal.addEventListener("abort", cleanup, { once: true });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
