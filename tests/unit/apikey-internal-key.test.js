// Test covenant: apikey-internal-key — the deterministic internal credential.
// Plan: plans/vela-key-governance.md §7. The internal key is the sanctioned
// show-once exception: derived (never stored), loopback-pinned, hidden from
// every list surface, unreachable through the dashboard API, and it re-keys
// when API_KEY_SECRET rotates.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;
const originalPeerToken = process.env.VELA_PEER_TOKEN;

// The gate only trusts x-9r-real-ip when custom-server.js proves the stamp with
// the per-process secret (GHSA-pjm4-8fpg-f9p6). Mint a fixture secret so the
// loopback-pinned self-call below carries real proof.
const PEER_TOKEN = "internal-test-peer-token";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-internal-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "internal-test-secret";
  process.env.VELA_PEER_TOKEN = PEER_TOKEN;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
  if (originalPeerToken === undefined) delete process.env.VELA_PEER_TOKEN;
  else process.env.VELA_PEER_TOKEN = originalPeerToken;
});

describe("internal key — derive, hide, pin, re-key", () => {
  it("deriveInternalKey is deterministic for a purpose", async () => {
    const { deriveInternalKey } = await import("@/shared/utils/apiKey.js");
    const a = deriveInternalKey("mitm");
    const b = deriveInternalKey("mitm");
    expect(a.key).toBe(b.key);
    expect(a.keyId).toBe(b.keyId);
    expect(a.key).toMatch(/^vela-v1-[0-9a-f]{32}-[0-9a-f]{8}$/);
    // Different purposes derive different keys
    expect(deriveInternalKey("model-test").key).not.toBe(a.key);
  });

  it("ensureInternalKey: idempotent, hidden from lists, loopback-pinned", async () => {
    const { ensureInternalKey, getApiKeys, getApiKeyById } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");

    const first = await ensureInternalKey("mitm");
    const second = await ensureInternalKey("mitm");
    expect(second.id).toBe(first.id); // idempotent — one row per purpose
    expect(second.key).toBe(first.key);

    const db = await getAdapter();
    const rows = db.all(`SELECT * FROM apiKeys WHERE isInternal = 1`);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("internal:mitm");
    expect(JSON.parse(rows[0].ipAllowlist)).toEqual(["127.0.0.1/32", "::1/128"]);
    // The plaintext is derived, never stored
    expect(JSON.stringify(rows[0])).not.toContain(first.key);

    // Hidden from every dashboard surface
    const list = await getApiKeys();
    expect(list.find((k) => k.id === first.id)).toBeUndefined();
    expect(await getApiKeyById(first.id)).toBeNull();
  });

  it("dashboard API cannot reach an internal row (GET /api/keys/[id] → 404)", async () => {
    const { ensureInternalKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const internal = await ensureInternalKey("mitm");
    await import("@/lib/db/driver.js").then((m) => m.getAdapter());

    const { GET } = await import("@/app/api/keys/[id]/route.js");
    const res = await GET(new Request(`http://localhost/api/keys/${internal.id}`), { params: { id: internal.id } });
    expect(res.status).toBe(404);

    // And it never appears in the list
    const { GET: LIST } = await import("@/app/api/keys/route.js");
    const listed = await (await LIST(new Request("http://localhost/api/keys"))).json();
    expect(listed.keys.find((k) => k.id === internal.id)).toBeUndefined();
  });

  it("gate rejects internal keys unless the caller passes allowInternal", async () => {
    const { ensureInternalKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { authorizeApiRequest } = await import("@/sse/services/keyGate.js");
    const internal = await ensureInternalKey("mitm");

    // custom-server.js stamps the socket peer into x-9r-real-ip and proves it
    // with the per-process secret (x-9r-peer-token); local MITM traffic arrives
    // from loopback, which matches the internal key's pin.
    const request = { headers: new Headers({ Authorization: `Bearer ${internal.key}`, "x-9r-real-ip": "127.0.0.1", "x-9r-peer-token": PEER_TOKEN }), url: "http://localhost/v1/chat/completions" };
    const settings = { requireApiKey: true };

    const denied = await authorizeApiRequest(request, { settings });
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe("invalid_api_key"); // masked — no existence oracle
    expect(denied.status).toBe(403);

    const allowed = await authorizeApiRequest(request, { settings, allowInternal: true });
    expect(allowed.ok).toBe(true);
    expect(allowed.key.isInternal).toBe(true);

    // The loopback pin is real: a non-loopback peer is rejected even with
    // allowInternal (W3 ip stage enforces the key's ipAllowlist).
    const foreign = { headers: new Headers({ Authorization: `Bearer ${internal.key}`, "x-9r-real-ip": "203.0.113.5", "x-9r-peer-token": PEER_TOKEN }), url: request.url };
    const pinned = await authorizeApiRequest(foreign, { settings, allowInternal: true });
    expect(pinned.ok).toBe(false);
    expect(pinned.code).toBe("ip_not_allowed");
  });

  it("rotating API_KEY_SECRET re-keys the internal credential in place", async () => {
    const { ensureInternalKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const before = await ensureInternalKey("mitm");
    const db = await getAdapter();
    const rowBefore = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [before.id]);

    // Rotate the secret → module reload → derivation follows the new root
    process.env.API_KEY_SECRET = "rotated-internal-secret";
    vi.resetModules();
    const { ensureInternalKey: ensure2 } = await import("@/lib/db/repos/apiKeysRepo.js");
    const after = await ensure2("mitm");

    expect(after.id).toBe(before.id); // same row…
    expect(after.key).not.toBe(before.key); // …new derived key
    const { getAdapter: db2mod } = await import("@/lib/db/driver.js");
    const db2 = await db2mod();
    const rowAfter = db2.get(`SELECT * FROM apiKeys WHERE id = ?`, [before.id]);
    expect(rowAfter.keyHash).not.toBe(rowBefore.keyHash);
    expect(rowAfter.keyHash).not.toBeNull();

    // Old internal key no longer resolves
    const { resolveKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    expect(await resolveKey(before.key)).toBeNull();
    expect((await resolveKey(after.key))?.id).toBe(before.id);
  });
});
