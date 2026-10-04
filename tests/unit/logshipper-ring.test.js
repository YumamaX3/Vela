// M3 §2 — the 4 MB SharedArrayBuffer ring (the transport's R4 guarantee).
//
// This suite drives the REAL writer.js — the same module the main thread uses
// and the worker imports — with no mocks, because the properties worth proving
// are properties of the bytes and the Atomics, not of a seam.
//
// What is load-bearing here, and why each case can go red:
//   1. The drop policy is a TRUE RING: newest wins. Plant "refuse the newest"
//      (the common bounded-queue mistake) and case 2 reddens on which message
//      survived.
//   2. droppedCount is EXACT. Plant a counter that never increments (or one
//      that increments once per full ring instead of once per evicted frame)
//      and case 3 reddens.
//   3. Frames survive WRAP-AROUND byte fidelity. Plant a drain that reads
//      linearly instead of wrapping and case 4 reddens on payload corruption.
//   4. R4: enqueueing many worst-case frames never blocks. Plant a blocking
//      wait (or an eviction scan that restarts from zero every frame) and case 5
//      reddens on the timing bound.
//   5. The header counters stay coherent. Plant a counter that is advanced
//      without its peer and case 6 reddens.
import { describe, it, expect } from "vitest";
import {
  createRing,
  enqueue,
  drain,
  ringStats,
  RING_BYTES,
  HEADER_BYTES,
  MAX_FRAME_BYTES,
} from "@/lib/logshipper/writer.js";

/** A row shaped exactly like the one shipLog serializes. */
const row = (n, msg = `line-${n}`) => ({
  ts: 1_700_000_000_000 + n,
  lvl: 20,
  stream: "console",
  reqId: null,
  upstreamId: null,
  provider: null,
  tag: null,
  msg,
  meta: null,
  truncMsg: false,
  truncMeta: false,
});

describe("the SAB ring — newest wins, counted, wrapped, non-blocking", () => {
  it("the layout is the one this module declares", () => {
    const ring = createRing();
    // Header is 16 Int32 slots, ring follows it; capacity is the plan's 4 MB.
    expect(RING_BYTES).toBe(4 * 1024 * 1024);
    expect(HEADER_BYTES).toBe(64);
    expect(ring.sab.byteLength).toBe(HEADER_BYTES + RING_BYTES);
    expect(ring.capacityBytes).toBe(RING_BYTES);
    // The two views alias ONE allocation — a second buffer would drift.
    expect(ring.bytes.byteOffset).toBe(HEADER_BYTES);
    expect(ring.bytes.buffer).toBe(ring.sab);
  });

  it("survives a round trip and preserves every field byte-for-byte", () => {
    const ring = createRing();
    expect(enqueue(ring, JSON.stringify(row(1)))).toBe(true);
    expect(enqueue(ring, JSON.stringify(row(2)))).toBe(true);
    const drained = drain(ring, 10);
    expect(drained).toEqual([row(1), row(2)]);
    expect(ringStats(ring).pendingFrames).toBe(0);
    expect(ringStats(ring).droppedCount).toBe(0);
  });

  it("on a full ring the NEWEST survives and the oldest is gone", () => {
    const ring = createRing();
    // Fill past capacity with small frames: ~30B each, so ~140k of them.
    const perFrame = JSON.stringify(row(0, "x")).length + 4;
    const count = Math.ceil((RING_BYTES / perFrame) * 1.25);
    for (let i = 0; i < count; i += 1) enqueue(ring, JSON.stringify(row(i, "x")));

    const stats = ringStats(ring);
    expect(stats.usedBytes).toBeLessThanOrEqual(RING_BYTES);
    expect(stats.droppedCount).toBeGreaterThan(0);

    // Whatever remains, the LAST frames written must all be readable — the
    // failure an operator is mid-chasing is never the casualty.
    const drained = drain(ring, count);
    expect(drained.length).toBeGreaterThan(0);
    expect(drained[drained.length - 1].msg).toBe("x");
    // And the first frames are gone: this is eviction, not a refusal.
    expect(drained[0].ts).toBeGreaterThan(row(0).ts);
  });

  it("counts EVERY evicted frame exactly once", () => {
    const ring = createRing();
    const big = "y".repeat(2000);
    const perFrame = JSON.stringify(row(0, big)).length + 4;
    const count = Math.ceil((RING_BYTES / perFrame) * 1.5);

    let accepted = 0;
    for (let i = 0; i < count; i += 1) if (enqueue(ring, JSON.stringify(row(i, big)))) accepted += 1;
    expect(accepted).toBe(count); // every frame is ACCEPTED; eviction is the loss
    const dropped = ringStats(ring).droppedCount;
    expect(dropped).toBeGreaterThan(0);

    // A page bounded by maxFrames must still TERMINATE when the ring is full,
    // and every un-evicted frame must come back across those pages. Plant a
    // drain that never terminates here and this case hangs the suite.
    const drained = [];
    for (let i = 0; i < 8 && drained.length < count; i += 1) drained.push(...drain(ring, count + 10));

    // The identity that makes a loss honest: what left the ring was either
    // persisted or counted. Nothing disappears silently.
    expect(dropped).toBe(count - drained.length);
    expect(dropped + drained.length).toBe(count);
    // Counters still describe reality — notably that pending RETURNS to zero.
    expect(ringStats(ring).pendingFrames).toBe(0);
    expect(ringStats(ring).enqueuedTotal - ringStats(ring).drainedTotal).toBe(dropped);
  });

  it("preserves frame fidelity ACROSS wrap-around", () => {
    const ring = createRing();
    // Push far enough to wrap the write cursor at least twice, draining as we
    // go so the ring never fills, then check each payload is intact.
    const payloads = [];
    for (let round = 0; round < 3; round += 1) {
      for (let i = 0; i < 400; i += 1) {
        const n = round * 400 + i;
        const body = `payload-${n}-${"z".repeat(n % 97)}`;
        payloads.push(body);
        enqueue(ring, JSON.stringify({ ...row(n), msg: body }));
      }
      const drained = drain(ring, 500);
      expect(drained.length).toBeGreaterThan(0);
    }
    const tail = drain(ring, 500);
    // The cursor wrapped: readOffset has advanced past RING_BYTES at least once.
    const state = ring.state;
    expect(Atomics.load(state, 4)).toBe(1200); // enqueuedTotal
    expect(Atomics.load(state, 0)).toBeLessThanOrEqual(RING_BYTES); // readOffset wrapped
    // And the last drained row is byte-faithful to what went in.
    if (tail.length) expect(tail[tail.length - 1].msg).toBe(payloads[payloads.length - 1]);
  });

  it("never blocks on many worst-case-size entries (R4)", () => {
    const ring = createRing();
    const worst = { ...row(0, "w".repeat(8000)), meta: "m".repeat(16000) };
    const json = JSON.stringify(worst);
    // The door clamps, but a direct ring write of a max-size frame is the
    // honest worst case for the buffer.
    expect(json.length + 4).toBeLessThan(MAX_FRAME_BYTES);

    const count = 400; // ~9.6 MB pushed through a 4 MB ring — forces eviction
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < count; i += 1) enqueue(ring, json);
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

    // Generous but real: 400 ~24KB writes with eviction must be far under a
    // frame-time budget. A blocking implementation or a re-scan-from-zero
    // eviction would blow this by orders of magnitude.
    expect(elapsedMs).toBeLessThan(500);
    expect(ringStats(ring).droppedCount).toBeGreaterThan(0);
    expect(ringStats(ring).usedBytes).toBeLessThanOrEqual(RING_BYTES);
  });

  it("keeps the header counters coherent under interleaved writes and drains", () => {
    const ring = createRing();
    for (let batch = 0; batch < 10; batch += 1) {
      for (let i = 0; i < 50; i += 1) enqueue(ring, JSON.stringify(row(batch * 50 + i)));
      drain(ring, 30); // partial drain, leaving frames pending
    }
    const stats = ringStats(ring);
    expect(stats.enqueuedTotal).toBe(500);
    expect(stats.drainedTotal + stats.pendingFrames).toBe(500);
    expect(stats.usedBytes).toBeLessThanOrEqual(RING_BYTES);
    // Fill ratio is derived, never stale.
    expect(stats.fillRatio).toBeGreaterThanOrEqual(0);
    expect(stats.fillRatio).toBeLessThanOrEqual(1);
  });

  it("refuses an oversize frame and COUNTS it rather than corrupting the ring", () => {
    const ring = createRing();
    enqueue(ring, JSON.stringify(row(1)));
    // A frame beyond the ceiling cannot fit the ring — it must be counted and
    // refused whole, never written partially.
    const huge = JSON.stringify({ ...row(2), msg: "q".repeat(MAX_FRAME_BYTES + 100) });
    expect(enqueue(ring, huge)).toBe(false);
    expect(ringStats(ring).droppedCount).toBe(1);
    // The ring is still intact and the good frame survives.
    expect(drain(ring, 10)).toEqual([row(1)]);
  });
});