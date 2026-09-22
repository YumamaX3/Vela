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
