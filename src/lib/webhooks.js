// The webhook ledger — the operator's OUTBOUND event stream.
//
// Three events, each independently switchable, ALL OFF BY DEFAULT:
//   'usage' — a usage-rollup window closed (the Endpoints page's per-key rollup)
//   'quota' — the key gate DENIED a request on a ceiling (rate/spend/budget/…)
//   'error' — an upstream error crossed the burst threshold on one provider/model
//
// The laws this file keeps:
//
//  1. OFF MEANS SILENT. An empty `webhookEvents` array emits NOTHING — no
//     settings read, no fetch, no warning. Delivery is attempted only when the
//     event is switched on AND a well-formed http(s) URL is configured.
//
//  2. FAIL-OPEN, ALWAYS. `emitWebhook` never throws, never blocks its caller,
//     and never rejects: settings come from a background promise, delivery from
//     another. Any delivery error is swallowed after ONE warning line — and
//     that line never carries the URL, the secret, or the signature.
//
//  3. SIGNED. Every POST carries
//       X-Vela-Signature: sha256=<hex HMAC-SHA256 of the RAW BODY with webhookSecret>
//       X-Vela-Event:     <event>
//     The receiver recomputes over the bytes it received — so the body must be
//     serialized ONCE and echoed by Express's `express.json({ verify })` (see
//     custom-server.js) or by reading the raw stream. No secret configured →
//     no X-Vela-Signature header at all (an HMAC with an empty key proves
//     nothing, and a receiver that verifies against "" would accept anyone).
//
//  4. MASKED. Payloads pass through maskSecretPayload (backupSecurity.js — the
//     house masking source; usageRepo exports NO masker, only a private
//     `maskApiKey`, so the local walker lives there and is reused here rather
//     than duplicated). The keyId is coarsened to its prefix here, because a
//     webhook body is a log written to a third party by definition.
//
//  5. BOUNDED RETRY. At most 2 retries (3 attempts total), 1s then 5s backoff,
//     5s per-request timeout. Exhausted → one warning, then silence.
//
// A delivery whose await never resolves (a black-holed DNS) must still never
// pile up: each attempt is bounded by its own timeout, so the chain always ends.

import crypto from "node:crypto";
import { maskSecretPayload } from "./db/repos/backupSecurity.js";
import * as log from "@/sse/utils/logger.js";

export const WEBHOOK_EVENTS = ["usage", "quota", "error"];
export const RETRY_DELAYS_MS = [1_000, 5_000];
const TIMEOUT_MS = 5_000;

export function isHttpUrl(url) {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

/** Normalize the operator's event switches. Unknown names are dropped — a
 *  typo can never switch an event ON. Returns [] for anything not an array.
 *  Only STRINGS are events: a stored object/array at this position is garbage
 *  the validator should have refused, and is dropped here rather than carried
 *  further (array identity and coalescing both produce horrors on a header). */
export function normalizeWebhookEvents(events) {
  if (!Array.isArray(events)) return [];
  return [...new Set(events.filter((e) => typeof e === "string"))].filter((e) => WEBHOOK_EVENTS.includes(e));
}

/** Is `event` armed right now — switched on AND a well-formed URL configured?
 *  Synchronous, mirror-only, never throws. Null mirror (nothing loaded yet)
 *  reads as NOT armed: an unarmed channel is the default, and the first page
 *  load arms it. */
export function isWebhookArmed(event) {
  try {
    const cfg = globalThis._velaSettingsMirror?.webhooks;
    if (!cfg) return false;
    if (!normalizeWebhookEvents(cfg.webhookEvents).includes(event)) return false;
    return isHttpUrl(cfg.webhookUrl);
  } catch {
    return false;
  }
}

/** sha256=<hex> for a raw body string. Exported so a receiver (and the test
 *  vector) recomputes it independently — same function, same bytes, no drift. */
export function signBody(rawBody, secret) {
  if (typeof secret !== "string" || !secret) return null;
  return `sha256=${crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

/** The per-event payload. Pure; already masked (the caller may mask again). */
function buildWebhookPayload(event, payload, now) {
  const keyed = { ...payload };
  // Coarsen key identity: a keyId is a stable handle; the prefix is what an
  // operator recognises. Never the key, never the hash.
  if (typeof keyed.keyId === "string") keyed.keyPrefix = keyed.keyId.slice(0, 8);
  delete keyed.keyId;
  return {
    source: "vela",
    event,
    ts: new Date(now).toISOString(),
    ...keyed,
  };
}

/** One POST, bounded. Resolves { ok, status } and NEVER rejects. */
async function postOnce(url, body, headers) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ok: !!(res && res.ok), status: res?.status ?? 0 };
  } catch (err) {
    return { ok: false, status: 0, error: err?.name === "TimeoutError" ? "timeout" : "network" };
  }
}

// The warning line's in-flight ledger. A URL that is down produces a warning
// per emission; without a bound, a 100 rps error storm becomes 100 warning
// lines per second. One warning per consecutive failing streak, re-opened
// after a quiet spell — honest (it says the streak lasted) and bounded.
// LIFECYCLE KEY: the suite anchors it to the harbour it runs against, so the
// failure streak never crosses a per-test DATA_DIR boundary.
export function webhookLifecycle(key) {
  if (key) global._velaWebhookLifecycle = String(key);
  return global._velaWebhookLifecycle || "process";
}

const warnStreak = new Map(); // sanitized endpoint -> { failures, lastWarnAt, warned }
const QUIET_AFTER_MS = 60_000;

function warnOnce(url, event, reason) {
  try {
    const endpoint = `${new URL(url).origin}${new URL(url).pathname}`;
    const prev = warnStreak.get(endpoint);
    const now = Date.now();
    const quiet = !prev || now - prev.lastWarnAt > QUIET_AFTER_MS;
    if (prev && !quiet && prev.warned) {
      warnStreak.set(endpoint, { ...prev, failures: prev.failures + 1, lastWarnAt: now });
      return;
    }
    log.warn(
      "WEBHOOK",
      `[webhooks] delivery failed after ${RETRY_DELAYS_MS.length + 1} attempts (${reason}) — event "${event}" to ${endpoint}` +
        (prev && prev.failures > 0 ? ` [streak: ${prev.failures + 1} suppressed]` : "")
    );
    warnStreak.set(endpoint, { failures: 0, lastWarnAt: now, warned: true });
  } catch {
    // Fail-open even here — a malformed URL must not throw out of a notifier.
  }
}

async function deliver(url, event, rawBody, headers, generation) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    // A retry that wakes in a NEW life must not ring the old life's receiver.
    if (webhookLifecycle() !== generation) return;
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
    const res = await postOnce(url, rawBody, headers);
    if (res.ok) return;
    if (attempt === RETRY_DELAYS_MS.length) {
      // Only the transport fault / status number — never the response body,
      // which a receiver may have echoed back with the request's own secret.
      warnOnce(url, event, res.error || `HTTP ${res.status}`);
    }
  }
}

/**
 * Emit one webhook event. FIRE-AND-FORGET by construction: returns undefined
 * synchronously, schedules everything as a detached promise, and any failure
 * (settings read, masking, serialization, delivery) is swallowed.
 *
 * @param {"usage"|"quota"|"error"} event
 * @param {object} payload — already-aggregated facts; masked here regardless.
 */
export function emitWebhook(event, payload = {}) {
  // Kick the work off WITHOUT awaiting it. `.catch` is belt-and-braces: the
  // inner body is defensive, but a notifier must never surface a rejection.
  const generation = webhookLifecycle();
  void (async () => {
    try {
      const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
      const settings = await getSettings();
      const cfg = settings?.webhooks;
      if (!cfg || typeof cfg !== "object") return;
      const events = normalizeWebhookEvents(cfg.webhookEvents);
      if (events.length === 0 || !events.includes(event)) return; // OFF = silent
      const url = typeof cfg.webhookUrl === "string" ? cfg.webhookUrl.trim() : "";
      if (!isHttpUrl(url)) return;
      // LAST-MILE: the settings read is slow (a harbour round-trip); if a new
      // lifecycle began while it was in flight, this delivery belongs to a life
      // that has ended — drop it rather than ring another world's mock.
      if (webhookLifecycle() !== generation) return;

      const masked = maskSecretPayload(buildWebhookPayload(event, payload, Date.now()));
      const rawBody = JSON.stringify(masked);
      const headers = { "Content-Type": "application/json", "X-Vela-Event": event };
      const signature = signBody(rawBody, typeof cfg.webhookSecret === "string" ? cfg.webhookSecret : "");
      if (signature) headers["X-Vela-Signature"] = signature;

      await deliver(url, event, rawBody, headers, generation);
    } catch (err) {
      try { log.warn("WEBHOOK", "[webhooks] emission skipped (fail-open):", err?.message || String(err)); } catch { /* never throw */ }
    }
  })().catch(() => {});
}

/**
 * The settings "Test webhook" button. Unlike emitWebhook this DOES report —
 * a button that cannot tell you its test failed is a lie. It still never
 * throws: every outcome is a { ok, ... } verdict. A missing signature secret
 * is reported honestly (the button does not invent a signed delivery).
 */
export async function testWebhook({ event = "usage" } = {}) {
  const now = Date.now();
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    const cfg = settings?.webhooks || {};
    const url = typeof cfg.webhookUrl === "string" ? cfg.webhookUrl.trim() : "";
    if (!isHttpUrl(url)) {
      return { ok: false, sent: false, reason: "no-url", message: "No http(s) webhook URL is configured" };
    }
    const evt = WEBHOOK_EVENTS.includes(event) ? event : "usage";
    const masked = maskSecretPayload({
      ...buildWebhookPayload(evt, { test: true }, now),
      // A canary rides the body so a receiver can prove it saw THIS test.
      testNonce: crypto.randomBytes(8).toString("hex"),
    });
    const rawBody = JSON.stringify(masked);
    const headers = { "Content-Type": "application/json", "X-Vela-Event": evt };
    const signature = signBody(rawBody, typeof cfg.webhookSecret === "string" ? cfg.webhookSecret : "");
    if (signature) headers["X-Vela-Signature"] = signature;
    const res = await postOnce(url, rawBody, headers);
    return {
      ok: res.ok,
      sent: true,
      status: res.status || null,
      signed: Boolean(signature),
      switchedOn: normalizeWebhookEvents(cfg.webhookEvents).includes(evt),
      message: res.ok
        ? "Test event delivered and accepted"
        : `Delivery failed (${res.error || `HTTP ${res.status}`}) — a live delivery would retry ${RETRY_DELAYS_MS.length} times before warning`,
    };
  } catch (err) {
    return { ok: false, sent: false, reason: "error", message: err?.message || "Test failed" };
  }
}
