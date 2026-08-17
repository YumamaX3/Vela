// Usage Observatory W3-C — the alert delivery layer.
//
// budgetGate (W3-B) emits a raw alert record on every soft-threshold crossing
// it observes. That signal is noisy: it re-fires while usage stays over the
// threshold (once per cache TTL). This layer turns it into a governed stream —
// **hysteresis** (fire once per upward threshold crossing per window) plus
// **dedupe** (never repeat the same level within a window) — and fans out to
// the sealed plan's channels: the dashboard banner (active-breach state read
// over /api/usage/budgets/alerts) and the operator-configured Discord + n8n
// webhooks.
//
// Re-arm without observing drops: the hysteresis state is keyed by
// budgetId|capType|windowStart. budgetGate never emits when usage falls, so we
// cannot watch a drop — instead, when the window rolls over the key changes
// (usage resets to zero) and the state starts fresh, automatically re-armed.
//
// Failure posture — fail-open, honest: a webhook timeout or a settings read
// error must never block the gate, never throw, and NEVER log the webhook URL
// (a Discord webhook URL carries a token; it is secret-bearing). Delivery is
// fire-and-forget; a missed alert is a dropped notification, never a blocked
// request.
//
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W3 GOVERNANCE).

import { quotaWindowStart } from "@/lib/budgetDef.js";

const WEBHOOK_TIMEOUT_MS = 5_000;
const STATE_MAX = 1_000; // bound the hysteresis map under many budgets × windows

function alertState() {
  if (!global._velaBudgetAlertState) global._velaBudgetAlertState = new Map();
  return global._velaBudgetAlertState;
}
function breachState() {
  if (!global._velaBudgetBreaches) global._velaBudgetBreaches = new Map();
  return global._velaBudgetBreaches;
}

// ── Hysteresis + dedupe ────────────────────────────────────────────────────

/**
 * Record a raw alert from the gate. Returns true when this alert FIRES a
 * delivery (a new upward crossing for its window), false when dedupe swallows
 * it. Synchronous against in-memory state; webhook delivery is fire-and-forget.
 */
export function recordBudgetAlert(alert) {
  if (!alert || !alert.budgetId) return false;
  const windowStart = quotaWindowStart(alert.window, new Date(alert.ts || Date.now()));
  const key = `${alert.budgetId}|${alert.capType}|${windowStart}`;
  const state = alertState();

  // Bound the map — evict oldest entries on overflow.
  if (state.size >= STATE_MAX) {
    for (const k of state.keys()) {
      state.delete(k);
      if (state.size < STATE_MAX) break;
    }
  }

  const prev = state.get(key);
  // Dedupe: only a strictly higher threshold than already fired in this window
  // produces a delivery. Repeats at the same or a lower level are swallowed.
  if (prev && alert.threshold <= prev.threshold) return false;
  state.set(key, { threshold: alert.threshold, ts: alert.ts || Date.now() });

  // Banner state — record the current breach for this budget|capType.
  const breaches = breachState();
  breaches.set(key, {
    budgetId: alert.budgetId,
    scope: alert.scope,
    subject: alert.subject,
    window: alert.window,
    windowStart,
    capType: alert.capType,
    cap: alert.cap,
    used: alert.used,
    pct: alert.pct,
    threshold: alert.threshold,
    ts: alert.ts || Date.now(),
  });

  deliverWebhooks(alert).catch(() => {}); // fire-and-forget; never blocks, never throws
  return true;
}

/** Active breaches for the dashboard banner, current window only, worst first. */
export function getActiveBudgetBreaches() {
  const now = Date.now();
  const out = [];
  for (const breach of breachState().values()) {
    // Drop breaches whose window has since rolled over (stale windowStart).
    const currentStart = quotaWindowStart(breach.window, new Date(now));
    if (breach.windowStart !== currentStart) continue;
    out.push(breach);
  }
  // Worst first: threshold desc, then pct desc.
  out.sort((a, b) => (b.threshold - a.threshold) || (b.pct - a.pct));
  return out;
}

// Test-only: reset in-memory state between cases.
export function _resetAlertState() {
  global._velaBudgetAlertState = new Map();
  global._velaBudgetBreaches = new Map();
}

// ── Webhook delivery (Discord + n8n) ───────────────────────────────────────

function isHttpUrl(url) {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

function formatAlertLine(alert) {
  const capLabel = alert.capType === "token" ? "tokens" : `$${(alert.cap / 100).toFixed(2)}`;
  const usedLabel = alert.capType === "token" ? `${alert.used} tokens` : `$${(alert.used / 100).toFixed(2)}`;
  const subject = alert.subject ? ` (${alert.subject})` : "";
  return `⚠️ Vela budget alert — ${alert.scope}${subject} ${alert.window} ${alert.capType} at ${alert.pct}%: ${usedLabel} of ${capLabel}`;
}

async function postJson(url, payload) {
  // Fail-open, bounded, and NEVER logs the URL (secret-bearing).
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
  } catch {
    /* delivery is best-effort — a dropped webhook is not an error */
  }
}

async function deliverWebhooks(alert) {
  let settings;
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    settings = await getSettings();
  } catch {
    return; // settings unreadable → nothing configured, degrade silently
  }
  const cfg = settings?.budgetAlerts;
  if (!cfg) return;

  if (cfg.discordEnabled && isHttpUrl(cfg.discordWebhookUrl)) {
    await postJson(cfg.discordWebhookUrl, {
      content: formatAlertLine(alert),
      // Compact embed for richer context without leaking internals.
      embeds: [{
        title: "Budget threshold crossed",
        fields: [
          { name: "Scope", value: String(alert.scope), inline: true },
          { name: "Subject", value: alert.subject ? String(alert.subject) : "—", inline: true },
          { name: "Window", value: String(alert.window), inline: true },
          { name: "Cap type", value: String(alert.capType), inline: true },
          { name: "Threshold", value: `${alert.threshold}%`, inline: true },
          { name: "Usage", value: `${alert.pct}%`, inline: true },
        ],
        color: alert.threshold >= 100 ? 0xdc2626 : 0xd97706,
      }],
    });
  }

  if (cfg.n8nEnabled && isHttpUrl(cfg.n8nWebhookUrl)) {
    // n8n consumes the structured alert verbatim — its workflows decide shape.
    await postJson(cfg.n8nWebhookUrl, {
      source: "vela-budget-alert",
      ...alert,
    });
  }
}
