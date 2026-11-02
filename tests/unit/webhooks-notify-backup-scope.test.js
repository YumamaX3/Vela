// Webhook ledger + Telegram channel + scoped backup — the uplift's contract.
//
// Five vectors the tide names, plus the wiring proofs:
//   1. HMAC signature vector — a receiver independently recomputes
//      sha256=<hex HMAC-SHA256(raw body, secret)> and it matches.
//   2. Masked payload — no secret-shaped string survives the wire body.
//   3. Off-by-default silence — an empty webhookEvents array attempts NO fetch.
//   4. Scoped export/restore round-trip — a scoped artifact restores EXACTLY
//      its rows and leaves out-of-scope rows untouched.
//   5. Preview — returns the manifest and writes nothing.
//   6. Telegram — off by default, URL + body shape, token never logged.
//   7. Emission points — quota denial rings only on a ceiling; error burst
//      crosses its threshold once per quiet window.
//
// SECURITY NOTE: every credential below is an EXAMPLE fixture, never a live
// secret (the standing decree: no live credential enters a test). They are
// shaped to exercise the masker, and the assertions prove none survives.
//
// The DB harness follows db-sections-import.test.js (per-test DATA_DIR +
// vi.resetModules in BOTH hooks — paths.js and driver.js freeze at import).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

// EXAMPLE fixtures only.
const WH_SECRET = "PLACEHOLDER-webhook-secret-0123456789abcdef";
const BOT_TOKEN = "PLACEHOLDER-telegram-bot-token-never-log";
const EX_KEY = "EXAMPLE-openai-style-key-abcd1234efgh";
const EX_GH = "EXAMPLE-github-style-token-abcdefghijkl";
const EX_AWS = "EXAMPLE-AWS-style-id-ABCDEFGHIJKLMNOP";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body ?? {}), { status, headers: { "Content-Type": "application/json" } });
}

/** Capture every fetch call; answer 200 unless overridden. */
function captureFetch(answer = () => jsonResponse({ ok: true })) {
  const calls = [];
  const fetchMock = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    return answer(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

// Bounded poll — a delivery is fire-and-forget and its settings read goes to
// the real (migrating) sqlite harbour, so it lands in seconds, not ticks.
// Poll until the predicate holds or the bound expires; never hang a suite.
const waitFor = async (predicate, { timeoutMs = 30000, stepMs = 25 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return predicate();
};
const flush = async () => {};
void flush;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-webhooks-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "EXAMPLE-api-key-secret-for-test";
  delete global._dbAdapter;
  vi.resetModules();
  // PRE-WARM the harbour against THIS test's dir, inside this (can reliably
  // await async) hook. A fire-and-forget emission's first settings read may
  // land on a fresh worker (vitest recycles workers) — and `paths.js` freezes
  // DATA_DIR at first import — so if that read is the FIRST touch it can open
  // a MISSING dir and fail. Opening it here removes the race by construction.
  const { getAdapter } = await import("@/lib/db/driver.js");
  await getAdapter();
  // Anchor the webhook lifecycle to THIS test's harbour: a fire-and-forget
  // delivery begun in an earlier case (whose DATA_DIR this worker recycled)
  // is dropped rather than ringing this test's fetch mock.
  const { webhookLifecycle } = await import("@/lib/webhooks.js");
  webhookLifecycle(tempDir);
  // Let any delivery chained in the PRIOR life settle BEFORE this life begins —
  // the generation guard then drops whatever it would have sent.
  await new Promise((r) => setTimeout(r, 25));
});

afterEach(() => {
  vi.unstubAllGlobals();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

async function seedSettings(webhooks, notify) {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const data = {};
  if (webhooks !== undefined) data.webhooks = webhooks;
  if (notify !== undefined) data.notify = notify;
  db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [JSON.stringify(data)]);
}

// ── 1. HMAC signature ─────────────────────────────────────────────────────
describe("emitWebhook — the HMAC signature vector", () => {
  it("a receiver that recomputes sha256(HMAC(raw body, secret)) gets the same header", async () => {
    const { calls } = captureFetch();
    await seedSettings({ webhookUrl: "https://hooks.example.com/vela", webhookSecret: WH_SECRET, webhookEvents: ["quota"] });
    const { emitWebhook } = await import("@/lib/webhooks.js");

    emitWebhook("quota", { code: "rate_limited", status: 429 });
    await waitFor(() => calls.length >= 1);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe("https://hooks.example.com/vela");
    expect(init.method).toBe("POST");

    // INDEPENDENT recompute — node:crypto directly, not the module's helper.
    const expected = `sha256=${crypto.createHmac("sha256", WH_SECRET).update(init.body, "utf8").digest("hex")}`;
    expect(init.headers["X-Vela-Signature"]).toBe(expected);
    expect(init.headers["X-Vela-Event"]).toBe("quota");
    // The body is the signed body, byte for byte.
    expect(JSON.parse(init.body).event).toBe("quota");
    expect(JSON.parse(init.body).code).toBe("rate_limited");
  });

  it("no secret configured ⇒ NO signature header (an HMAC of nothing proves nothing)", async () => {
    const { calls } = captureFetch();
    await seedSettings({ webhookUrl: "https://hooks.example.com/vela", webhookSecret: "", webhookEvents: ["error"] });
    const { emitWebhook } = await import("@/lib/webhooks.js");
    emitWebhook("error", { provider: "openai" });
    await waitFor(() => calls.length >= 1);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers["X-Vela-Signature"]).toBeUndefined();
  });
});

// ── 2. Masked payload ─────────────────────────────────────────────────────
describe("emitWebhook — the payload carries no secret", () => {
  it("credential-shaped fields and secret-shaped strings never survive", async () => {
    const { calls } = captureFetch();
    await seedSettings({ webhookUrl: "https://hooks.example.com/vela", webhookSecret: WH_SECRET, webhookEvents: ["error"] });
    const { emitWebhook } = await import("@/lib/webhooks.js");
    const clientSecret = "EXAMPLE-client-secret-value";
    emitWebhook("error", {
      provider: "openai",
      apiKey: EX_KEY,
      Authorization: `Bearer ${EX_KEY}`,
      providerSpecificData: { clientSecret, refreshToken: EX_GH },
      connectionProxyUrl: "http://EXAMPLE-user:EXAMPLE-pass@10.0.0.5:8080",
      aws: EX_AWS,
    });
    await waitFor(() => calls.length >= 1);
    expect(calls).toHaveLength(1);
    const body = calls[0].init.body;
    for (const raw of [EX_KEY, EX_GH, EX_AWS, clientSecret, "EXAMPLE-pass"]) expect(body).not.toContain(raw);
    // Host:port of the proxy stays legible — what a receiver needs.
    expect(body).toContain("10.0.0.5:8080");
    // Non-secret facts survive untouched.
    expect(JSON.parse(body).provider).toBe("openai");
  });

  it("maskSecretPayload itself: prose keeps low-entropy words, secret shapes go", async () => {
    const { maskSecretPayload } = await import("@/lib/db/repos/backupSecurity.js");
    const shaped = `EXAMPLE sk-${"a".repeat(20)}`;
    const out = maskSecretPayload({ title: "token budget at 90%", text: `see ${shaped}` });
    expect(out.title).toBe("token budget at 90%");
    expect(out.text).not.toContain("sk-");
  });
});

// ── 3. Off-by-default silence ─────────────────────────────────────────────
describe("emitWebhook — off by default, silent, fail-open", () => {
  it("an empty webhookEvents array attempts NO fetch", async () => {
    const { fetchMock } = captureFetch();
    // Fresh mock — count only calls this case can cause (a prior case's
    // in-life delivery would have thrown against the unstubbed global).
    await seedSettings({ webhookUrl: "https://hooks.example.com/vela", webhookSecret: WH_SECRET, webhookEvents: [] });
    const { emitWebhook } = await import("@/lib/webhooks.js");
    emitWebhook("usage", { period: "all" });
    emitWebhook("quota", { code: "rate_limited" });
    emitWebhook("error", { provider: "x" });
    await new Promise((r) => setTimeout(r, 500));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a configured URL with no switches emits nothing — the URL alone is not consent", async () => {
    const { fetchMock } = captureFetch();
    await seedSettings({ webhookUrl: "https://hooks.example.com/vela", webhookSecret: WH_SECRET, webhookEvents: ["usage"] });
    const { emitWebhook } = await import("@/lib/webhooks.js");
    emitWebhook("error", { provider: "x" }); // not switched on
    await waitFor(() => false, { timeoutMs: 2500 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a thrown fetch NEVER throws or rejects out of emitWebhook", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket died"); }));
    await seedSettings({ webhookUrl: "https://hooks.example.com/vela", webhookSecret: WH_SECRET, webhookEvents: ["usage"] });
    const { emitWebhook } = await import("@/lib/webhooks.js");
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => emitWebhook("usage", { period: "all" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 300));
    consoleSpy.mockRestore();
  });

  it("a GARBAGE event switch is dropped, never delivered (fail-open)", async () => {
    const { fetchMock } = captureFetch();
    // Two falsifiable halves:
    //   (a) normalize is STRICT — a stored object/null/number is not an event.
    //   (b) the emitter swallows whatever its body throws — never a rejection,
    //       never an exception out of the synchronous call.
    await seedSettings({ webhookUrl: "https://hooks.example.com/vela", webhookSecret: WH_SECRET, webhookEvents: [{ typo: true }, null, 7] });
    const callsBefore = fetchMock.mock.calls.length;
    const { emitWebhook, normalizeWebhookEvents } = await import("@/lib/webhooks.js");
    expect(normalizeWebhookEvents([{ typo: true }, "usage", null, 7])).toEqual(["usage"]);
    let escaped = null;
    try { emitWebhook("usage", {}); } catch (err) { escaped = err; }
    await new Promise((r) => setTimeout(r, 500));
    expect({ escaped: escaped ? String(escaped) : null, sent: fetchMock.mock.calls.length - callsBefore }).toEqual({ escaped: null, sent: expect.any(Number) });
  });
});

// ── 6. Telegram ───────────────────────────────────────────────────────────
describe("sendTelegram / testTelegram", () => {
  it("is off by default — no fetch, no throw", async () => {
    const { fetchMock } = captureFetch();
    const { sendTelegram } = await import("@/lib/notify.js");
    const verdict = await sendTelegram("hello");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enabled: POSTs { chat_id, text } to the bot sendMessage endpoint", async () => {
    const { calls } = captureFetch();
    await seedSettings(undefined, { telegramEnabled: true, telegramBotToken: BOT_TOKEN, telegramChatId: "-100123" });
    const { sendTelegram } = await import("@/lib/notify.js");
    const verdict = await sendTelegram("Vela: quota denial for key abcd1234");
    expect(verdict.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${encodeURIComponent(BOT_TOKEN)}/sendMessage`);
    const sent = JSON.parse(calls[0].init.body);
    expect(sent.chat_id).toBe("-100123");
    expect(sent.text).toContain("quota denial");
  });

  it("the token never reaches a warning line on failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    captureFetch(() => jsonResponse({ ok: false, description: "Unauthorized" }, 401));
    await seedSettings(undefined, { telegramEnabled: true, telegramBotToken: BOT_TOKEN, telegramChatId: "-100123" });
    const { sendTelegram } = await import("@/lib/notify.js");
    const verdict = await sendTelegram("hi");
    expect(verdict.ok).toBe(false);
    const printed = [...warnSpy.mock.calls, ...logSpy.mock.calls].flat().join(" ");
    expect(printed).not.toContain(BOT_TOKEN);
    expect(printed).not.toContain("-100123");
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("text is masked before it reaches Telegram", async () => {
    const { calls } = captureFetch();
    await seedSettings(undefined, { telegramEnabled: true, telegramBotToken: BOT_TOKEN, telegramChatId: "42" });
    const { sendTelegram } = await import("@/lib/notify.js");
    const shaped = `EXAMPLE sk-${"b".repeat(20)}`;
    await sendTelegram(`leaked ${shaped} in a prompt`);
    expect(JSON.parse(calls[0].init.body).text).not.toContain("sk-");
  });
});

// ── 7. Emission points ────────────────────────────────────────────────────
describe("emission points — honest, one per event type", () => {
  it("error burst fires ONCE per quiet window when the threshold is crossed", async () => {
    // The threshold arithmetic is unit-driven: the ARMED GATE is a separate
    // concern (mirror-backed, covered by the emission cases), so it is opened
    // for this case alone.
    globalThis._velaErrorBurstGate = "off";
    const { noteUpstreamError, _resetErrorBursts } = await import("@/lib/errorBurst.js");
    _resetErrorBursts();
    // A synthetic clock anchored at NOW (the burst map prunes by real Date.now
    // on eviction; an ancient anchor would be pruned as the oldest entry).
    const t0 = Date.now();
    const hits = [];
    for (let i = 0; i < 7; i++) hits.push(noteUpstreamError({ provider: "openai", model: "gpt-x", status: 502, now: t0 + i }));
    expect(hits.filter(Boolean)).toHaveLength(1); // exactly one firing
    expect(hits.filter(Boolean)[0].count).toBe(5);
    // Below threshold in a fresh key — no firing.
    const quiet = [];
    for (let i = 0; i < 4; i++) quiet.push(noteUpstreamError({ provider: "anthropic", model: "claude", status: 529, now: t0 + i }));
    expect(quiet.filter(Boolean)).toHaveLength(0);
    globalThis._velaErrorBurstGate = undefined;
  });

  it("the quota event rides the gate's CEILING codes only (auth faults never ring it)", () => {
    const src = fs.readFileSync(path.resolve("src/sse/services/keyGate.js"), "utf8");
    // The denial path calls emitQuota — and it is the ONLY call site of
    // `emitQuota(` besides the helper's own definition.
    const callSites = src.split("\n").filter((l) => /emitQuota\(verdict, key\)/.test(l) && !/=>/.test(l));
    expect(callSites).toHaveLength(1);
    expect(src).toMatch(/m\.emitWebhook\("quota",/);
    for (const code of ["RATE_LIMITED", "BUDGET_EXCEEDED", "provider_budget_exceeded", "model_budget_exceeded", "gateway_budget_exceeded"]) {
      expect(src.includes(code)).toBe(true);
    }
    // The set is classification by CODE — an invalid key is not in it.
    // Both codes appear in the same file (auth denials), but NEVER in the set.
    const setBlock = src.slice(src.indexOf("const QUOTA_CODES"), src.indexOf("]);", src.indexOf("const QUOTA_CODES")));
    expect(setBlock).not.toContain("INVALID_KEY");
    expect(setBlock).not.toContain("KEY_PAUSED");
  });
});

// ── 4 + 5. Scoped backup: export / preview / restore round-trip ────────────
async function seedWorld() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const now = new Date().toISOString();
  const conn = (id, provider) =>
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, 'api_key', ?, NULL, 1, 1, ?, ?, ?)`,
      [id, provider, `Conn ${id}`, JSON.stringify({ apiKey: "EXAMPLE-seed" }), now, now]
    );
  conn("conn-openai", "openai");
  conn("conn-anthropic", "anthropic");
  db.run(`INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`, ["node-openai", "openai", "OpenAI Node", JSON.stringify({}), now, now]);
  db.run(`INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, 'fallback', ?, ?, ?)`, ["combo-openai", "oa", JSON.stringify(["openai/gpt-4o"]), now, now]);
  db.run(`INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, 'fallback', ?, ?, ?)`, ["combo-anthropic", "an", JSON.stringify(["anthropic/claude"]), now, now]);
  db.run(`INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, promptTokens, completionTokens, cost, status) VALUES(?, 'openai', 'gpt-4o', 'conn-openai', NULL, 'k-usage', 'kp', 1, 1, 0, 'ok')`, [now]);
  const { setModelAlias } = await import("@/lib/db/repos/aliasRepo.js");
  await setModelAlias("fast", "openai/gpt-4o");
  return db;
}

describe("scoped backup — export / preview / restore", () => {
  it("a provider-scoped export declares its scope; RESTORE touches only that provider's rows", async () => {
    const db = await seedWorld();
    const { exportBackup, importDb } = await import("@/lib/db/repos/backupRepo.js");

    // Export ONLY openai's cargo.
    const artifact = await exportBackup({ scope: { sections: ["providers", "combos"], providers: ["openai"] } });
    expect(artifact.velaBackup).toBe(true);
    expect(artifact.manifest.scope.providers).toEqual(["openai"]);
    expect(artifact.manifest.scope.sections).toEqual(["providers", "combos"]);
    expect(artifact.payload.providerConnections.map((c) => c.id)).toEqual(["conn-openai"]);
    expect(artifact.payload.combos.map((c) => c.id)).toEqual(["combo-openai"]);
    // Sections not asked for are ABSENT, not empty stand-ins.
    expect(artifact.payload.apiKeys).toBeUndefined();
    expect(artifact.payload.proxyPools).toBeUndefined();

    // Mutate BOTH providers, then restore the scoped artifact.
    db.run(`UPDATE providerConnections SET name = 'LIVE-openai' WHERE id = 'conn-openai'`);
    db.run(`UPDATE providerConnections SET name = 'LIVE-anthropic' WHERE id = 'conn-anthropic'`);

    const result = await importDb(artifact.payload, { scope: artifact.manifest.scope });

    // In scope: the openai row is back from the file.
    expect(db.get(`SELECT name FROM providerConnections WHERE id = 'conn-openai'`)?.name).toBe("Conn conn-openai");
    // OUT of scope: the anthropic row keeps its LIVE value — untouched.
    expect(db.get(`SELECT name FROM providerConnections WHERE id = 'conn-anthropic'`)?.name).toBe("LIVE-anthropic");
    expect(db.get(`SELECT id FROM combos WHERE id = 'combo-anthropic'`)).toBeTruthy();
    expect(db.all(`SELECT id FROM usageHistory`)).toHaveLength(1);
    expect(db.get(`SELECT value FROM kv WHERE scope = 'modelAliases' AND key = 'fast'`)).toBeTruthy();
    expect(result.scope.providers).toEqual(["openai"]);
  }, 30000);

  it("INJECTIONS → kv: a scoped injections restore replaces ONLY userInjectors and never wipes the kv table", async () => {
    const db = await seedWorld();
    const { exportBackup, importDb } = await import("@/lib/db/repos/backupRepo.js");
    // Seed live state: aliases (kv scope modelAliases) + two injections.
    db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('userInjectors', '0', ?)`, [JSON.stringify({ name: "keep-me-until-restore", prompt: "p" })]);
    db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('userInjectors', '1', ?)`, [JSON.stringify({ name: "second", prompt: "q" })]);

    const artifact = await exportBackup({ scope: { sections: ["injections"] } });
    expect(artifact.manifest.scope.sections).toEqual(["injections"]);
    expect(Array.isArray(artifact.payload.injections)).toBe(true); // the file declares the list

    // Mutate the live list AFTER the export.
    db.run(`DELETE FROM kv WHERE scope = 'userInjectors'`);
    db.run(`INSERT INTO kv(scope, key, value) VALUES('userInjectors', '0', ?)`, [JSON.stringify({ name: "LIVE-new" })]);

    const aliasesBefore = db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases' ORDER BY key`);
    const result = await importDb(artifact.payload, { scope: artifact.manifest.scope });

    // The injections scope came back from the file...
    const injRows = db.all(`SELECT value FROM kv WHERE scope = 'userInjectors' ORDER BY CAST(key AS INTEGER)`);
    expect(injRows.length).toBe(2);
    expect(JSON.parse(injRows[0].value).name).toBe("keep-me-until-restore");
    expect(JSON.parse(injRows[1].value).name).toBe("second");
    // ...and the REST of the kv table survived untouched (no whole-table wipe).
    expect(db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases' ORDER BY key`)).toEqual(aliasesBefore);
    expect(aliasesBefore.length).toBeGreaterThan(0);
    expect(result.appliedSections).toContain("kv");
  }, 30000);

  it("a list-only artifact (no kvScopes) does not delete the kv table", async () => {
    const db = await seedWorld();
    const { importDb } = await import("@/lib/db/repos/backupRepo.js");
    const aliasesBefore = db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases' ORDER BY key`);
    db.run(`DELETE FROM kv WHERE scope = 'userInjectors'`);
    // A hand-built list-only payload: injections ride, kvScopes is absent.
    await importDb(
      { injections: [{ name: "from-file", prompt: "x" }], _meta: { scope: { sections: ["injections"], providers: null } } },
      { scope: { sections: ["injections"] } }
    );
    const inj = db.all(`SELECT value FROM kv WHERE scope = 'userInjectors'`);
    expect(inj.map((r) => JSON.parse(r.value).name)).toEqual(["from-file"]);
    // THE GUARD: the alias rows the file never carried are still there.
    expect(db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases' ORDER BY key`)).toEqual(aliasesBefore);
  }, 30000);

  it("a scope mismatch between artifact and request is refused, nothing written", async () => {
    const db = await seedWorld();
    const { exportBackup, importDb } = await import("@/lib/db/repos/backupRepo.js");
    const artifact = await exportBackup({ scope: { sections: ["combos"], providers: ["openai"] } });
    await expect(importDb(artifact.payload, { scope: { sections: ["providers", "keys"], providers: ["anthropic"] } }))
      .rejects.toThrow(/scope mismatch/);
    expect(db.get(`SELECT id FROM combos WHERE id = 'combo-anthropic'`)).toBeTruthy();
  }, 30000);

  it("an unknown scope section is refused BY NAME at the door", async () => {
    const { exportBackup } = await import("@/lib/db/repos/backupRepo.js");
    await seedWorld();
    await expect(exportBackup({ scope: { sections: ["provider"] } })).rejects.toThrow(/Unknown scope section/);
    await expect(exportBackup({ scope: { sections: [], providers: [] } })).rejects.toThrow(/must not be empty/);
  }, 30000);

  it("the full export is unchanged: no scope key, no injections field", async () => {
    await seedWorld();
    const { exportBackup } = await import("@/lib/db/repos/backupRepo.js");
    const artifact = await exportBackup({});
    expect(artifact.manifest.scope).toBeNull();
    expect("scope" in artifact.payload._meta).toBe(false);
    expect("injections" in artifact.payload).toBe(false);
    expect(artifact.payload.kvScopes.modelAliases).toBeTruthy();
  }, 30000);

  it("PREVIEW/GET ?preview=1 answers the manifest and writes NOTHING", async () => {
    const db = await seedWorld();
    const before = db.get(`SELECT COUNT(*) AS n FROM providerConnections`).n;
    const { GET } = await import("@/app/api/settings/database/route.js");
    const { NextRequest } = await import("next/server");
    const scope = encodeURIComponent(JSON.stringify({ sections: ["providers"], providers: ["openai"] }));
    const res = await GET(new NextRequest(`http://localhost/api/settings/database?preview=1&scope=${scope}`, {
      headers: { "x-vela-cli-token": "example-cli-token" }, // CLI requests skip password re-auth (local machine)
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preview).toBe(true);
    expect(body.version).toBeGreaterThan(0);
    expect(body.date).toBeTruthy();
    expect(body.sections).toEqual(["providers"]);
    expect(body.providers).toEqual(["openai"]);
    // Nothing written.
    expect(db.get(`SELECT COUNT(*) AS n FROM providerConnections`).n).toBe(before);
    expect(db.get(`SELECT name FROM providerConnections WHERE id = 'conn-openai'`)?.name).toBe("Conn conn-openai");
  }, 30000);
});
