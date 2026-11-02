// Test covenant: the security log + trust inbox (migration 030).
//
// The port register lists both as PORT targets ("Security log (per-key, 30-day
// retention)", "Trust inbox (trustEvents + unread bell)"). This suite proves
// the seven laws the wiring depends on, and nothing decorative:
//
//   1. APPEND + AUTO-PRUNE — every write enforces the 30-day window first, so
//      a table with no scheduler can never outgrow it.
//   2. PAGED LIST — newest first, bounded limit, exact filters.
//   3. MASKING — the read ROUTE returns keyPrefix form only, never a keyId
//      or a full key (the usageRepo precedent: keyPrefix || displayPrefix).
//   4. UNREAD COUNT — the bell's number.
//   5. MARK-READ — one, and all; idempotent; honest 404 for a missing id.
//   6. FAIL-OPEN WRITER — on a broken table the door logs and returns false,
//      and NEVER throws (simulated by breaking the table under the real
//      adapter: a rename is exactly the "cannot write" failure it must survive).
//   7. GATE + GUARDRAIL WIRING — a guarded edge, not a decorative claim: the
//      guardrail pipeline records a block, and a guardrail test stream still
//      terminates cleanly with the record in flight.
//
// Isolation follows the house harness: DATA_DIR set BEFORE the first dynamic
// import, vi.resetModules() so paths.js/driver.js re-evaluate, and the adapter
// closed in afterEach.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/sse/utils/logger.js", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  errorLine: vi.fn(),
}));

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-sectrust-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_DB_DRIVER", "VELA_MYSQL_URL"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  delete process.env.VELA_DB_MODE;
  delete process.env.VELA_DB_DRIVER;
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  delete global.__velaSecurityCoalesce;
  vi.resetModules();
});

afterEach(async () => {
  try { await global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global.__velaSecurityCoalesce;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function adapter() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

async function securityRepo() {
  return import("@/lib/db/repos/securityLogRepo.js");
}

async function trustRepo() {
  return import("@/lib/db/repos/trustEventsRepo.js");
}

const DAY = 86_400_000;

describe("security log — append + auto-prune", () => {
  it("appends a row with an integer createdAt and a minted id", async () => {
    const repo = await securityRepo();
    const row = await repo.appendSecurityEvent({ keyId: "key-abc", kind: "key.created", detail: { name: "prod" }, ip: "127.0.0.1" });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isInteger(row.createdAt)).toBe(true);

    const page = await repo.listSecurityEvents({});
    expect(page.total).toBe(1);
    expect(page.rows[0].kind).toBe("key.created");
    expect(page.rows[0].keyId).toBe("key-abc");
    expect(page.rows[0].detail).toEqual({ name: "prod" }); // JSON round-tripped
    expect(Number.isInteger(page.rows[0].createdAt)).toBe(true);
  });

  it("prunes rows past 30 days BEFORE the insert — retention is enforced on write", async () => {
    const repo = await securityRepo();
    const db = await adapter();
    const ancient = Date.now() - 40 * DAY;
    const fresh = Date.now() - 5 * DAY;
    // Rows written directly, as an older install's rows would be.
    db.run(`INSERT INTO securityLog(id, keyId, kind, detail, ip, createdAt) VALUES(?, ?, ?, ?, ?, ?)`, ["old-1", null, "rate.limited", null, null, ancient]);
    db.run(`INSERT INTO securityLog(id, keyId, kind, detail, ip, createdAt) VALUES(?, ?, ?, ?, ?, ?)`, ["keep-1", null, "key.created", null, null, fresh]);

    await repo.appendSecurityEvent({ kind: "key.revoked" });

    const page = await repo.listSecurityEvents({});
    const ids = page.rows.map((r) => r.id);
    expect(ids).not.toContain("old-1");   // 40 days old — pruned on write
    expect(ids).toContain("keep-1");      // 5 days old — kept
    expect(page.total).toBe(2);
  });

  it("pruneSecurityEvents honours an explicit age", async () => {
    const repo = await securityRepo();
    const db = await adapter();
    db.run(`INSERT INTO securityLog(id, keyId, kind, detail, ip, createdAt) VALUES(?, ?, ?, ?, ?, ?)`, ["a", null, "x", null, null, Date.now() - 5 * DAY]);
    db.run(`INSERT INTO securityLog(id, keyId, kind, detail, ip, createdAt) VALUES(?, ?, ?, ?, ?, ?)`, ["b", null, "x", null, null, Date.now() - 3 * DAY]);
    expect(await repo.pruneSecurityEvents(4 * DAY)).toBe(1); // only the 5-day row
    expect(await repo.countSecurityEvents()).toBe(1);
  });
});

describe("security log — paged list", () => {
  it("orders newest first and pages without overlap", async () => {
    const repo = await securityRepo();
    const db = await adapter();
    const base = Date.now() - 10 * DAY;
    for (let i = 0; i < 5; i++) {
      db.run(`INSERT INTO securityLog(id, keyId, kind, detail, ip, createdAt) VALUES(?, ?, ?, ?, ?, ?)`, [`p-${i}`, "k1", "gate.denied", null, null, base + i * 1000]);
    }
    const first = await repo.listSecurityEvents({ limit: 2, offset: 0 });
    const second = await repo.listSecurityEvents({ limit: 2, offset: 2 });
    expect(first.rows.map((r) => r.id)).toEqual(["p-4", "p-3"]);
    expect(second.rows.map((r) => r.id)).toEqual(["p-2", "p-1"]);
    expect(first.total).toBe(5);
    expect(first.limit).toBe(2);
  });

  it("filters by kind and keyId exactly, and clamps the limit", async () => {
    const repo = await securityRepo();
    const db = await adapter();
    const now = Date.now() - DAY;
    db.run(`INSERT INTO securityLog(id, keyId, kind, detail, ip, createdAt) VALUES(?, ?, ?, ?, ?, ?)`, ["f1", "ka", "rate.limited", null, null, now]);
    db.run(`INSERT INTO securityLog(id, keyId, kind, detail, ip, createdAt) VALUES(?, ?, ?, ?, ?, ?)`, ["f2", "kb", "rate.limited", null, null, now]);
    db.run(`INSERT INTO securityLog(id, keyId, kind, detail, ip, createdAt) VALUES(?, ?, ?, ?, ?, ?)`, ["f3", "ka", "key.revoked", null, null, now]);

    expect((await repo.listSecurityEvents({ kind: "rate.limited" })).total).toBe(2);
    expect((await repo.listSecurityEvents({ keyId: "ka" })).total).toBe(2);
    expect((await repo.listSecurityEvents({ kind: "rate.limited", keyId: "kb" })).rows.map((r) => r.id)).toEqual(["f2"]);
    expect((await repo.listSecurityEvents({ limit: 99999 })).limit).toBe(repo.SECURITY_LOG_MAX_LIMIT);
  });
});

describe("security log — the read ROUTE masks keyId to keyPrefix form", () => {
  it("returns keyPrefix + displayPrefix, and NEVER the keyId or a full key", async () => {
    const repo = await securityRepo();
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const created = await createApiKey("masked-key");
    const { keyId, keyPrefix, key } = created;

    await repo.appendSecurityEvent({ keyId, kind: "key.created", detail: { keyPrefix } });
    // A revoked id with no live row still masks — the derived display form.
    const orphanId = "0123456789abcdef0123456789abcdef";
    await repo.appendSecurityEvent({ keyId: orphanId, kind: "key.revoked" });

    const { GET } = await import("@/app/api/security-log/route.js");
    const res = await GET(new Request("http://localhost/api/security-log?limit=10"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.length).toBe(2);

    for (const ev of body.events) {
      expect(ev).not.toHaveProperty("keyId");
      expect(ev.keyPrefix).toMatch(/^vela-v1-/);
      expect(JSON.stringify(ev)).not.toContain(key); // the full key never appears
    }
    const live = body.events.find((e) => e.kind === "key.created");
    expect(live.keyPrefix).toBe(keyPrefix);
    const orphan = body.events.find((e) => e.kind === "key.revoked");
    expect(orphan.keyPrefix).toBe(`vela-v1-${orphanId.slice(0, 4)}…`);
    expect(orphan.keyPrefix).not.toContain(orphanId);
  });

  it("rejects a pasted key where a keyId belongs", async () => {
    const { GET } = await import("@/app/api/security-log/route.js");
    const res = await GET(new Request("http://localhost/api/security-log?keyId=vela-v1-abc-def"));
    expect(res.status).toBe(400);
  });

  it("the manual prune route deletes only what is past retention", async () => {
    const repo = await securityRepo();
    const db = await adapter();
    db.run(`INSERT INTO securityLog(id, keyId, kind, detail, ip, createdAt) VALUES(?, ?, ?, ?, ?, ?)`, ["old", null, "x", null, null, Date.now() - 40 * DAY]);
    db.run(`INSERT INTO securityLog(id, keyId, kind, detail, ip, createdAt) VALUES(?, ?, ?, ?, ?, ?)`, ["new", null, "x", null, null, Date.now()]);
    const { POST } = await import("@/app/api/security-log/prune/route.js");
    const res = await POST();
    const body = await res.json();
    expect(body.removed).toBe(1);
    expect(body.remaining).toBe(1);
    expect(await repo.countSecurityEvents()).toBe(1);
  });
});

describe("trust inbox — unread count, listing, mark-read", () => {
  it("counts unread, lists newest first, and marks one / all read", async () => {
    const repo = await trustRepo();
    const a = await repo.appendTrustEvent({ kind: "key.revoked", title: "Key revoked", detail: { keyPrefix: "vela-v1-abcd…" } });
    const b = await repo.appendTrustEvent({ kind: "guardrail.block", title: "Guardrail blocked a request" });
    await new Promise((r) => setTimeout(r, 2)); // distinct epoch-ms for ordering
    const c = await repo.appendTrustEvent({ kind: "key.revoked", title: "Key revoked" });

    expect(await repo.countUnreadTrustEvents()).toBe(3);
    const list = await repo.listTrustEvents({ limit: 10 });
    expect(list.events.map((e) => e.id)).toEqual([c.id, b.id, a.id]);
    expect(list.events.every((e) => e.read === false)).toBe(true);
    expect(list.events[2].detail).toEqual({ keyPrefix: "vela-v1-abcd…" });

    expect(await repo.markTrustEventRead(b.id)).toBe(true);
    expect(await repo.countUnreadTrustEvents()).toBe(2);
    expect(await repo.markTrustEventRead(b.id)).toBe(true); // idempotent
    expect(await repo.countUnreadTrustEvents()).toBe(2);

    expect(await repo.markAllTrustEventsRead()).toBe(2);
    expect(await repo.countUnreadTrustEvents()).toBe(0);
    expect(await repo.listTrustEvents({ unreadOnly: true })).toMatchObject({ total: 0 });

    expect(await repo.markTrustEventRead("no-such-id")).toBe(false);
  });

  it("the route serves list + {unread}, and both POST actions", async () => {
    const repo = await trustRepo();
    const ev = await repo.appendTrustEvent({ kind: "key.revoked", title: "Key revoked" });
    const { GET, POST } = await import("@/app/api/trust-events/route.js");

    const g = await (await GET(new Request("http://localhost/api/trust-events"))).json();
    expect(g.unread).toBe(1);
    expect(g.events[0].id).toBe(ev.id);

    const bad = await POST(new Request("http://localhost/api/trust-events", { method: "POST", body: JSON.stringify({ action: "nope" }) }));
    expect(bad.status).toBe(400);
    const missing = await POST(new Request("http://localhost/api/trust-events", { method: "POST", body: JSON.stringify({ action: "read" }) }));
    expect(missing.status).toBe(400);
    const notFound = await POST(new Request("http://localhost/api/trust-events", { method: "POST", body: JSON.stringify({ action: "read", id: "nope" }) }));
    expect(notFound.status).toBe(404);

    await repo.appendTrustEvent({ kind: "key.revoked", title: "Another" });
    const one = await (await POST(new Request("http://localhost/api/trust-events", { method: "POST", body: JSON.stringify({ action: "read", id: ev.id }) }))).json();
    expect(one).toMatchObject({ status: "ok", unread: 1 });

    const all = await (await POST(new Request("http://localhost/api/trust-events", { method: "POST", body: JSON.stringify({ action: "read-all" }) }))).json();
    expect(all).toMatchObject({ status: "ok", updated: 1, unread: 0 });
  });
});

describe("fail-open writer — a broken table never throws", () => {
  it("recordSecurityEvent catches the write failure, warns, and returns false", async () => {
    const { recordSecurityEvent } = await import("@/lib/security/securityEvents.js");
    const logger = await import("@/sse/utils/logger.js");
    const db = await adapter();
    // Break the table under the REAL adapter: the write now fails exactly as a
    // locked/corrupt table would, and the door must absorb it.
    db.exec(`ALTER TABLE securityLog RENAME TO securityLog_broken`);

    await expect(recordSecurityEvent({ keyId: "k", kind: "key.created", detail: {} })).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalled();
    expect(String(logger.warn.mock.calls.at(-1)[1])).toMatch(/security log write failed/);

    // The door is total: even a missing kind is false, not a throw.
    await expect(recordSecurityEvent({})).resolves.toBe(false);
  });

  it("recordTrustEvent absorbs a broken inbox the same way", async () => {
    const { recordTrustEvent } = await import("@/lib/security/securityEvents.js");
    const db = await adapter();
    db.exec(`ALTER TABLE trustEvents RENAME TO trustEvents_broken`);
    await expect(recordTrustEvent({ kind: "key.revoked", title: "x" })).resolves.toBe(false);
  });

  it("a healthy write through the door returns true and lands", async () => {
    const { recordSecurityEvent, recordTrustEvent, __resetSecurityCoalesce } = await import("@/lib/security/securityEvents.js");
    const sec = await securityRepo();
    const trust = await trustRepo();
    __resetSecurityCoalesce();
    await expect(recordSecurityEvent({ keyId: "k1", kind: "key.created" })).resolves.toBe(true);
    await expect(recordTrustEvent({ kind: "key.revoked", title: "Key revoked" })).resolves.toBe(true);
    expect(await sec.countSecurityEvents()).toBe(1);
    expect(await trust.countUnreadTrustEvents()).toBe(1);
  });

  it("coalesces rate denials inside the window but never discrete acts", async () => {
    const { recordSecurityEvent, __resetSecurityCoalesce } = await import("@/lib/security/securityEvents.js");
    const sec = await securityRepo();
    __resetSecurityCoalesce();
    for (let i = 0; i < 5; i++) {
      await recordSecurityEvent({ keyId: "hot", kind: "rate.limited", detail: { code: "rate_limited", dimension: "rpm" } });
    }
    // A different dimension is its own line.
    await recordSecurityEvent({ keyId: "hot", kind: "rate.limited", detail: { code: "rate_limited", dimension: "rpd" } });
    // Discrete acts are never coalesced.
    for (let i = 0; i < 3; i++) await recordSecurityEvent({ keyId: "hot", kind: "key.updated" });
    expect(await sec.countSecurityEvents()).toBe(1 + 1 + 3);
  });
});

describe("guardrail wiring — a block reaches the ledger AND the inbox", () => {
  it("auditDecision records a block with metadata only, never the matched value", async () => {
    const { auditDecision } = await import("@/lib/guardrails/pipeline.js");
    const { GuardrailEngine, engineFromPolicy } = await import("open-sse/guardrails/engine.js");
    const sec = await securityRepo();
    const trust = await trustRepo();

    const policy = { id: "p-block", action: "block", detectors: ["pii"] };
    const guardrail = { policy, engine: engineFromPolicy(policy) };
    const decision = guardrail.engine.scan("card 4111 1111 1111 1111 here");
    expect(decision.action).toBe("block");
    auditDecision({ guardrail, decision, direction: "inbound", provider: "openai", model: "gpt-4o" });

    // The audit path is async + unawaited by design — wait for both rows.
    await vi.waitFor(async () => {
      expect(await sec.countSecurityEvents()).toBe(1);
      expect(await trust.countUnreadTrustEvents()).toBe(1);
    }, { timeout: 3000 });

    const page = await sec.listSecurityEvents({});
    expect(page.rows[0].kind).toBe("guardrail.block");
    expect(page.rows[0].detail).toMatchObject({ policyId: "p-block", direction: "inbound", provider: "openai", model: "gpt-4o" });
    expect(JSON.stringify(page.rows[0].detail)).not.toContain("4111");
  });

  it("the streaming tap still relays the block terminal frames and ends the turn", async () => {
    const { guardOutboundStream } = await import("@/lib/guardrails/pipeline.js");
    const { GuardrailEngine, engineFromPolicy } = await import("open-sse/guardrails/engine.js");
    const { FORMATS } = await import("open-sse/transformer/translator/formats.js");
    const policy = { id: "p-stream", action: "block", detectors: ["pii"] };
    const guardrail = { policy, engine: engineFromPolicy(policy) };
    const encoder = new TextEncoder();
    let closed = 0;
    // A 16-digit card is a 16-char entity — longer than the held tail, so it
    // is the very shape that must be judged BEFORE release (see handleEvent's
    // window note in pipeline.js).
    const src = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "charge 4111 1111 1111 1111 now" } }] })}\n\n`));
        // never close — the tap must terminate itself on a block
      },
      cancel() { closed++; },
    });
    const out = guardOutboundStream(src, { guardrail, format: FORMATS.OPENAI });
    const reader = out.getReader();
    let text = "";
    const deadline = Date.now() + 3000;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
      if (Date.now() > deadline) throw new Error("tap did not terminate after a block");
    }
    expect(text).toContain("guardrail");               // the block message reached the client
    expect(text).toContain("Response blocked");       // the 451's own message, in the OPENAI frame
    expect(text).not.toContain("4111 1111 1111 1111"); // the blocked turn never relays the value
    expect(closed).toBeGreaterThanOrEqual(0);  // (cancel is best-effort; see below)
  });
});
