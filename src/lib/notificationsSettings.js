// The notification posture's save law — shared by the settings route and its
// tests, so the browser form and a direct PATCH are judged in ONE dialect.
//
// Three rules, each load-bearing and each the same shape budgetAlerts uses:
//
//  1. NESTED, NEVER CLOBBERED. `updateSettings` shallow-merges top-level keys,
//     so a partial `{ webhooks: { webhookEvents: ["error"] } }` would otherwise
//     drop a stored secret. Merge against what is stored.
//
//  2. SECRETS ARE WRITE-ONLY-ONCE. An empty / absent secret means "keep the
//     stored one" — the UI never receives the secret, so it cannot echo it
//     back. `clearX: true` is the ONE explicit way to erase one.
//
//  3. VALIDITY AT THE DOOR. An event name outside the vocabulary or a URL that
//     is not http(s) is refused (400), never stored — a typo can never switch
//     an event ON, and a `file:` URL can never become a delivery target. The
//     switches stay OFF by default: an absent `webhookEvents` is [].

import { WEBHOOK_EVENTS, normalizeWebhookEvents, isHttpUrl } from "./webhooks.js";

function str(v) {
  return typeof v === "string" ? v.trim() : "";
}

/** Merge a `webhooks` patch over the stored posture. Returns { ok, error } or
 *  { ok: true, webhooks } / { ok: true, notify } — only keys actually patched. */
export function mergeNotificationPatch(current = {}, body = {}) {
  const out = { ok: true };

  if (Object.prototype.hasOwnProperty.call(body, "webhooks")) {
    const cur = current.webhooks && typeof current.webhooks === "object" ? current.webhooks : {};
    const patch = body.webhooks && typeof body.webhooks === "object" ? body.webhooks : {};
    if (!body.webhooks || typeof body.webhooks !== "object" || Array.isArray(body.webhooks)) {
      return { ok: false, error: "webhooks must be an object" };
    }

    // Events: absent ⇒ keep stored; present ⇒ must be a well-formed subset.
    let events = normalizeWebhookEvents(cur.webhookEvents);
    if (Object.prototype.hasOwnProperty.call(patch, "webhookEvents")) {
      if (!Array.isArray(patch.webhookEvents)) {
        return { ok: false, error: "webhooks.webhookEvents must be an array" };
      }
      const unknown = [...new Set(patch.webhookEvents)].filter((e) => !WEBHOOK_EVENTS.includes(e));
      if (unknown.length) {
        return { ok: false, error: `Unknown webhook event(s): ${unknown.join(", ")} — valid: ${WEBHOOK_EVENTS.join(", ")}` };
      }
      events = normalizeWebhookEvents(patch.webhookEvents);
    }

    // URL: empty ⇒ keep stored; non-empty ⇒ must be http(s).
    let url = str(cur.webhookUrl);
    if (Object.prototype.hasOwnProperty.call(patch, "webhookUrl")) {
      const next = str(patch.webhookUrl);
      if (next && !isHttpUrl(next)) {
        return { ok: false, error: "webhooks.webhookUrl must be an http:// or https:// URL" };
      }
      if (next) url = next;
    }

    // Secret: empty ⇒ keep stored; clearWebhookSecret ⇒ erase.
    let secret = typeof cur.webhookSecret === "string" ? cur.webhookSecret : "";
    if (patch.clearWebhookSecret === true) secret = "";
    if (str(patch.webhookSecret)) secret = str(patch.webhookSecret);

    out.webhooks = { webhookUrl: url, webhookSecret: secret, webhookEvents: events };
  }

  if (Object.prototype.hasOwnProperty.call(body, "notify")) {
    const cur = current.notify && typeof current.notify === "object" ? current.notify : {};
    const patch = body.notify && typeof body.notify === "object" ? body.notify : {};
    if (!body.notify || typeof body.notify !== "object" || Array.isArray(body.notify)) {
      return { ok: false, error: "notify must be an object" };
    }
    let token = typeof cur.telegramBotToken === "string" ? cur.telegramBotToken : "";
    if (patch.clearTelegramBotToken === true) token = "";
    if (str(patch.telegramBotToken)) token = str(patch.telegramBotToken);
    out.notify = {
      telegramEnabled: "telegramEnabled" in patch ? patch.telegramEnabled === true : cur.telegramEnabled === true,
      telegramBotToken: token,
      // Chat ids may be negative (group chats) — keep as the operator typed it.
      telegramChatId: str(patch.telegramChatId) || (typeof cur.telegramChatId === "string" ? cur.telegramChatId : ""),
    };
  }

  return out;
}
