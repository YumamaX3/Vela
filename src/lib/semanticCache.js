// SEMANTIC CACHE — exact-key prompt/response reuse for non-streaming chats.
//
// Ported from 9router-go `internal/semanticcache`. Despite the name, the key
// is exact: a SHA-256 over the session id, model, messages (text AND image/file
// payloads), tools, tool_choice, temperature and the parameters that shape the
// completion. "Semantic" here means "the same request shape", not embeddings —
// the Go harbor deliberately chose a deterministic key over a vector store so
// a cache hit can never return a subtly wrong answer.
//
// The laws that keep it safe:
//   • STREAMS ARE NEVER CACHED. A streamed body is not a body until it ends.
//   • SESSIONS ARE PART OF THE KEY when a session header is present, so two
//     callers behind one gateway do not read each other's answers.
//   • EVERY DISCRIMINATING PARAMETER IS HASHED. A request asking max_tokens 16
//     must not receive the body produced for max_tokens 4096.
//   • THE STORE IS BOUNDED (LRU + TTL). An unbounded cache is a memory leak
//     wearing a feature's name.
import { createHash } from "node:crypto";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 1000;

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function contentBlockHash(h, block) {
  if (block == null) return;
  if (typeof block === "string") {
    h.update("block:text:");
    h.update(block);
    h.update("\n");
    return;
  }
  if (typeof block !== "object") return;
  const type = block.type ?? "";
  h.update(`block:${type}:`);
  h.update(String(block.text ?? ""));
  h.update(`|img=${block.image_url?.url ?? ""}|file=${block.file?.file_data ?? ""}`);
  h.update("\n");
}

/**
 * Deterministic cache key. Returns "" when the body is not a cacheable chat
 * request (no messages), which callers treat as a miss.
 */
export function buildCacheKey(sessionId, body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.messages) || body.messages.length === 0) {
    return "";
  }
  const h = createHash("sha256");
  if (sessionId) h.update(`session:${sessionId}\n`);
  h.update(`model:${body.model ?? ""}\n`);

  for (const message of body.messages) {
    h.update(`${message?.role ?? ""}:`);
    const content = message?.content;
    if (typeof content === "string") {
      h.update(content);
    } else if (Array.isArray(content)) {
      for (const block of content) contentBlockHash(h, block);
    }
    h.update("\n");
  }

  if (Array.isArray(body.tools) && body.tools.length) {
    h.update(`tools:${stableStringify(body.tools)}\n`);
  }
  if (body.tool_choice !== undefined && body.tool_choice !== null) {
    h.update(`tool_choice:${stableStringify(body.tool_choice)}\n`);
  }
  if (typeof body.temperature === "number") {
    h.update(`temp:${body.temperature.toFixed(4)}\n`);
  }
  if (Number.isFinite(Number(body.max_tokens))) h.update(`max_tokens:${Number(body.max_tokens)}\n`);
  if (Number.isFinite(Number(body.max_completion_tokens))) {
    h.update(`max_completion_tokens:${Number(body.max_completion_tokens)}\n`);
  }
  if (typeof body.parallel_tool_calls === "boolean") {
    h.update(`parallel_tool_calls:${body.parallel_tool_calls}\n`);
  }
  if (typeof body.reasoning_effort === "string" && body.reasoning_effort) {
    h.update(`reasoning_effort:${body.reasoning_effort}\n`);
  }
  return h.digest("hex");
}

/** Estimate tokens saved using the response's own usage block, else len/4. */
export function estimateTokens(responseBody) {
  try {
    const parsed = JSON.parse(responseBody);
    const total = Number(parsed?.usage?.total_tokens ?? 0);
    if (total > 0) return total;
  } catch { /* fall through */ }
  return Math.max(1, Math.floor(String(responseBody).length / 4));
}

export class LRUStore {
  constructor(maxEntries = DEFAULT_MAX_ENTRIES, ttlMs = DEFAULT_TTL_MS) {
    this.maxEntries = Math.max(1, Number(maxEntries) || DEFAULT_MAX_ENTRIES);
    this.ttlMs = Number(ttlMs) || 0;
    this.items = new Map(); // insertion order = LRU order (oldest first)
  }

  get(key) {
    const entry = this.items.get(key);
    if (!entry) return null;
    if (this.ttlMs > 0 && Date.now() - entry.storedAtMs > this.ttlMs) {
      this.items.delete(key);
      return null;
    }
    this.items.delete(key);
    this.items.set(key, entry); // move to the hot end
    return { ...entry };
  }

  put(key, entry) {
    if (this.items.has(key)) this.items.delete(key);
    this.items.set(key, entry);
    while (this.items.size > this.maxEntries) {
      const oldest = this.items.keys().next().value;
      this.items.delete(oldest);
    }
  }

  delete(key) {
    return this.items.delete(key);
  }

  recordHit(key, tokensSaved) {
    const entry = this.items.get(key);
    if (!entry) return;
    entry.hitCount += 1;
    entry.tokensSaved += tokensSaved;
  }

  entries() {
    const now = Date.now();
    return [...this.items.values()].filter(
      (e) => !(this.ttlMs > 0 && now - e.storedAtMs > this.ttlMs)
    );
  }

  invalidateByModel(model) {
    let count = 0;
    for (const [key, entry] of this.items) {
      if (entry.model === model) { this.items.delete(key); count++; }
    }
    return count;
  }

  invalidateOlderThan(ms) {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.items) {
      if (now - entry.storedAtMs > ms) { this.items.delete(key); count++; }
    }
    return count;
  }

  clear() {
    this.items.clear();
  }

  get size() {
    return this.items.size;
  }
}

export class SemanticCache {
  constructor({ enabled = false, ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, store = null } = {}) {
    this.config = { enabled, ttlMs, maxEntries };
    this.store = store || new LRUStore(maxEntries, ttlMs);
    this.hits = 0;
    this.misses = 0;
    this.tokensSaved = 0;
    this.persist = null; // optional async { upsert, recordHit, delete, clear, ... }
  }

  get enabled() {
    return this.config.enabled === true || typeof this.config.enabled === "function" && this.config.enabled();
  }

  lookup(sessionId, body) {
    if (!this.enabled) return null;
    if (!body || body.stream === true) return null;
    const key = buildCacheKey(sessionId, body);
    if (!key) { this.misses++; return null; }
    const entry = this.store.get(key);
    if (!entry) { this.misses++; return null; }
    if (entry.model && body.model && entry.model !== body.model) { this.misses++; return null; }
    this.hits++;
    const saved = estimateTokens(entry.responseBody);
    this.tokensSaved += saved;
    this.store.recordHit(key, saved);
    this.persist?.recordHit?.(key, saved)?.catch?.(() => {});
    return entry;
  }

  storeResponse(sessionId, body, responseBody, contentType = "application/json") {
    if (!this.enabled) return null;
    if (!body || body.stream === true || !responseBody) return null;
    const key = buildCacheKey(sessionId, body);
    if (!key) return null;
    const entry = {
      key,
      model: body.model ?? "",
      responseBody: String(responseBody),
      contentType: contentType || "application/json",
      storedAt: new Date().toISOString(),
      storedAtMs: Date.now(),
      hitCount: 0,
      tokensSaved: 0,
    };
    this.store.put(key, entry);
    this.persist?.upsert?.(entry)?.catch?.(() => {});
    return entry;
  }

  deleteEntry(key) {
    const ok = this.store.delete(key);
    this.persist?.delete?.(key)?.catch?.(() => {});
    return ok;
  }

  invalidateByModel(model) {
    const count = this.store.invalidateByModel(model);
    this.persist?.invalidateByModel?.(model)?.catch?.(() => {});
    return count;
  }

  invalidateOlderThan(ms) {
    const count = this.store.invalidateOlderThan(ms);
    this.persist?.invalidateOlderThan?.(ms)?.catch?.(() => {});
    return count;
  }

  clear() {
    this.store.clear();
    this.persist?.clear?.()?.catch?.(() => {});
  }

  stats(dbEntries = 0) {
    const total = this.hits + this.misses;
    return {
      memoryEntries: this.store.size,
      dbEntries,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? ((this.hits / total) * 100).toFixed(1) : "0.0",
      tokensSaved: this.tokensSaved,
    };
  }

  listEntries({ page = 1, limit = 20, search = "", model = "", sortBy = "created_at", sortOrder = "desc" } = {}) {
    const searchLower = String(search).toLowerCase();
    const modelLower = String(model).toLowerCase();
    const filtered = this.store.entries()
      .filter((e) => (!modelLower || String(e.model).toLowerCase() === modelLower))
      .filter((e) => (!searchLower || String(e.key).toLowerCase().includes(searchLower)))
      .map((e) => ({
        id: e.key,
        signature: e.key,
        model: e.model,
        hit_count: e.hitCount,
        tokens_saved: e.tokensSaved,
        created_at: e.storedAt,
        expires_at: this.config.ttlMs > 0
          ? new Date(e.storedAtMs + this.config.ttlMs).toISOString()
          : "",
      }));

    filtered.sort((a, b) => {
      const dir = sortOrder === "asc" ? 1 : -1;
      switch (sortBy) {
        case "hits": case "hit_count": return (a.hit_count - b.hit_count) * dir;
        case "tokens_saved": return (a.tokens_saved - b.tokens_saved) * dir;
        case "model": return a.model.localeCompare(b.model) * dir;
        default: return a.created_at.localeCompare(b.created_at) * dir;
      }
    });

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);
    const start = (pageNum - 1) * limitNum;
    return { entries: filtered.slice(start, start + limitNum), total: filtered.length, page: pageNum, limit: limitNum };
  }
}

function envEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.VELA_SEMANTIC_CACHE || ""));
}

/** Process-wide cache — the chat path and the dashboard must see one store. */
export const semanticCache = new SemanticCache({
  enabled: envEnabled(),
  ttlMs: Number(process.env.VELA_SEMANTIC_CACHE_TTL_MS) || DEFAULT_TTL_MS,
  maxEntries: Number(process.env.VELA_SEMANTIC_CACHE_MAX_ENTRIES) || DEFAULT_MAX_ENTRIES,
});

/** Test seam. */
export function configureSemanticCache(options = {}) {
  if (options.enabled !== undefined) semanticCache.config.enabled = options.enabled;
  if (options.ttlMs !== undefined) semanticCache.config.ttlMs = options.ttlMs;
  if (options.maxEntries !== undefined) semanticCache.config.maxEntries = options.maxEntries;
  return semanticCache;
}

/** Extract the session id from the same headers the Go harbor honors. */
export const SESSION_HEADERS = [
  "x-claude-code-session-id",
  "x-session-id",
  "session-id",
  "session_id",
  "x-amp-thread-id",
];

export function extractSessionId(request) {
  for (const name of SESSION_HEADERS) {
    const value = request?.headers?.get?.(name);
    if (value) return value;
  }
  return "";
}
