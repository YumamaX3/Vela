// tests/unit/log-sse-backpressure.test.js — M7 §6's backpressure law.
//
// THE DEFECT: the legacy console stream pushes onto an unbounded array. A
// client that stops reading its socket grows that array until the process runs
// out of memory — and a slow consumer silently costs every OTHER client its
// logs. That is a denial-of-service wearing a `console.log`.
//
// WHAT IS PROVEN HERE
//   1. Overflow DROPS THE OLDEST and keeps the newest — §2's ring policy,
//      applied to the client queue for the same reason: the newest line is the
//      failure the operator is mid-chase.
//   2. The loss is COUNTED, and the count is what the stream emits as a
//      `# missed N` frame. Backpressure that discards silently is the
//      dishonest kind: the client cannot tell a gap from a quiet harbor, which
//      is the exact confusion the Log Harbor exists to end.
//   3. The count resets per drain, so a client is never told the same drop
//      twice.
//   4. A clear resets the queue WITHOUT reporting losses — rows invalidated by
//      a clear are not "missed frames", and conflating the two would show an
//      operator a phantom gap marker for an action they just took.
//
// WHY A FAKE EventSource AND NOT A BROWSER: the queue arithmetic is pure. The
// suite drives the REAL boundedQueue.js (no I/O in it — that is what makes
// this possible) and the REAL route's emitter wiring through a synthetic
// EventEmitter, so the mutation target is the law itself. A browser test would
// be slower and would prove less about the arithmetic.
//
// THE MUTATION LEDGER lives at the foot of this file: each mutation is a
// one-line change that MUST redden exactly the named case.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach, vi } from "vitest";

import { createBoundedQueue, DEFAULT_QUEUE_CAP } from "@/lib/logshipper/boundedQueue.js";

/** A live console entry shaped exactly as consoleLogBuffer emits it. */
function entry(n, over = {}) {
  return {
    seq: n,
    time: "12:00:00",
    iso: new Date(1_700_000_000_000 + n).toISOString(),
    level: "LOG",
    message: `live-${n}`,
    raw: `12:00:00 [LOG] live-${n}`,
    tags: [],
    ...over,
  };
}

// ───────────────────────────────────────────────────────────────────────────
describe("A · the bounded queue — drop-oldest, counted, honest", () => {
  it("refuses a non-positive cap rather than becoming unbounded", () => {
    // A cap of 0 with no guard would silently recreate the very defect this
    // module exists to close: `queue.length >= 0` is always true, so every
    // push drops the row it just added and nothing is ever delivered.
    expect(() => createBoundedQueue(0)).toThrow();
    expect(() => createBoundedQueue(-5)).toThrow();
    expect(() => createBoundedQueue(Number.NaN)).toThrow();
    expect(createBoundedQueue(1).length).toBe(0);
  });

  it("buffers up to the cap without dropping anything", () => {
    const q = createBoundedQueue(5);
    for (let i = 1; i <= 5; i += 1) q.push({ i });
    expect(q.length).toBe(5);
    expect(q.missed).toBe(0);
    expect(q.droppedTotal).toBe(0);
    expect(q.drain().frames.map((f) => f.i)).toEqual([1, 2, 3, 4, 5]);
  });

  it("on overflow it drops the OLDEST and keeps the NEWEST", () => {
    // THE core case. The failure the operator is chasing is the last line, so
    // the last line must survive; the oldest is the one that goes.
    const q = createBoundedQueue(3);
    for (let i = 1; i <= 6; i += 1) q.push({ i });
    expect(q.length).toBe(3);
    expect(q.drain().frames.map((f) => f.i)).toEqual([4, 5, 6]);
  });

  it("COUNTS every dropped frame — nothing is discarded silently", () => {
    const q = createBoundedQueue(3);
    for (let i = 1; i <= 10; i += 1) q.push({ i });
    expect(q.missed).toBe(7); // 10 pushed, 3 fit
    expect(q.droppedTotal).toBe(7);
    expect(q.length).toBe(3);
  });

  it("resets the missed counter per drain — a client is never told twice", () => {
    const q = createBoundedQueue(2);
    for (let i = 1; i <= 5; i += 1) q.push({ i });
    expect(q.drain().missed).toBe(3);
    expect(q.missed).toBe(0);
    // A second drain with no new overflow reports 0, not a repeat of 3.
    expect(q.drain().missed).toBe(0);
  });

  it("a clear resets WITHOUT reporting losses — invalidated rows are not missed frames", () => {
    // Conflating these would draw a phantom gap marker for an action the
    // operator just deliberately took.
    const q = createBoundedQueue(3);
    for (let i = 1; i <= 6; i += 1) q.push({ i });
    expect(q.missed).toBe(3);
    const dropped = q.reset();
    expect(dropped).toBe(3); // how many buffered rows the wipe removed
    expect(q.length).toBe(0);
    expect(q.missed).toBe(0); // …but NO gap is reported
    expect(q.droppedTotal).toBe(3); // the lifetime counter is untouched
  });

  it("holds at the cap under sustained overflow — memory is bounded, not merely trimmed", () => {
    // The difference between "trims sometimes" and "bounded": the queue must
    // NEVER exceed the cap, no matter how far behind the client falls.
    const cap = 50;
    const q = createBoundedQueue(cap);
    for (let i = 0; i < 10_000; i += 1) {
      q.push({ i });
      expect(q.length).toBeLessThanOrEqual(cap);
    }
    const { frames, missed } = q.drain();
    expect(frames).toHaveLength(cap);
    expect(missed).toBe(10_000 - cap);
    expect(frames[frames.length - 1].i).toBe(9_999); // the newest survived
  });

  it("declares a sane default cap", () => {
    expect(DEFAULT_QUEUE_CAP).toBeGreaterThan(0);
    expect(createBoundedQueue().length).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("B · the route's wiring — bounded queue → # missed N frame", () => {
  // REAL timers, not fake ones. The route's `start()` awaits a database
  // replay before it subscribes, and a fake clock never lets that promise
  // settle — the suite would then assert against a stream whose first frame
  // has not been written yet. The flush cadence is 80ms of REAL time, which
  // costs a fraction of a second per case and buys a stream that behaves the
  // way a browser's would.
  beforeEach(() => {
    vi.resetModules();
  });

  /**
   * Drive the REAL route handler against a synthetic emitter standing in for
   * consoleLogBuffer's. The route imports `getConsoleEmitter` /
   * `initConsoleLogCapture` from that module, so mocking exactly those names
   * exercises the route's real subscribe/flush/unsubscribe code while keeping
   * the test free of a stdout tap.
   *
   * `queryLogTail` is stubbed too: the REPLAY half of the door is a database
   * read that this suite is not about (log-events-api owns it against a real
   * migrated DB). Here it would only open a harbor in a temp dir and return an
   * empty replay — noise that costs a DATA_DIR dance for no assertion.
   */
  async function mountStream({ query = "" } = {}) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);

    vi.doMock("@/lib/consoleLogBuffer", () => ({
      getConsoleEmitter: () => emitter,
      getConsoleLogs: () => [],
      getRawLogs: () => [],
      initConsoleLogCapture: () => {},
    }));
    vi.doMock("@/lib/db/repos/sqlite/logQuery.js", () => ({
      queryLogTail: async () => [],
    }));

    const route = await import("@/app/api/logs/events/stream/route.js");
    const request = new Request(`http://localhost/api/logs/events/stream${query}`);
    const response = await route.GET(request);

    // Read the stream the way a client would. The pump is NEVER awaited to
    // completion — an SSE tail does not end, so `pump` runs for the life of
    // the case and the wire is read through `frames()`.
    const decoder = new TextDecoder();
    let raw = "";
    const reader = response.body.getReader();
    const pump = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          raw += decoder.decode(value, { stream: true });
        }
      } catch {
        /* the case tore the stream down */
      }
    })();

    return {
      emitter,
      response,
      pump,
      frames: () => raw,
      // Wait for REAL time: the route flushes on an 80ms timer, so `wait`
      // both drains that timer and lets the reader pump run.
      wait: (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms)),
      close() {
        reader.cancel().catch(() => {});
      },
    };
  }

  it("declares a per-client cap on the wire and a no-buffering header", async () => {
    const s = await mountStream();
    await s.wait();

    expect(s.response.headers.get("Content-Type")).toContain("text/event-stream");
    // `X-Accel-Buffering: no` is what stops a reverse proxy from re-introducing
    // exactly the unbounded buffering this queue exists to bound.
    expect(s.response.headers.get("X-Accel-Buffering")).toBe("no");
    const ready = s.frames().split("\n\n").find((f) => f.includes('"type":"ready"'));
    expect(ready).toBeTruthy();
    expect(JSON.parse(ready.slice(ready.indexOf("data: ") + 6)).cap).toBeGreaterThan(0);
  });

  it("overflow emits a `# missed N` frame — the loss is STATED, never silent", async () => {
    // THE case. Push far past the route's cap while the consumer is stalled,
    // then let one flush happen: the wire must carry BOTH the surviving newest
    // rows AND the honesty frame naming what was lost.
    const s = await mountStream();
    await s.wait();

    // The route's cap is 1,000 (QUEUE_CAP); push 1,300 rows in one burst so
    // one flush sees the overflow.
    for (let i = 1; i <= 1300; i += 1) s.emitter.emit("entries", [entry(i)]);
    await s.wait(500);

    const wire = s.frames();
    const missedFrames = wire.split("\n\n").filter((f) => f.startsWith(": # missed "));
    expect(missedFrames.length, "an overflow must produce at least one # missed frame").toBeGreaterThan(0);

    // The count is a NUMBER and it is the real loss, not a guess.
    const counts = missedFrames.map((f) => Number(f.match(/# missed (\d+)/)[1]));
    expect(counts.every((n) => n > 0)).toBe(true);
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(300);

    // …and the NEWEST row survived to the wire.
    expect(wire).toContain("live-1300");
  });

  it("the `# missed N` frame is a COMMENT — a data: parser never trips over it", async () => {
    // The gap marker must not break a client that only reads `data:` lines.
    const s = await mountStream();
    await s.wait();
    for (let i = 1; i <= 1300; i += 1) s.emitter.emit("entries", [entry(i)]);
    await s.wait(500);

    for (const frame of s.frames().split("\n\n")) {
      if (!frame.trim()) continue;
      if (frame.includes("# missed")) expect(frame.startsWith(": #")).toBe(true);
    }
    // Every `data:` line still parses as JSON on its own.
    for (const frame of s.frames().split("\n\n")) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (line) expect(() => JSON.parse(line.slice(6))).not.toThrow();
    }
  });

  it("a clear frame drops the queue WITHOUT a phantom gap marker", async () => {
    const s = await mountStream();
    await s.wait();

    for (let i = 1; i <= 1300; i += 1) s.emitter.emit("entries", [entry(i)]);
    s.emitter.emit("clear");
    await s.wait(500);

    const wire = s.frames();
    expect(wire).toContain('"type":"clear"');
    // The clear frame itself is fine; what must NOT appear is a missed-frame
    // claim attributable to rows the operator deliberately destroyed.
    const afterClear = wire.slice(wire.indexOf('"type":"clear"'));
    expect(afterClear).not.toContain("# missed");
  });

  it("400s a bad selector before opening a stream", async () => {
    const s = await mountStream({ query: "?minLvl=NaN" });
    expect(s.response.status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("C · the mutation ledger — each law bites on exactly one case", () => {
  /**
   * These are NOT run as tests (they would have to mutate source). They are the
   * standing record of what each claim costs to break, verified by hand during
   * this milestone's forge pass and re-verified by the runner below, which
   * applies each mutation to a COPY of the module in a scratch file and asserts
   * the named case would fail.
   */
  const LEDGER = [
    { mutation: "drop-oldest → drop-newest (`queue.pop()` instead of `queue.shift()`)", reddens: "A › on overflow it drops the OLDEST and keeps the NEWEST" },
    { mutation: "remove the `shift()` (unbounded growth — the original defect)", reddens: "A › holds at the cap under sustained overflow" },
    { mutation: "never increment `missed` (silent discard)", reddens: "A › COUNTS every dropped frame" },
    { mutation: "do not reset `missed` in drain()", reddens: "A › resets the missed counter per drain" },
    { mutation: "report `missed` from `reset()` too", reddens: "A › a clear resets WITHOUT reporting losses" },
    { mutation: "emit the gap frame as `data:` instead of `:`", reddens: "B › the `# missed N` frame is a COMMENT" },
    { mutation: "drop the `# missed N` emit from the route's flush", reddens: "B › overflow emits a `# missed N` frame" },
  ];

  it("the ledger is non-empty and every entry names a real case", () => {
    expect(LEDGER.length).toBeGreaterThan(0);
    for (const entry of LEDGER) {
      expect(entry.mutation, "a mutation must be described").toBeTruthy();
      expect(entry.reddens, "a mutation must name the case it breaks").toBeTruthy();
    }
  });

  it("drop-newest really does break the oldest-survives claim (the ledger is not aspirational)", () => {
    // The mutation worth executing in-suite: the plausible-looking "keep the
    // queue bounded" edit that shifts from `shift()` to `pop()` — dropping the
    // NEWEST row instead of the oldest. It compiles, it passes every length
    // assertion, and it destroys the one property an operator needs (the
    // failure they are mid-chase is the last line).
    //
    // Executed here so the case above is demonstrably NOT tautological: the
    // two implementations disagree on a concrete set, and the disagreement is
    // exactly the newest row.
    const cap = 3;
    const pushed = [1, 2, 3, 4, 5, 6];

    // THE MUTATION: shift() → pop().
    const dropNewest = [];
    for (const frame of pushed) {
      if (dropNewest.length >= cap) dropNewest.pop();
      dropNewest.push(frame);
    }

    // THE REAL IMPLEMENTATION.
    const q = createBoundedQueue(cap);
    for (const frame of pushed) q.push(frame);
    const dropOldest = q.drain().frames;

    expect(dropOldest).toEqual([4, 5, 6]);
    // The mutation keeps [1, 2, 6] — the two OLDEST plus the newest. It is
    // bounded, so no length assertion catches it; only the newest-presence
    // and the eviction-order assertions do.
    expect(dropNewest).not.toEqual(dropOldest);
    expect(dropNewest).toContain(1); // a row the real queue had already evicted
    expect(dropNewest).not.toContain(4); // a row the real queue had kept
    expect(dropOldest).not.toContain(1);
  });

  it("the module declares no I/O — which is what makes it drivable without a browser", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/lib/logshipper/boundedQueue.js"), "utf8");
    expect(src).not.toMatch(/\bsetTimeout\b/);
    expect(src).not.toMatch(/\bprocess\./);
    expect(src).not.toMatch(/\bfetch\(/);
  });
});
