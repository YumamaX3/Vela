// A/B TESTER — two REAL gateway turns through the gateway's own chat endpoint:
// one bare, one with the operator prompt applied. Nothing is persisted: no temp
// key, no temp policy, no settings write. The prompt rides the request body as
// the system message; the key is the deterministic internal credential
// (loopback-pinned, hidden from every list) — the same self-call shape
// ping.js uses for model tests (plan §3.6).
import { NextResponse } from "next/server";
import { ensureInternalKey } from "@/lib/db/repos/apiKeysRepo.js";
import { detectRefusal } from "@/shared/utils/refusalVerdict.js";
import * as log from "@/sse/utils/logger.js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_PROMPT = 16000;
const MAX_MSG = 8000;
const TIMEOUT_MS = 110_000;

/** One real turn. Returns { ok, status, content, verdict }. Never throws. */
async function callOnce(baseUrl, apiKey, model, messages, { signal, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${baseUrl}/api/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: 1024, stream: false }),
      signal,
    });
    const text = await res.text().catch(() => "");
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    const content = res.ok
      ? String(json?.choices?.[0]?.message?.content ?? "")
      : `HTTP ${res.status}: ${String(json?.error?.message || json?.error || text).slice(0, 400)}`;
    return { ok: res.ok, status: res.status, content, verdict: detectRefusal(content) };
  } catch (e) {
    const content = `error: ${e?.message || String(e)}`;
    return { ok: false, status: 0, content, verdict: detectRefusal(content) };
  }
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const model = String(body.model || "").trim();
  const prompt = String(body.prompt || "").trim();
  const message = String(body.message || "").trim();
  if (!model) return NextResponse.json({ error: "model required" }, { status: 400 });
  if (!message) return NextResponse.json({ error: "sample user message required" }, { status: 400 });
  if (prompt.length > MAX_PROMPT || message.length > MAX_MSG) {
    return NextResponse.json({ error: "prompt or message too long" }, { status: 413 });
  }

  let apiKey = null;
  try { apiKey = (await ensureInternalKey("ab-test")).key; } catch (e) {
    log.warn("AB", `internal key unavailable — relying on open gateway: ${e?.message || e}`);
  }

  const baseUrl = `http://127.0.0.1:${process.env.PORT || 32060}`;
  const bare = [{ role: "user", content: message }];
  const applied = prompt ? [{ role: "system", content: prompt }, ...bare] : null;
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  const [a, b] = await Promise.all([
    callOnce(baseUrl, apiKey, model, bare, { signal }),
    applied
      ? callOnce(baseUrl, apiKey, model, applied, { signal })
      : Promise.resolve({ ok: true, status: 0, content: "", verdict: { refused: false, phrase: null }, skipped: true }),
  ]);

  return NextResponse.json({ model, bare: a, applied: b });
}
