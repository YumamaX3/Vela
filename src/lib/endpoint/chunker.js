/**
 * chunker — driver-aware batch sizing (Endpoint Observatory W1d,
 * Shorekeeper-Sealed Plan Covenant M6/F2).
 *
 * Batch operations respect the driver's transaction appetite:
 *   • native adapters (better-sqlite3 / mysql): ≤ 100 per transaction
 *   • WASM drivers (sql.js — the Docker fallback): ≤ 50 hard cap (heap)
 *
 * Pure module — chunk size is a pure function of the driver class; the
 * caller decides which class it is running on.
 */

export const CHUNK_NATIVE = 100;
export const CHUNK_WASM = 50;

/** Is this a WASM (sql.js) driver? Detect by the adapter's shape. */
export function isWasmDriver(adapter) {
  if (!adapter) return false;
  // sql.js adapters expose initPromise + are created from the sql.js module;
  // better-sqlite3 adapters expose a synchronous run/get/all.
  return !!(adapter.initPromise || adapter.constructor?.name?.includes("Sqljs"));
}

/** Chunk a list for the given driver. Returns array of sub-arrays. */
export function chunkItems(items, driverClass = "native") {
  const size = driverClass === "wasm" ? CHUNK_WASM : CHUNK_NATIVE;
  if (!Array.isArray(items) || items.length === 0) return [];
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Run a batch op over items in driver-aware chunks.
 * @param {Array} items
 * @param {(chunk, chunkIndex) => Promise<Array<{id, ok, error?}>>} fn per-chunk op
 * @param {string} driverClass "native" | "wasm"
 * @returns {{ applied: number, failed: [{id,error}], chunkCount: number }}
 */
export async function runChunked(items, fn, driverClass = "native") {
  const chunks = chunkItems(items, driverClass);
  const applied = [];
  const failed = [];
  for (let i = 0; i < chunks.length; i++) {
    const res = await fn(chunks[i], i);
    for (const r of res || []) {
      if (r?.ok) applied.push(r.id);
      else failed.push({ id: r?.id ?? "?", error: r?.error || "unknown" });
    }
  }
  return { applied, failed, chunkCount: chunks.length };
}
