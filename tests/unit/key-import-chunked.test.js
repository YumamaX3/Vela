// The import's chunk law — measured at the seam the panel actually reads.
//
// The route judges and writes in ONE call, so the only honest progress the
// client can show is "batches that have landed". These cases pin that seam:
// the envelope is split into legal `${app}` documents, chunks run IN ORDER
// against the same endpoint, every tick counts KEYS (last short chunk
// included), and a chunk that throws hands back the minted plaintexts that
// preceded it so none of them is orphaned.
import { describe, it, expect, vi, afterEach } from "vitest";
import { chunkEnvelope, importKeysChunked, IMPORT_CHUNK_SIZE } from "@/app/(dashboard)/dashboard/endpoint/lib/keyApi.js";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

const envelopeOf = (n) => ({
  app: "vela-keys",
  version: 1,
  keys: Array.from({ length: n }, (_, i) => ({ name: `key-${i}` })),
});

/** A fetch double that records each request's body and answers with one
 *  minted key per entry in it — the shape the real route returns. */
function fakeRoute({ failAtChunk = -1 } = {}) {
  const calls = [];
  let chunk = -1;
  const fn = vi.fn(async (_url, init) => {
    chunk += 1;
    const body = JSON.parse(init.body);
    calls.push(body);
    if (chunk === failAtChunk) {
      return { ok: false, status: 500, statusText: "Server Error", json: async () => ({ error: "synthetic outage" }) };
    }
    const applied = {
      changed: body.envelope.keys.length,
      created: body.envelope.keys.map((k, i) => ({ name: k.name, keyId: `id-${k.name}-${i}-${chunk}`, key: `vela-${k.name}` })),
      updated: [],
      results: body.envelope.keys.map((k) => ({ name: k.name, ok: true, action: "add" })),
    };
    return { ok: true, status: 200, json: async () => ({ mode: body.mode, applied }) };
  });
  global.fetch = fn;
  return { calls, fn };
}

describe("chunkEnvelope", () => {
  it("splits into 20-wide envelopes and carries every key exactly once, in order", () => {
    const env = envelopeOf(45);
    const chunks = chunkEnvelope(env);
    expect(IMPORT_CHUNK_SIZE).toBe(20);
    expect(chunks.map((c) => c.keys.length)).toEqual([20, 20, 5]);
    expect(chunks.flatMap((c) => c.keys.map((k) => k.name))).toEqual(env.keys.map((k) => k.name));
  });

  it("every chunk is still a legal envelope the route's shape check accepts", () => {
    for (const chunk of chunkEnvelope(envelopeOf(41))) {
      expect(chunk.app).toBe("vela-keys");
      expect(chunk.version).toBe(1);
      expect(Array.isArray(chunk.keys)).toBe(true);
    }
  });

  it("handles empty and single-chunk inputs without inventing a chunk", () => {
    expect(chunkEnvelope(envelopeOf(0))).toEqual([]);
    expect(chunkEnvelope(envelopeOf(20))).toHaveLength(1);
    expect(chunkEnvelope(null)).toEqual([]);
  });
});

describe("importKeysChunked", () => {
  it("submits bounded batches IN ORDER against the same endpoint and concatenates verdicts in file order", async () => {
    const { calls, fn } = fakeRoute();
    const result = await importKeysChunked(envelopeOf(45), { mode: "apply", onConflict: "rename" });

    expect(fn).toHaveBeenCalledTimes(3);
    for (const [, init] of fn.mock.calls) expect(init.method).toBe("POST");
    expect(fn.mock.calls.every(([url]) => url === "/api/keys/import")).toBe(true);

    expect(calls.map((b) => b.envelope.keys.length)).toEqual([20, 20, 5]);
    expect(calls.map((b) => b.envelope.keys[0].name)).toEqual(["key-0", "key-20", "key-40"]);
    expect(calls.every((b) => b.mode === "apply" && b.onConflict === "rename")).toBe(true);

    expect(result.applied.created).toHaveLength(45);
    expect(result.applied.results.map((r) => r.name)).toEqual(envelopeOf(45).keys.map((k) => k.name));
    expect(result.applied.changed).toBe(45);
  });

  it("keeps the 200 cap intact — a 200-key file is exactly ten chunks, no key dropped", async () => {
    const { calls } = fakeRoute();
    const env = envelopeOf(200);
    const result = await importKeysChunked(env, { mode: "apply" });
    expect(calls).toHaveLength(10);
    expect(calls.every((b) => b.envelope.keys.length <= 200)).toBe(true);
    expect(calls.flatMap((b) => b.envelope.keys).map((k) => k.name)).toEqual(env.keys.map((k) => k.name));
    expect(result.applied.created).toHaveLength(200);
  });

  it("ticks progress in KEYS — n of N, the current key's name, and a short last batch", async () => {
    fakeRoute();
    const ticks = [];
    await importKeysChunked(envelopeOf(45), { mode: "apply", onProgress: (p) => ticks.push(p) });

    // before + after each of 3 chunks
    expect(ticks).toHaveLength(6);
    expect(ticks.map((t) => t.done)).toEqual([0, 20, 20, 40, 40, 45]);
    expect(ticks.every((t) => t.total === 45)).toBe(true);
    expect(ticks.at(-1).percent).toBe(100);
    expect(ticks.map((t) => t.percent)).toEqual([0, 44, 44, 89, 89, 100]);
    // the key in flight names the first entry of the batch about to run
    expect(ticks[0].currentName).toBe("key-0");
    expect(ticks[2].currentName).toBe("key-20");
    expect(ticks[4].currentName).toBe("key-40");
    // batch counter
    expect(ticks[0].chunkIndex).toBe(0);
    expect(ticks[4].chunkIndex).toBe(2);
    expect(ticks[0].chunkCount).toBe(3);
  });

  it("stops at a failing chunk and hands back the plaintexts minted before it", async () => {
    fakeRoute({ failAtChunk: 1 });
    const ticks = [];
    const run = importKeysChunked(envelopeOf(45), { mode: "apply", onProgress: (p) => ticks.push(p) });

    await expect(run).rejects.toThrow("synthetic outage");
    try {
      await run;
    } catch (error) {
      expect(error.partial.done).toBe(20);
      expect(error.partial.total).toBe(45);
      expect(error.partial.created).toHaveLength(20);
      expect(error.partial.created[0].name).toBe("key-0");
      expect(error.chunkIndex).toBe(1);
    }
    // the third chunk was never sent — the run stopped where the error was
    expect(ticks.at(-1).done).toBe(20);
  });

  it("a dry run chunks the same way and writes nothing anywhere", async () => {
    const { calls } = fakeRoute();
    await importKeysChunked(envelopeOf(30), { mode: "dry-run" });
    expect(calls.every((b) => b.mode === "dry-run")).toBe(true);
    expect(calls.map((b) => b.envelope.keys.length)).toEqual([20, 10]);
  });
});
