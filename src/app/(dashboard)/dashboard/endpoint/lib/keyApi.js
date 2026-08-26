// Single fetch layer for every /api/keys call. All functions fail-open:
// a thrown promise never escapes — the caller gets null/[] and the UI renders
// its default state. The show-once contract lives here too: full keys are
// only ever the POST 201 payload; nothing in this layer returns secret material.

async function parseJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function listKeys() {
  try {
    const res = await fetch("/api/keys", { cache: "no-store" });
    if (!res.ok) return [];
    const data = await parseJson(res);
    return Array.isArray(data.keys) ? data.keys : [];
  } catch {
    return [];
  }
}

/**
 * Create a key. On 201 returns the one-time payload { key, keyId, keyPrefix,
 * record } — the ONLY plaintext the server ever yields. Any other status
 * returns { error }.
 */
export async function createKey(body) {
  try {
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await parseJson(res);
    if (res.status === 201) return { ok: true, created: data };
    return { ok: false, error: data.error || "Failed to create key" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function updateKey(id, body) {
  try {
    const res = await fetch(`/api/keys/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await parseJson(res);
    if (res.ok) return { ok: true, key: data.key };
    return { ok: false, error: data.error || "Failed to update key" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function deleteKey(id) {
  try {
    const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

/** PUT /api/keys/[id] — pause/resume/rotate ride the existing update surface. */
export async function keyAction(id, action) {
  return updateKey(id, { action });
}

/** Clone the limits/ACL of a key into a new one. Returns the 201 show-once payload. */
export async function duplicateKey(id) {
  try {
    const res = await fetch(`/api/keys/${id}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await parseJson(res);
    if (res.status === 201) return { ok: true, created: data };
    return { ok: false, error: data.error || "Failed to duplicate key" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * Revive a tombstoned legacy key: mint a fresh working key under the old
 * name (POST /api/keys/[id]/revive). Same 201 show-once contract as create.
 */
export async function reviveKey(id) {
  try {
    const res = await fetch(`/api/keys/${id}/revive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await parseJson(res);
    if (res.status === 201) return { ok: true, created: data };
    return { ok: false, error: data.error || "Failed to revive key" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * One-time surfacing of the migration-015 revived secrets (GET
 * /api/keys/pending-reveals). The server deletes the file after serving, so a
 * reload yields nothing — matches the show-once covenant.
 */
export async function fetchPendingReveals() {
  try {
    const res = await fetch("/api/keys/pending-reveals");
    const data = await parseJson(res);
    return Array.isArray(data.reveals) ? data.reveals : [];
  } catch {
    return [];
  }
}

/**
 * Fire a minimal chat-completions request with this key against the local
 * endpoint — proves the key works end-to-end without burning a real provider
 * call (the route validates against a deterministic local target).
 */
export async function testKey(id) {
  try {
    const res = await fetch(`/api/keys/${id}/test`, { method: "POST" });
    const data = await parseJson(res);
    if (res.ok) return { ok: true, ...data };
    return { ok: false, error: data.error || "Test request failed" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function fetchKeyUsage(period) {
  try {
    const res = await fetch(`/api/keys/usage?period=${encodeURIComponent(period)}`);
    if (!res.ok) return {};
    const data = await parseJson(res);
    return data.byKey || {};
  } catch {
    return {};
  }
}

export async function fetchKeyHealth() {
  try {
    const res = await fetch("/api/keys/health", { cache: "no-store" });
    if (!res.ok) return { keys: {}, sweep: [] };
    const data = await parseJson(res);
    return { keys: data.keys || {}, sweep: Array.isArray(data.sweep) ? data.sweep : [] };
  } catch {
    return { keys: {}, sweep: [] };
  }
}

/** Per-key recent-request micro-history (drawer "Recent activity" surface). */
export async function fetchKeyActivity(id, limit = 20) {
  try {
    const res = await fetch(`/api/keys/${id}/activity?limit=${limit}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await parseJson(res);
    return Array.isArray(data.activity) ? data.activity : [];
  } catch {
    return [];
  }
}

/** Combos catalog for the ACL chips (create + edit). Fail-open → []. */
export async function fetchCombosCatalog() {
  try {
    const res = await fetch("/api/combos", { cache: "no-store" });
    if (!res.ok) return [];
    const data = await parseJson(res);
    return Array.isArray(data.combos) ? data.combos : [];
  } catch {
    return [];
  }
}

/** Settings-only export — name/limits/ACL/category, NEVER full keys. */
export async function exportKeySettings() {
  try {
    const res = await fetch("/api/keys/export", { cache: "no-store" });
    if (!res.ok) return null;
    return parseJson(res);
  } catch {
    return null;
  }
}

/** Import key settings (name/limits/ACL/category). Returns { ok, error, created }. */
export async function importKeySettings(settings) {
  try {
    const res = await fetch("/api/keys/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: settings }),
    });
    const data = await parseJson(res);
    if (res.ok) return { ok: true, created: data.created ?? 0 };
    return { ok: false, error: data.error || "Failed to import keys" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
