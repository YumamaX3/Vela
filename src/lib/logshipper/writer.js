/**
 * writer.js — the 4 MB SharedArrayBuffer ring (sealed plan r3 §2, R4).
 *
 * ═══ THE LAYOUT (chosen here, stated once) ═══
 *   One SharedArrayBuffer, 64-byte Int32 header + a 4 MB byte ring:
 *
 *     offset 0   ┌────────────────────────────────────────────┐
 *               │ Int32Array state — 16 slots (64 bytes)      │
 *     offset 64 ├────────────────────────────────────────────┤
 *               │ Uint8Array ring — 4,194,304 bytes           │
 *               │   frame: [u32 LE length][JSON payload bytes]│
 *     offset 4194368 └────────────────────────────────────────────┘
 *
 *   Header slots (Int32 indices):
 *     0 readOffset   bytes — the consumer's cursor (worker advances it)
 *     1 writeOffset  bytes — the producer's cursor (main thread advances it)
 *     2 droppedCount frames evicted because the ring was full (both sides add)
 *     3 pendingFrames  frames written but not yet consumed
 *     4 enqueuedTotal  monotonic frames ever written
 *     5 drainedTotal   monotonic frames ever consumed
 *     6..15 reserved (zero)
 *
 * ═══ WHY ONE BUFFER ═══
 *   Two views over one allocation, so the header and the ring can never drift
 *   apart and the whole transport is a single transferable-by-reference object
 *   the worker receives in `workerData`. The header is Int32-aligned by
 *   construction (offset 0), and the ring starts at 64 — 4-byte aligned, which
 *   a byte-copy reader also wants.
 *
 * ═══ R4: NEVER BLOCKS ═══
 *   There is no lock, no `Atomics.wait`, no unbounded loop. A write is a memcpy
 *   of one frame plus — at most — a walk over the frames it evicts. Eviction
 *   walks FRAME BOUNDARIES, never bytes, and stops the instant space exists.
 *   The worst case is a ring full of minimum-size frames (4 bytes each), so at
 *   most RING/4 ≈ 1.05M boundary reads to free the 64 KB a maximum frame needs;
 *   in practice frames are ≳ 40 bytes, so it is tens of reads, not millions.
 *
 * ═══ TRUE RING, NEWEST WINS (the drop policy) ═══
 *   On a full ring the OLDEST bytes are overwritten and the newest line — the
 *   failure the operator is mid-chasing — always survives. Every evicted frame
 *   increments `droppedCount`, so a loss is counted either way and never
 *   silent. Bounded memory, newest-wins, honest accounting.
 *
 *   The invariant that makes the walk safe: a frame's bytes are fully written
 *   BEFORE `writeOffset` is published, and the consumer only ever advances
 *   `readOffset` past frames it has finished with. So every frame boundary in
 *   [readOffset, writeOffset) is stable for both sides at once.
 *
 * ═══ WORKER ALIAS LAW ═══
 *   This module imports NOTHING — not `@/`, not a node builtin. It is pure
 *   Web-standard globals (SharedArrayBuffer / TypedArrays / Atomics /
 *   TextEncoder), so `worker.js` can import it relatively and a real Worker
 *   spawn resolves it with no alias and no bundler. Measured, not assumed.
 */

/** 4 MB ring — the plan's number. */
export const RING_BYTES = 4 * 1024 * 1024;
/** Header is 16 Int32 slots. */
export const HEADER_SLOTS = 16;
export const HEADER_BYTES = HEADER_SLOTS * 4;

/**
 * Maximum single frame. The clamps at the write door bound a payload at
 * 8,000 chars of msg + 16,000 of meta; JSON escaping can double the worst case
 * (a msg of nothing but `"` and `\`), so ≈ 48.5 KB of payload plus field names.
 * 64 KB is the ceiling with margin — and a frame that could never fit the ring
 * is counted as dropped rather than allowed to corrupt it.
 */
export const MAX_FRAME_BYTES = 64 * 1024;

/** Header slot indices — named, never a bare number at a call site. */
export const SLOT_READ_OFFSET = 0;
export const SLOT_WRITE_OFFSET = 1;
export const SLOT_DROPPED = 2;
export const SLOT_PENDING = 3;
export const SLOT_ENQUEUED = 4;
export const SLOT_DRAINED = 5;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Allocate the transport. One call per process; the returned `sab` is what the
 * worker receives in `workerData`.
 */
export function createRing() {
  const sab = new SharedArrayBuffer(HEADER_BYTES + RING_BYTES);
  return {
    sab,
    state: new Int32Array(sab, 0, HEADER_SLOTS),
    bytes: new Uint8Array(sab, HEADER_BYTES, RING_BYTES),
    capacityBytes: RING_BYTES,
  };
}

function writeUint32LE(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function readUint32LE(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

/** Bytes currently held in the ring: write cursor − read cursor, wrapped. */
function usedBytes(state) {
  const w = Atomics.load(state, SLOT_WRITE_OFFSET);
  const r = Atomics.load(state, SLOT_READ_OFFSET);
  return w >= r ? w - r : w + RING_BYTES - r;
}

/**
 * Push ONE serialized entry into the ring. Never blocks, never waits.
 *
 * @param {object} ring          from createRing()
 * @param {string} json          the compact JSON row (UTF-8 encoded here)
 * @returns {boolean}            true = accepted; false = dropped (too big)
 */
export function enqueue(ring, json) {
  const { state, bytes } = ring;
  const payload = textEncoder.encode(json);
  const frameBytes = 4 + payload.length;

  // A frame that cannot fit the ring at all, or that breaches the ceiling, is
  // counted and refused. It must never be written partially.
  if (frameBytes > MAX_FRAME_BYTES || frameBytes > RING_BYTES) {
    Atomics.add(state, SLOT_DROPPED, 1);
    return false;
  }

  let read = Atomics.load(state, SLOT_READ_OFFSET);
  let write = Atomics.load(state, SLOT_WRITE_OFFSET);
  let used = usedBytes(state);

  // Evict oldest frames until this one fits. Each iteration frees one whole
  // frame and counts it. Bounded by the ring size; never spins.
  //
  // An evicted frame is no longer PENDING as well as no longer readable:
  // advancing the read cursor alone would leave pendingFrames permanently
  // inflated, so the eviction law decrements both counters it invalidates.
  // Without this, pending never returns to zero after any overflow.
  while (used + frameBytes > RING_BYTES) {
    const evicted = 4 + readUint32LE(bytes, read % RING_BYTES);
    read = (read + evicted) % RING_BYTES;
    used -= evicted;
    Atomics.add(state, SLOT_DROPPED, 1);
    Atomics.sub(state, SLOT_PENDING, 1);
  }

  // Write the length prefix and payload, wrapping as needed. Both writes land
  // before writeOffset is published, so a reader never sees a partial frame.
  const lengthAt = write;
  writeUint32LE(bytes, lengthAt % RING_BYTES, payload.length);

  const dataAt = (write + 4) % RING_BYTES;
  const firstChunk = Math.min(payload.length, RING_BYTES - dataAt);
  bytes.set(payload.subarray(0, firstChunk), dataAt);
  if (firstChunk < payload.length) {
    bytes.set(payload.subarray(firstChunk), 0);
  }

  Atomics.store(state, SLOT_READ_OFFSET, read);
  Atomics.store(state, SLOT_WRITE_OFFSET, (lengthAt + frameBytes) % RING_BYTES);
  Atomics.add(state, SLOT_PENDING, 1);
  Atomics.add(state, SLOT_ENQUEUED, 1);
  return true;
}

/**
 * Consumer side: read up to `maxFrames` whole frames.
 *
 * Publishes the new read cursor and the pending/drained counters only after
 * every frame's payload has been decoded, so the producer can never observe a
 * cursor that has outrun the bytes behind it.
 *
 * @returns {Array<object>} decoded rows (one JSON.parse per frame)
 */
export function drain(ring, maxFrames = 500) {
  const { state, bytes } = ring;
  const read = Atomics.load(state, SLOT_READ_OFFSET);
  const write = Atomics.load(state, SLOT_WRITE_OFFSET);
  const rows = [];

  let cursor = read;
  let consumed = 0;
  // A page must terminate even when the ring stays FULL: a caller asking for
  // maxFrames frames must never hold the cursor hostage, because the space it
  // frees is immediately refilled by the producer. The stopping condition is
  // "maxFrames, or the cursor stopped advancing" — the second clause is what
  // guarantees termination under a live producer.
  while (rows.length < maxFrames && cursor !== write) {
    const cursorBefore = cursor;
    const len = readUint32LE(bytes, cursor % RING_BYTES);
    const dataAt = (cursor + 4) % RING_BYTES;
    const firstChunk = Math.min(len, RING_BYTES - dataAt);
    let json;
    if (firstChunk === len) {
      json = textDecoder.decode(bytes.subarray(dataAt, dataAt + len));
    } else {
      const joined = new Uint8Array(len);
      joined.set(bytes.subarray(dataAt, RING_BYTES), 0);
      joined.set(bytes.subarray(0, len - firstChunk), firstChunk);
      json = textDecoder.decode(joined);
    }
    try {
      rows.push(JSON.parse(json));
    } catch {
      // A frame we cannot parse is a transport defect, not a reason to stall the
      // cursor: skip it so the ring cannot wedge, and keep draining.
    }
    cursor = (cursor + 4 + len) % RING_BYTES;
    consumed += 1;
    // Terminate only when the cursor genuinely stopped advancing. A frame that
    // fails to parse still advances it — the ring must not wedge on a corrupt
    // frame — but produces no row, so row-count alone is not real progress.
    if (cursor === cursorBefore) break;
  }

  if (consumed > 0) {
    Atomics.store(state, SLOT_READ_OFFSET, cursor);
    Atomics.add(state, SLOT_PENDING, -consumed);
    Atomics.add(state, SLOT_DRAINED, consumed);
  }
  return rows;
}

/** Live ring accounting for getLogshipperStats(). */
export function ringStats(ring) {
  const { state } = ring;
  const used = usedBytes(state);
  return {
    usedBytes: used,
    capacityBytes: RING_BYTES,
    fillRatio: RING_BYTES === 0 ? 0 : Number((used / RING_BYTES).toFixed(4)),
    pendingFrames: Atomics.load(state, SLOT_PENDING),
    droppedCount: Atomics.load(state, SLOT_DROPPED),
    enqueuedTotal: Atomics.load(state, SLOT_ENQUEUED),
    drainedTotal: Atomics.load(state, SLOT_DRAINED),
  };
}