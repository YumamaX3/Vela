// The notification posture's SAVE LAW (src/lib/notificationsSettings.js) and
// the settings route's secret-free echo.
//
//   1. Deep merge — a partial patch never clobbers a stored secret.
//   2. Secrets are write-once — an empty string keeps the stored value; the
//      explicit clear flag is the only way to erase one.
//   3. Validity at the door — unknown event names and non-http(s) URLs are
//      refused (a typo can never switch an event ON, a `file:` URL can never
//      become a delivery target).
//   4. The response surface carries presence FLAGS, never the secret.
import { describe, it, expect } from "vitest";
import { mergeNotificationPatch } from "@/lib/notificationsSettings.js";

// EXAMPLE fixtures only — never a live credential.
const STORED_SECRET = "PLACEHOLDER-stored-webhook-secret-0001";
const STORED_TOKEN = "PLACEHOLDER-stored-bot-token-0001";

const stored = () => ({
  webhooks: { webhookUrl: "https://hooks.example.com/a", webhookSecret: STORED_SECRET, webhookEvents: ["usage"] },
  notify: { telegramEnabled: true, telegramBotToken: STORED_TOKEN, telegramChatId: "-100" },
});

describe("mergeNotificationPatch — the deep-merge + write-once law", () => {
  it("a partial patch keeps the stored URL, secret and the switches it did not name", () => {
    const out = mergeNotificationPatch(stored(), { webhooks: { webhookEvents: ["error"] } });
    expect(out.ok).toBe(true);
    expect(out.webhooks).toEqual({
      webhookUrl: "https://hooks.example.com/a",
      webhookSecret: STORED_SECRET,
      webhookEvents: ["error"],
    });
  });

  it("an EMPTY secret keeps the stored one; clearWebhookSecret is the only erase", () => {
    const kept = mergeNotificationPatch(stored(), { webhooks: { webhookSecret: "" } });
    expect(kept.webhooks.webhookSecret).toBe(STORED_SECRET);
    const cleared = mergeNotificationPatch(stored(), { webhooks: { clearWebhookSecret: true } });
    expect(cleared.webhooks.webhookSecret).toBe("");
  });

  it("an empty Telegram token keeps the stored one; the chat id updates", () => {
    const out = mergeNotificationPatch(stored(), { notify: { telegramBotToken: "", telegramChatId: "42" } });
    expect(out.notify.telegramBotToken).toBe(STORED_TOKEN);
    expect(out.notify.telegramChatId).toBe("42");
    expect(out.notify.telegramEnabled).toBe(true);
  });

  it("an unknown event name is REFUSED (a typo never switches an event on)", () => {
    const out = mergeNotificationPatch(stored(), { webhooks: { webhookEvents: ["usage", "usgae"] } });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Unknown webhook event/);
  });

  it("a non-http(s) webhook URL is REFUSED", () => {
    const out = mergeNotificationPatch(stored(), { webhooks: { webhookUrl: "file:///etc/passwd" } });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/http/);
  });

  it("both posture objects are validated together, and only the patched keys return", () => {
    const out = mergeNotificationPatch(stored(), { notify: { telegramEnabled: false } });
    expect(out).not.toHaveProperty("webhooks");
    expect(out.notify.telegramEnabled).toBe(false);
  });
});
