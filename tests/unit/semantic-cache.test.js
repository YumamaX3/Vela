// Semantic cache (F-7) — exact-key reuse, ported from 9router-go.
//
// Pinned: discriminating parameters (text, image bytes, tools, temperature,
// max_tokens), stream exclusion, TTL, LRU bound, session isolation, and the
// SQLite shelf that survives a restart.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildCacheKey, SemanticCache } from "@/lib/semanticCache.js";

const BASE = {
  model: "gpt-test",
  messages: [{ role: "user", content: "hello" }],
};

describe("cache key", () => {
  it("is stable for identical requests and changes with every discriminator", () => {
    const key = buildCacheKey("", BASE);
    expect(buildCacheKey("", BASE)).toBe(key);

    expect(buildCacheKey("s1", BASE)).not.toBe(key);
    expect(buildCacheKey("", { ...BASE, model: "other" })).not.toBe(key);
    expect(buildCacheKey("", { ...BASE, messages: [{ role: "user", content: "hello!" }] })).not.toBe(key);
    expect(buildCacheKey("", { ...BASE, temperature: 0.2 })).not.toBe(key);
    expect(buildCacheKey("", { ...BASE, max_tokens: 16 })).not.toBe(key);
    expect(buildCacheKey("", { ...BASE, tools: [{ type: "function", function: { name: "x" } }] })).not.toBe(key);
  });

  it("hashes multimodal payloads, not just their text", () => {
    const a = { ...BASE, messages: [{ role: "user", content: [
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ] }] };
    const b = { ...BASE, messages: [{ role: "user", content: [
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
    ] }] };
    expect(buildCacheKey("", a)).not.toBe(buildCacheKey("", b));
  });

  it("returns no key for a body without messages", () => {
    expect(buildCacheKey("", { model: "x" })).toBe("");
    expect(buildCacheKey("", null)).toBe("");
  });
});

describe("SemanticCache", () => {
  it("stores and serves a non-streaming body", () => {
    const cache = new SemanticCache({ enabled: true, ttlMs: 60_000, maxEntries: 10 });
    expect(cache.lookup("s", BASE)).toBeNull();
    cache.storeResponse("s", BASE, '{"ok":true}');
    const hit = cache.lookup("s", BASE);
    expect(hit.responseBody).toBe('{"ok":true}');
    expect(cache.stats().hits).toBe(1);
    expect(cache.stats().misses).toBe(1);
  });

  it("never caches or serves streams", () => {
    const cache = new SemanticCache({ enabled: true });
    expect(cache.storeResponse("s", { ...BASE, stream: true }, "data: x")).toBeNull();
    expect(cache.lookup("s", { ...BASE, stream: true })).toBeNull();
    expect(cache.store.size).toBe(0);
  });

  it("does not cross sessions", () => {
    const cache = new SemanticCache({ enabled: true });
    cache.storeResponse("alice", BASE, '{"for":"alice"}');
    expect(cache.lookup("bob", BASE)).toBeNull();
    expect(cache.lookup("alice", BASE).responseBody).toBe('{"for":"alice"}');
  });

  it("expires by TTL and evicts by LRU bound", () => {
    const cache = new SemanticCache({ enabled: true, ttlMs: 1, maxEntries: 2 });
    cache.storeResponse("", BASE, "one");
    const key = cache.store.items.keys().next().value;
    cache.store.items.get(key).storedAtMs = Date.now() - 1000; // age it
    expect(cache.lookup("", BASE)).toBeNull();

    const fresh = new SemanticCache({ enabled: true, ttlMs: 60_000, maxEntries: 2 });
    fresh.storeResponse("", { ...BASE, messages: [{ role: "user", content: "a" }] }, "a");
    fresh.storeResponse("", { ...BASE, messages: [{ role: "user", content: "b" }] }, "b");
    fresh.storeResponse("", { ...BASE, messages: [{ role: "user", content: "c" }] }, "c");
    expect(fresh.store.size).toBe(2);
    expect(fresh.lookup("", { ...BASE, messages: [{ role: "user", content: "a" }] })).toBeNull();
  });

  it("invalidates by model, age and signature", async () => {
    const cache = new SemanticCache({ enabled: true, ttlMs: 60_000 });
    cache.storeResponse("", { ...BASE, messages: [{ role: "user", content: "1" }] }, "1");
    cache.storeResponse("", { ...BASE, model: "other", messages: [{ role: "user", content: "2" }] }, "2");
    expect(cache.invalidateByModel("other")).toBe(1);
    expect(cache.store.size).toBe(1);
    const key = cache.store.items.keys().next().value;
    expect(cache.deleteEntry(key)).toBe(true);
    expect(cache.store.size).toBe(0);

    cache.storeResponse("", BASE, "3");
    expect(cache.invalidateOlderThan(60_000)).toBe(0); // still fresh
    await new Promise((r) => setTimeout(r, 2));
    expect(cache.invalidateOlderThan(0)).toBe(1);
  });
});

describe("SQLite shelf", () => {
  let tempDir;
  const saved = {};
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-scache-"));
    saved.DATA_DIR = process.env.DATA_DIR;
    saved.MODE = process.env.VELA_DB_MODE;
    process.env.DATA_DIR = tempDir;
    delete process.env.VELA_DB_MODE;
    delete global._dbAdapter;
    vi.resetModules();
  });
  afterEach(() => {
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("persists an entry, hydrates it, and clears it", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const repo = await import("@/lib/db/repos/sqlite/semanticCacheRepo.js");
    const { semanticCache, configureSemanticCache } = await import("@/lib/semanticCache.js");
    const { ensureSemanticCacheHydrated } = await import("@/lib/semanticCacheDb.js");
    configureSemanticCache({ enabled: true, ttlMs: 60_000 });

    semanticCache.storeResponse("shelf", BASE, '{"shelf":true}');
    await new Promise((r) => setTimeout(r, 20)); // fire-and-forget disk write
    expect(await repo.countSemanticCacheEntries()).toBe(1);

    semanticCache.store.clear();
    await ensureSemanticCacheHydrated();
    expect(semanticCache.lookup("shelf", BASE)?.responseBody).toBe('{"shelf":true}');

    semanticCache.clear();
    await new Promise((r) => setTimeout(r, 20));
    expect(await repo.countSemanticCacheEntries()).toBe(0);
  });
});
