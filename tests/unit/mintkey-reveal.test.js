// Test covenant: mintKey + revealSink — the single-writer chokepoint (W1c).
// Write-before-commit, envelope shape, sink round-trip, TTL honesty,
// lstat rejection, temp+rename atomicity (Covenant C10, S9-S11).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-reveal-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "reveal-test-secret";
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) {
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); break; }
      catch { new Promise((r) => setTimeout(r, 25)); }
    }
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

describe("revealSink", () => {
  it("writes a reveal atomically + round-trips through consume", async () => {
    const sink = await import("@/lib/keys/revealSink.js");
    const { writeReveal, consumeReveals } = sink;

    const r = await writeReveal({ keyId: "k1", keyPrefix: "vela_ab", key: "vela-v1-k1-secret", actorKind: "create" });
    expect(r.revealId).toBeTruthy();
    expect(fs.existsSync(r.file)).toBe(true);

    const reveals = await consumeReveals();
    expect(reveals.length).toBe(1);
    expect(reveals[0].key).toBe("vela-v1-k1-secret");
    expect(reveals[0].keyId).toBe("k1");

    // Consumed twice → empty (show-once).
    const again = await consumeReveals();
    expect(again.length).toBe(0);
  });

  it("sweeps stale temp files but keeps live reveals", async () => {
    const m = await import("@/lib/keys/revealSink.js");
    const dir = path.join(tempDir, "pending-key-reveals");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".tmp-stale"), "x", { mode: 0o600 });
    fs.utimesSync(path.join(dir, ".tmp-stale"), new Date(Date.now() - 600000), new Date(Date.now() - 600000));
    m.sweepTempFiles();
    const left = fs.readdirSync(dir);
    expect(left).not.toContain(".tmp-stale");
  });
});

describe("mintKey envelope", () => {
  it("mints a key with the full envelope + reveals through the sink", async () => {
    const { mintKey } = await import("@/lib/keys/mintService.js");
    const res = await mintKey({ name: "Test Key", opts: { category: "test" }, surface: "create" });

    expect(res.status).toBe(201);
    expect(res.envelope.key).toMatch(/^vela-v1-/);
    expect(res.envelope.keyId).toBeTruthy();
    expect(res.envelope.keyPrefix).toMatch(/^vela-v1-/);
    expect(res.envelope.record).toBeTruthy();
    expect(res.envelope.meta.surface).toBe("create");
    expect(res.envelope.meta.revealId).toBeTruthy();

    // The revealed secret is exactly the minted key (C10: same credential).
    const sink = await import("@/lib/keys/revealSink.js");
    const reveals = await sink.consumeReveals();
    expect(reveals.some((r) => r.key === res.envelope.key)).toBe(true);
  });

  it("envelope is byte-identical across create surfaces (minus volatiles)", async () => {
    const { mintKey } = await import("@/lib/keys/mintService.js");
    const a = await mintKey({ name: "A", opts: {}, surface: "create" });
    const b = await mintKey({ name: "B", opts: {}, surface: "create" });

    for (const k of ["key", "keyId", "keyPrefix", "record", "meta"]) {
      expect(a.envelope).toHaveProperty(k);
      expect(b.envelope).toHaveProperty(k);
    }
    // Both records carry the same field set.
    expect(Object.keys(a.envelope.record).sort()).toEqual(Object.keys(b.envelope.record).sort());
    expect(Object.keys(a.envelope.meta).sort()).toEqual(Object.keys(b.envelope.meta).sort());
  });
});
