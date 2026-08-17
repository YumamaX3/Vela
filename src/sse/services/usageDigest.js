// Usage Observatory W3-D — the weekly usage digest.
//
// Once a week the digest summarizes the LAST 7 DAYS of the usage ledger —
// requests, tokens, est. cost, top providers/models/keys by cost — and rides
// the SAME operator-configured channels W3-C forged (Discord + n8n webhooks).
// It is the scheduled, calm cousin of the budget alerts: no thresholds, just
// the week's shape.
//
// Scope honesty: the digest covers one period only. A delta against the prior
// week is W3-E's compare-periods item (CASE WHEN double-range) — the day blobs
// returned by getUsageDailySince carry no dateKey of their own (it is a ledger
// column, filtered in SQL), so a clean 7-vs-7 split is not possible on this
// seam. One period, honestly.
//
// Once-per-week guarantee: the last-sent marker rides the kv store via
// digestRepo (scope "digest") — survives restarts and hot reloads; the
// hourly scheduler tick + kv dedupe mean exactly one digest per week even if
// the server restarts mid-week. A manual send (POST /api/usage/digest/send)
// bypasses the week dedupe but still respects the enabled channels.
//
// Failure posture — fail-open, honest, matching W3-C: a delivery error never
// throws, never blocks, NEVER logs a webhook URL (secret-bearing). The
// scheduler is idempotent and .unref()ed (backupScheduler precedent).
//
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W3 GOVERNANCE).

import { quotaWindowStart } from "@/lib/budgetDef.js";
import { isHttpUrl, postJson } from "./budgetAlerts.js";

const TICK_MS = 60 * 60 * 1000; // hourly check — week rollover caught within the hour
const TOP_N = 5;

// One scheduler per server process — survives Next.js hot reload.
const g = (global.__velaDigest ??= {
  timer: null,
  running: false,
  lastResult: null, // {ok, sent, skipped?, error?, at}
  nextRunAt: null,
});

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Digest body — pure aggregation over the daily ledger ────────────────────

function topByCost(entries, labelFn) {
  const rows = Object.entries(entries || {})
    .map(([key, e]) => ({ label: labelFn(key, e), cost: e.cost || 0, requests: e.requests || 0, tokens: (e.promptTokens || 0) + (e.completionTokens || 0) }))
    .filter((r) => r.requests > 0)
    .sort((a, b) => b.cost - a.cost);
  return rows.slice(0, TOP_N);
}

/** Sum the last 7 days of the usage ledger into the digest shape. Reads the
 *  same frozen seam budgetGate uses (getUsageDailySince). */
export async function buildWeeklyDigest() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 6); // 7 calendar days including today
  const startKey = localDateKey(start);

  const { getUsageDailySince } = await import("@/lib/db/repos/usageRepo.js");
  // Days are already SQL-filtered to >= startKey; day blobs carry no dateKey
  // of their own — sum the array as-is (same convention as budgetGate).
  const days = await getUsageDailySince(startKey);

  const totals = { requests: 0, tokens: 0, cachedTokens: 0, cost: 0 };
  const byProvider = {};
  const byModel = {};
  const byKey = {};

  const bump = (bucket, k, e) => {
    const t = bucket[k] || (bucket[k] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 });
    t.requests += e.requests || 1;
    t.promptTokens += e.promptTokens || 0;
    t.completionTokens += e.completionTokens || 0;
    t.cost += e.cost || 0;
  };

  for (const day of days) {
    totals.requests += day.requests || 0;
    totals.tokens += (day.promptTokens || 0) + (day.completionTokens || 0);
    totals.cachedTokens += day.cachedTokens || 0;
    totals.cost += day.cost || 0;
    for (const [prov, e] of Object.entries(day.byProvider || {})) bump(byProvider, prov, e);
    for (const [mk, e] of Object.entries(day.byModel || {})) {
      const raw = e?.rawModel;
      if (!raw) continue;
      bump(byModel, e.provider ? `${e.provider}/${raw}` : raw, e);
    }
    for (const e of Object.values(day.byApiKey || {})) {
      // Masked identity only — the digest never carries a raw key. keyPrefix
      // is what the dashboard shows; "no key" for keyless attribution rows.
      const label = e?.keyPrefix || (e?.keyId ? "(rotated key)" : "No key");
      bump(byKey, label, e);
    }
  }

  return {
    period: { start: startKey, end: localDateKey(now) },
    totals,
    topProviders: topByCost(byProvider, (k) => k),
    topModels: topByCost(byModel, (k) => k),
    topKeys: topByCost(byKey, (k) => k),
  };
}

// ── Delivery (Discord + n8n) — reuses W3-C's channels ──────────────────────

function fmtMoney(centsLike) {
  return `$${(centsLike || 0).toFixed(2)}`;
}
function fmtTokens(n) {
  return (n || 0).toLocaleString();
}
function fmtTopRows(rows) {
  if (!rows.length) return "—";
  return rows.map((r) => `${r.label}: ${fmtMoney(r.cost)} / ${fmtTokens(r.tokens)} tok`).join("\n");
}

async function deliverDigest(digest) {
  let settings;
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    settings = await getSettings();
  } catch {
    return; // settings unreadable → nothing configured, degrade silently
  }
  const cfg = settings?.budgetAlerts;
  if (!cfg) return;

  const title = `⛵ Vela weekly usage digest — ${digest.period.start} → ${digest.period.end}`;
  if (cfg.discordEnabled && isHttpUrl(cfg.discordWebhookUrl)) {
    await postJson(cfg.discordWebhookUrl, {
      content: title,
      embeds: [{
        title: "Last 7 days",
        color: 0x2563eb,
        fields: [
          { name: "Requests", value: fmtTokens(digest.totals.requests), inline: true },
          { name: "Tokens", value: fmtTokens(digest.totals.tokens), inline: true },
          { name: "Est. cost", value: fmtMoney(digest.totals.cost), inline: true },
          { name: "Top providers", value: fmtTopRows(digest.topProviders).slice(0, 1024) },
          { name: "Top models", value: fmtTopRows(digest.topModels).slice(0, 1024) },
          { name: "Top keys", value: fmtTopRows(digest.topKeys).slice(0, 1024) },
        ],
      }],
    });
  }

  if (cfg.n8nEnabled && isHttpUrl(cfg.n8nWebhookUrl)) {
    // n8n consumes the structured digest verbatim — its workflows decide shape.
    await postJson(cfg.n8nWebhookUrl, { source: "vela-usage-digest", ...digest });
  }
}

// ── The tick — once-per-week via the kv marker ─────────────────────────────

/** Run the weekly digest. `force` bypasses the week dedupe (manual send) but
 *  never bypasses the enabled-channel check. Fail-open: returns a result
 *  object, never throws. */
export async function runWeeklyDigest({ force = false } = {}) {
  if (g.running) return { ok: true, sent: false, skipped: "already-running" };

  let settings;
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    settings = await getSettings();
  } catch {
    return { ok: false, sent: false, error: "settings-unavailable" };
  }
  const enabled = !!settings?.budgetAlerts?.weeklyDigestEnabled;
  if (!enabled && !force) return { ok: true, sent: false, skipped: "disabled" };

  const weekStart = quotaWindowStart("week");
  let state = {};
  try {
    const { getDigestState } = await import("@/lib/db/repos/digestRepo.js");
    state = await getDigestState();
  } catch {
    // Marker unreadable → degrade to in-process caution only (still send;
    // a lost marker must not silence the digest forever).
  }
  if (!force && state.lastSentWeek === weekStart) {
    return { ok: true, sent: false, skipped: "already-sent-this-week" };
  }

  g.running = true;
  try {
    const digest = await buildWeeklyDigest();
    await deliverDigest(digest);
    try {
      const { setDigestState } = await import("@/lib/db/repos/digestRepo.js");
      await setDigestState({ lastSentWeek: weekStart, lastSentAt: new Date().toISOString() });
    } catch { /* marker write failure degrades the dedupe, not the delivery */ }
    g.lastResult = { ok: true, sent: true, period: digest.period, at: new Date().toISOString() };
    return g.lastResult;
  } catch (err) {
    g.lastResult = { ok: false, sent: false, error: err?.message || String(err), at: new Date().toISOString() };
    console.warn("[digest] weekly tick failed (fail-open):", err?.message);
    return g.lastResult;
  } finally {
    g.running = false;
  }
}

// ── The scheduler — backupScheduler precedent ──────────────────────────────

export async function isDigestEnabled() {
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    return !!settings?.budgetAlerts?.weeklyDigestEnabled;
  } catch {
    return false;
  }
}

export async function digestTick() {
  if (!(await isDigestEnabled())) return { skipped: "disabled" };
  return runWeeklyDigest();
}

/** Start the scheduler (idempotent). Returns immediately. */
export function startDigestScheduler() {
  if (g.timer) return; // already running — idempotent
  // One tick shortly after boot (catches up a missed week), then hourly.
  const bootDelayMs = 60 * 1000;
  g.nextRunAt = Date.now() + bootDelayMs;
  g.timer = setTimeout(function arm() {
    digestTick().catch(() => {}); // fail-open: never let a tick throw out
    g.nextRunAt = Date.now() + TICK_MS;
    g.timer = setInterval(() => digestTick().catch(() => {}), TICK_MS);
    if (g.timer.unref) g.timer.unref();
  }, bootDelayMs);
  if (g.timer.unref) g.timer.unref(); // never hold the process open
  console.log("[digest] scheduler started");
}

/** Stop the scheduler (idempotent). */
export function stopDigestScheduler() {
  if (!g.timer) return;
  clearTimeout(g.timer);
  clearInterval(g.timer);
  g.timer = null;
  g.nextRunAt = null;
  console.log("[digest] scheduler stopped");
}

/** Re-read settings + start/stop accordingly. Called from boot + settings
 *  changes. Idempotent and fail-open by law. */
export async function configureDigestScheduler() {
  if (await isDigestEnabled()) startDigestScheduler();
  else stopDigestScheduler();
}

/** Status snapshot for GET /api/usage/digest. */
export function getDigestStatus() {
  return {
    enabled: null, // resolved by the route (async settings read)
    running: g.running,
    lastResult: g.lastResult,
    nextRunAt: g.nextRunAt ? new Date(g.nextRunAt).toISOString() : null,
  };
}
