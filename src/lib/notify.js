// Telegram notifications — the human channel beside the machine webhooks.
//
// `sendTelegram(text)` POSTs { chat_id, text } to
// https://api.telegram.org/bot<token>/sendMessage and returns a verdict —
// it never throws and never blocks a caller that does not await it. An empty
// token or chat id, `telegramEnabled: false`, or an unreadable settings row
// sends NOTHING (off by default, all the way through).
//
// The bot token IS the credential of this channel: it is never logged, never
// echoed, and never concatenated into a warning line — the ONE warning names
// the HTTP status or the transport fault, nothing more. The text is masked
// through the same house walker the webhooks use (no secret-shaped string
// survives), and Telegram's hard cap (4096 code points per message) is
// enforced by truncation with a visible marker rather than a silent drop.
//
// Telegram refuses Markdown entities it cannot parse (a stray `_` in a model
// id returns 400), so messages are sent as PLAIN text — `parse_mode` is not set.

import { maskSecretPayload } from "./db/repos/backupSecurity.js";
import * as log from "@/sse/utils/logger.js";

const TELEGRAM_MAX_TEXT = 4096;
const TIMEOUT_MS = 5_000;

/** Mask a human text through the payload walker, then clamp to Telegram's cap. */
export function composeTelegramText(text) {
  const masked = maskSecretPayload({ text: String(text ?? "") }).text ?? "";
  if (masked.length <= TELEGRAM_MAX_TEXT) return masked;
  const marker = "\n… [truncated]";
  return masked.slice(0, TELEGRAM_MAX_TEXT - marker.length) + marker;
}

function telegramUrl(token) {
  return `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
}

async function postTelegram(token, chatId, text) {
  try {
    const res = await fetch(telegramUrl(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let detail = null;
    if (!res.ok) {
      // Telegram's error body names the fault ("chat not found", "unauthorized")
      // and never echoes the token — surface its `description` only.
      try {
        const body = await res.json();
        // Telegram's description is masked at the edge too — the house law is
        // "nothing secret-shaped crosses a boundary", not "trust the vendor".
        detail = typeof body?.description === "string"
          ? String(maskSecretPayload({ text: body.description.slice(0, 200) }).text)
          : null;
      } catch { detail = null; }
    }
    return { ok: !!(res && res.ok), status: res?.status ?? 0, error: detail };
  } catch (err) {
    return { ok: false, status: 0, error: err?.name === "TimeoutError" ? "timeout" : "network" };
  }
}

/**
 * Send one Telegram message. Pure fail-open: every failure is a verdict, never
 * a throw. Returns { ok, sent, status?, error? }.
 */
export async function sendTelegram(text) {
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    const cfg = settings?.notify;
    // Only an EXPLICIT `false` reads as "switched off". A missing posture is the
    // defaults' OFF, and an UNREADABLE one is unknown — never misreported as a
    // deliberate choice (the honest verdict for that is `error` below).
    if (cfg && cfg.telegramEnabled === false) return { ok: false, sent: false, reason: "disabled" };
    if (!cfg || typeof cfg !== "object") return { ok: false, sent: false, reason: "error" };
    const token = typeof cfg.telegramBotToken === "string" ? cfg.telegramBotToken.trim() : "";
    const chatId = typeof cfg.telegramChatId === "string" ? String(cfg.telegramChatId).trim() : "";
    if (!token || !chatId) return { ok: false, sent: false, reason: "unconfigured" };

    const body = composeTelegramText(text);
    if (!body.trim()) return { ok: false, sent: false, reason: "empty" };

    const verdict = await postTelegram(token, chatId, body);
    if (!verdict.ok) {
      // ONE warning, no token, no chat-id value.
      log.warn(
        "NOTIFY",
        `[telegram] delivery failed (${verdict.error || `HTTP ${verdict.status}`}) — fail-open, nothing retried`
      );
    }
    return { ok: verdict.ok, sent: true, status: verdict.status || null, error: verdict.ok ? undefined : verdict.error };
  } catch (err) {
    try { log.warn("NOTIFY", "[telegram] send skipped (fail-open):", err?.message || String(err)); } catch { /* never throw */ }
    return { ok: false, sent: false, reason: "error" };
  }
}

/**
 * The settings "Test Telegram" button — unlike a passive send, the operator
 * gets the verdict back. Reports the exact failure without the credential.
 */
export async function testTelegram() {
  const result = await sendTelegram("🔔 Vela test notification — if you can read this, the Telegram channel works.");
  if (result.ok) return { ok: true, sent: true, status: result.status, message: "Test message delivered" };
  const reasons = {
    disabled: "Telegram notifications are switched off",
    unconfigured: "Bot token and chat id are both required",
    empty: "Nothing to send",
    error: "Unexpected error while sending",
  };
  return {
    ok: false,
    sent: !!result.sent,
    status: result.status ?? null,
    reason: result.reason ?? (result.sent ? "delivery" : "error"),
    message: result.reason
      ? reasons[result.reason] || "Not sent"
      : `Delivery failed (${result.error || `HTTP ${result.status}`})`,
  };
}
