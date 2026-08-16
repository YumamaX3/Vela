// Usage Observatory W2-G — phase13 security obligation: drawer redaction
// inheritance.
//
// /api/usage/request-details stores full conversation payloads (request,
// providerRequest, providerResponse, response) and redacts EXACTLY those four
// keys to {redacted:true} at read time. The Observatory's redaction contract
// rides this route: the W2-E LedgerDrawer renders only enriched metadata (no
// payloads), and any future surface that renders a stored detail MUST pass
// through this redaction. This test pins the law — secrets seeded into the
// four payload keys never surface in the API response, while the surrounding
// metadata (model, provider, status, tokens, latency) survives intact.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w2g-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "w2g-secret";
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function req(routePath, qs = "") {
  return new Request(`http://localhost${routePath}${qs ? `?${qs}` : ""}`);
}

const SECRETS = {
  request: "TOP-SECRET-USER-PROMPT-REQUEST",
  providerRequest: "TOP-SECRET-PROVIDER-REQUEST",
  providerResponse: "TOP-SECRET-PROVIDER-RESPONSE",
  response: "TOP-SECRET-ASSISTANT-ANSWER",
};

/** Seed DIRECTLY into requestDetails via raw SQL — the repo's write path is a
 *  fire-and-forget batched buffer (flushToDatabase races the adapter lifecycle
 *  under vi.resetModules), so we bypass it. What we are proving is the READ
 *  contract: whatever sits in `data` must come back redacted. The record shape
 *  mirrors flushToDatabase's persisted form exactly. */
async function seedDetail() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const record = {
    id: "w2g-detail-1",
    timestamp: new Date(Date.now()).toISOString(),
    provider: "openai",
    model: "gpt-4o",
    connectionId: "conn-w2g",
    status: "success",
    latency: { ttft: 120, total: 450 },
    tokens: { prompt_tokens: 100, completion_tokens: 50 },
    request: { messages: [{ role: "user", content: SECRETS.request }] },
    providerRequest: { body: SECRETS.providerRequest },
    providerResponse: { body: SECRETS.providerResponse },
    response: { content: SECRETS.response },
    pxpipe: { applied: false, reason: "test" },
  };
  db.run(
    `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, JSON.stringify(record)]
  );
}

async function fetchDetails() {
  const { GET } = await import("@/app/api/usage/request-details/route.js");
  const res = await GET(req("/api/usage/request-details", "page=1&pageSize=20"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.details.length).toBeGreaterThanOrEqual(1);
  return body;
}

describe("W2-G phase13 — request-details redaction inheritance", () => {
  it("redacts exactly the four payload keys to {redacted:true}", async () => {
    await seedDetail();
    const body = await fetchDetails();
    const d = body.details[0];
    for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
      expect(d[key], `payload key ${key} must be redacted`).toEqual({ redacted: true });
    }
  });

  it("no secret from any payload key leaks anywhere in the response body", async () => {
    await seedDetail();
    const body = await fetchDetails();
    const text = JSON.stringify(body);
    for (const [key, secret] of Object.entries(SECRETS)) {
      expect(text.includes(secret), `secret from ${key} leaked into the response`).toBe(false);
    }
  });

  it("metadata survives redaction — model, provider, status, tokens, latency", async () => {
    await seedDetail();
    const body = await fetchDetails();
    const d = body.details[0];
    expect(d.model).toBe("gpt-4o");
    expect(d.provider).toBe("openai");
    expect(d.status).toBe("success");
    expect(d.tokens.prompt_tokens).toBe(100);
    expect(d.latency.total).toBe(450);
  });
});
