/**
 * shareReveal — the one-time share-reveal token service (Key Domain
 * Ascension, migration 019). Hardens key sharing: the share URL carries a
 * single-use, expiring token in the URL #fragment (never a query string), and
 * the raw key is revealed only on a deliberate "Reveal" click.
 *
 * The full key never crosses a query string, never lands in server logs,
 * proxy logs, or browser history. The plaintext rides the fragment to the
 * /share page and lives in the browser only; the token itself is stored
 * in-memory here with a TTL + single-use consumption.
 *
 * Bounded exposure, documented (sealed-plan security clause): the plaintext
 * exists in server memory for ≤ TTL, and the token in the URL until it is
 * consumed or expires. This is the deliberate, bounded extension of the
 * reveal-sink precedent — never persisted, never logged.
 */

const SHARE_TTL_MS = 15 * 60_000; // 15 minutes
const SHARE_MAX = 500;

function tokenStore() {
  if (!global._velaShareTokens) global._velaShareTokens = new Map();
  return global._velaShareTokens;
}

/** Create a one-time share token for a key's plaintext. Returns the token. */
export function createShareToken(keyId, key) {
  if (typeof keyId !== "string" || typeof key !== "string" || !key) return null;
  const store = tokenStore();
  // Bound the map — evict expired first, then oldest.
  const now = Date.now();
  if (store.size >= SHARE_MAX) {
    for (const [k, v] of store) {
      if (now - v.ts > SHARE_TTL_MS) store.delete(k);
      if (store.size < SHARE_MAX) break;
    }
    if (store.size >= SHARE_MAX) {
      const oldest = store.keys().next().value;
      if (oldest) store.delete(oldest);
    }
  }
  const token = crypto.randomUUID();
  store.set(token, { keyId, key, ts: now });
  return token;
}

/**
 * Consume a share token — single-use. Returns { keyId, key } when valid and
 * fresh, null otherwise. A consumed or expired token never yields the key.
 */
export function consumeShareToken(token) {
  if (typeof token !== "string" || !token) return null;
  const store = tokenStore();
  const entry = store.get(token);
  if (!entry) return null;
  store.delete(token); // single-use — consumed on first read
  if (Date.now() - entry.ts > SHARE_TTL_MS) return null;
  return { keyId: entry.keyId, key: entry.key };
}
