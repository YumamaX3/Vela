// The key fleet's one mutation surface.
//
// Every write the deck performs goes through here, so the masthead, the drawer,
// the table and the bulk bar cannot drift into four dialects of the same call —
// and so the show-once ceremony (a 201 carries the ONLY plaintext copy that
// will ever exist) is captured in exactly one place rather than remembered at
// each call site.

import { storeKey } from "@/shared/utils/keyVault";

/** Read a response's error honestly: the routes answer `{ error }`, but a
 *  gateway or a proxy can answer HTML, and "Failed" is a worse message than
 *  whatever the harbor actually said. */
async function readJson(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = data?.error || `${res.status} ${res.statusText || "request failed"}`;
    const error = new Error(message);
    error.status = res.status;
    error.payload = data;
    throw error;
  }
  return data;
}

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ── reads ───────────────────────────────────────────────────────────────────

/** GET /api/keys — masked rows only, with the server's own paging. */
export async function fetchKeys({ limit = 500, offset = 0 } = {}) {
  const res = await fetch(`/api/keys?limit=${limit}&offset=${offset}`, { cache: "no-store" });
  const data = await readJson(res);
  return { keys: data?.keys || [], total: data?.total ?? 0 };
}
/** GET /api/keys — the WHOLE fleet, paged past the route's per-request cap.
 *
 *  The room renders every key, so it must HOLD every key; a single
 *  `fetch("/api/keys")` returns the route's default page (100) and silently
 *  drops the tail — the truncation this seam exists to prevent. Pages until the
 *  server's own `total` is reached, with a hard page ceiling so a server that
 *  misreports its count cannot spin us forever. Returns the server's `total`
 *  unchanged so a caller can still say "showing N of M" honestly. */
export async function fetchAllKeys({ pageSize = 500, maxPages = 40 } = {}) {
  const first = await fetchKeys({ limit: pageSize, offset: 0 });
  const all = [...first.keys];
  let page = 1;
  while (all.length < first.total && page < maxPages) {
    const next = await fetchKeys({ limit: pageSize, offset: all.length });
    if (!next.keys.length) break; // the fleet shrank under us — stop, don't loop
    all.push(...next.keys);
    page += 1;
  }
  return { keys: all, total: first.total };
}

/** GET /api/keys/stats — the fleet census over a usage window. */
export async function fetchStats(period = "all") {
  const res = await fetch(`/api/keys/stats?period=${encodeURIComponent(period)}`, { cache: "no-store" });
  return readJson(res);
}

/** GET /api/keys/usage — the per-key rollup the row strips read. */
export async function fetchKeyUsage(period = "all") {
  const res = await fetch(`/api/keys/usage?period=${encodeURIComponent(period)}`, { cache: "no-store" });
  const data = await readJson(res);
  return data?.byKey || {};
}

// ── writes ──────────────────────────────────────────────────────────────────

/** POST /api/keys — mints a key. The 201's plaintext is captured into the
 *  browser vault here, once, because the server will never yield it again. */
export async function createKey(payload) {
  const res = await fetch("/api/keys", json("POST", payload));
  const data = await readJson(res);
  if (data?.key && data?.keyId) storeKey(data.keyId, data.key);
  return data;
}

/** PUT /api/keys/[id] — partial update; returns the refreshed public record. */
export async function updateKey(id, patch) {
  const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, json("PUT", patch));
  const data = await readJson(res);
  return data?.key || null;
}

/** DELETE /api/keys/[id] — soft revoke (the audit row survives, hash nulled). */
export async function deleteKey(id) {
  const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  return readJson(res);
}

/** PUT /api/keys/[id] with only `isActive` — pause / resume. */
export async function setKeyActive(id, isActive) {
  return updateKey(id, { isActive });
}

/** POST /api/keys/bulk — N operations, each with its own verdict. */
export async function bulkKeys(action, payload) {
  const res = await fetch("/api/keys/bulk", json("POST", { action, ...payload }));
  return readJson(res);
}

// ── the file pair ───────────────────────────────────────────────────────────

/** GET /api/keys/export — the fleet's shape as a downloadable file. The key
 *  strings are not in it and cannot be: they are hash-at-rest and show-once. */
export function exportKeysFile() {
  if (typeof window === "undefined") return;
  const a = document.createElement("a");
  a.href = "/api/keys/export";
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** POST /api/keys/import — dry-run writes nothing and answers the plan. */
export async function importKeys(envelope, { mode = "dry-run", onConflict = "skip" } = {}) {
  const res = await fetch("/api/keys/import", json("POST", { mode, onConflict, envelope }));
  return readJson(res);
}

/** The import's chunk law — fixed here, where the endpoint's 200-entry cap and
 *  this width are read side by side.
 *
 *  The route judges and writes in one call, so the ONLY safe way to report
 *  progress honestly is to hand it the file a slice at a time and let the
 *  batches themselves be the ticks of the bar. Each chunk re-judges against the
 *  fleet as it stands, which is exactly what the operator would get from the
 *  dry run they already saw when nothing has changed underneath — and, when
 *  something HAS changed, an honest new verdict rather than a stale promise. */
export const IMPORT_CHUNK_SIZE = 20;

/** Split an export envelope's keys into `size`-sized envelopes, each still a
 *  legal `${app}` document so the route's own shape check accepts it verbatim. */
export function chunkEnvelope(envelope, size = IMPORT_CHUNK_SIZE) {
  const keys = Array.isArray(envelope?.keys) ? envelope.keys : [];
  const chunks = [];
  for (let i = 0; i < keys.length; i += size) {
    chunks.push({ ...envelope, keys: keys.slice(i, i + size) });
  }
  return chunks;
}

/** POST /api/keys/import, one chunk at a time, against the SAME endpoint.
 *
 *  `onProgress({ done, total, percent, currentName, chunkIndex, chunkCount })`
 *  fires before each chunk (with the first key in it as `currentName`) and once
 *  more after it settles, so a bar can name the key in flight and tick the
 *  moment it lands. Chunks run IN ORDER, one request at a time: the server
 *  already spreads each chunk across six workers, so the client's job is not to
 *  widen the current further but to keep every verdict attributable to a place
 *  in the file.
 *
 *  Returns the concatenated `{ created, updated, results }`. The plan's
 *  create/update/skip/refused sums were already decided at preview, where the
 *  whole file was judged at once, so they are not re-derived from the slices.
 *  A chunk that throws (a 500, a dropped network) stops the run and is
 *  re-thrown with `partial` attached: every key minted before it carries a
 *  plaintext that exists NOWHERE else, and the caller must be able to vault
 *  them before reporting the failure. */
export async function importKeysChunked(envelope, { mode = "dry-run", onConflict = "skip", size = IMPORT_CHUNK_SIZE, onProgress } = {}) {
  const chunks = chunkEnvelope(envelope, size);
  const total = chunks.reduce((n, chunk) => n + chunk.keys.length, 0);
  const created = [];
  const updated = [];
  const results = [];
  let done = 0;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const currentName = chunk.keys[0]?.name ?? null;
    onProgress?.({ done, total, percent: percentOf(done, total), currentName, chunkIndex, chunkCount: chunks.length });
    try {
      const data = await importKeys(chunk, { mode, onConflict });
      const applied = data?.applied || {};
      if (Array.isArray(applied.created)) created.push(...applied.created);
      if (Array.isArray(applied.updated)) updated.push(...applied.updated);
      if (Array.isArray(applied.results)) results.push(...applied.results);
      done += chunk.keys.length;
    } catch (error) {
      error.partial = { created, updated, results, done, total };
      error.chunkIndex = chunkIndex;
      throw error;
    }
    onProgress?.({ done, total, percent: percentOf(done, total), currentName: chunk.keys.at(-1)?.name ?? currentName, chunkIndex, chunkCount: chunks.length });
  }

  return { applied: { changed: results.filter((r) => r.ok).length, created, updated, results } };
}

function percentOf(done, total) {
  return total > 0 ? Math.round((done / total) * 100) : 100;
}
