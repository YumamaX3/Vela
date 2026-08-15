import { NextResponse } from "next/server";
import { getSyncedPricing, replaceSyncedPricing, clearSyncedPricing } from "@/lib/db/index.js";
import { SYNC_VENDOR_MAP } from "open-sse/providers/pricing.js";

/**
 * POST /api/pricing/sync — refresh synced pricing from models.dev (primary)
 * with an OpenRouter cross-check. Pricing Covenant commit C5.
 *
 * SSRF defense: the ONLY fetchable URLs are hardcoded in SYNC_VENDOR_MAP;
 * the request body selects vendors by KEY and never carries URLs.
 * Every fetched payload is treated as untrusted data: schema-clamped,
 * size-capped, and prototype-pollution keys rejected before any write.
 */

const FETCH_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_ENTRIES = 100000;
const RATE_MAX = 10000; // $/1M sanity ceiling
const KEY_MAX_LEN = 200;
const KEY_RE = /^[a-zA-Z0-9._:@/-]+$/;
const POISON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function safeKey(k) {
  return typeof k === "string" && k.length <= KEY_MAX_LEN && KEY_RE.test(k) && !POISON_KEYS.has(k);
}

function clampRate(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= RATE_MAX ? v : undefined;
}

/** Map a models.dev cost object to the five-field shape (omit-don't-zero-fill). */
function mapCost(cost) {
  if (!cost || typeof cost !== "object") return null;
  const out = {};
  const input = clampRate(cost.input);
  const output = clampRate(cost.output);
  if (input !== undefined) out.input = input;
  if (output !== undefined) out.output = output;
  const cached = clampRate(cost.cache_read);
  if (cached !== undefined) out.cached = cached;
  const write = clampRate(cost.cache_write);
  if (write !== undefined) out.cache_creation = write;
  const reasoning = clampRate(cost.reasoning);
  if (reasoning !== undefined) out.reasoning = reasoning;
  return Object.keys(out).length > 0 ? out : null;
}

async function fetchCapped(url) {
  const res = await fetch(url, {
    redirect: "error", // never follow — a compromised host cannot 302 us anywhere
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_RESPONSE_BYTES) throw new Error("response too large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_RESPONSE_BYTES) throw new Error("response too large");
  return JSON.parse(buf.toString("utf8"));
}

function buildSyncPayload() {
  const vendorMap = SYNC_VENDOR_MAP.modelsdev;
  if (!vendorMap) throw new Error("SYNC_VENDOR_MAP missing modelsdev source");
  return vendorMap;
}

export async function POST(request) {
  try {
    const { modelsdev, openrouter } = SYNC_VENDOR_MAP;

    // 1. Body selects vendors by key only — never URLs (SSRF defense).
    let body = {};
    try { body = await request.json(); } catch { /* empty body = all vendors */ }
    const requested = Array.isArray(body?.vendors) ? body.vendors.filter(k => typeof k === "string" && safeKey(k)) : null;

    // 2. Fetch primary source (models.dev — numeric $/1M per vendor).
    let modelsDev = null;
    const failed = [];
    try {
      modelsDev = await fetchCapped(modelsdev.url);
    } catch (e) {
      failed.push({ vendor: "modelsdev", reason: e.message });
    }

    const synced = {};
    let entryCount = 0;
    const sources = [{ url: modelsdev.url, status: modelsDev ? "ok" : "failed", entryCount: 0 }];

    if (modelsDev?.providers) {
      for (const [vendorId, targetIds] of Object.entries(modelsdev.vendors)) {
        if (requested && !requested.includes(vendorId)) continue;
        const vendorBlock = modelsDev.providers[vendorId];
        if (!vendorBlock?.models) continue;
        const targets = Array.isArray(targetIds) ? targetIds : [targetIds];
        for (const targetId of targets) {
          if (POISON_KEYS.has(targetId) || !safeKey(targetId)) continue;
          if (!synced[targetId]) synced[targetId] = {};
          for (const [modelId, modelData] of Object.entries(vendorBlock.models)) {
            if (!safeKey(modelId) || !modelData?.cost) continue;
            if (entryCount >= MAX_ENTRIES) break;
            const rates = mapCost(modelData.cost);
            if (!rates) continue;
            if (!synced[targetId][modelId]) {
              synced[targetId][modelId] = rates;
              entryCount++;
            }
          }
        }
      }
      sources[0].entryCount = entryCount;
    }

    // 3. Cross-check via OpenRouter (per-token strings × 1e6). Non-fatal.
    let crossCheck = { checked: 0, disagreements: 0 };
    if (openrouter && modelsDev) {
      try {
        const or = await fetchCapped(openrouter.url);
        const orModels = Array.isArray(or?.data) ? or.data : [];
        const orRates = new Map();
        for (const m of orModels) {
          if (!safeKey(m?.id)) continue;
          const p = m.pricing || {};
          const input = clampRate(Number(p.prompt || 0) * 1e6);
          const output = clampRate(Number(p.completion || 0) * 1e6);
          if (input !== undefined && output !== undefined) orRates.set(m.id, { input, output });
        }
        // Compare against canonical (vendor-prefixed) synced entries where ids align.
        for (const [provider, models] of Object.entries(synced)) {
          for (const [modelId, rates] of Object.entries(models)) {
            const key = `${provider}/${modelId}`;
            const orr = orRates.get(key);
            if (!orr) continue;
            crossCheck.checked++;
            const diffIn = Math.abs((orr.input - (rates.input ?? 0)) / Math.max(orr.input, 0.001));
            const diffOut = Math.abs((orr.output - (rates.output ?? 0)) / Math.max(orr.output, 0.001));
            if (diffIn > 0.05 || diffOut > 0.05) crossCheck.disagreements++;
          }
        }
        sources.push({ url: openrouter.url, status: "ok", entryCount: orRates.size });
      } catch (e) {
        sources.push({ url: openrouter.url, status: "failed", entryCount: 0 });
        failed.push({ vendor: "openrouter", reason: e.message });
      }
    }

    if (entryCount === 0 && failed.length > 0) {
      // Nothing synced and sources failed — commit nothing, report honestly.
      return NextResponse.json({ ok: false, error: "All sync sources failed", failed, crossCheck }, { status: 502 });
    }

    // 4. Compute diff against the previous sync namespace, then commit atomically.
    const prev = await getSyncedPricing();
    const diff = { added: 0, updated: 0, removed: 0 };
    for (const [provider, models] of Object.entries(synced)) {
      for (const modelId of Object.keys(models)) {
        if (!prev.providers[provider]?.[modelId]) diff.added++;
        else if (JSON.stringify(prev.providers[provider][modelId]) !== JSON.stringify(models[modelId])) diff.updated++;
      }
    }
    for (const [provider, models] of Object.entries(prev.providers)) {
      for (const modelId of Object.keys(models)) {
        if (!synced[provider]?.[modelId]) diff.removed++;
      }
    }

    const syncedAt = new Date().toISOString();
    await replaceSyncedPricing(synced, { syncedAt, sources, entryCount });

    return NextResponse.json({ ok: true, syncedAt, entryCount, diff, failed, crossCheck });
  } catch (error) {
    console.error("Error syncing pricing:", error);
    return NextResponse.json({ error: "Failed to sync pricing" }, { status: 500 });
  }
}

/** GET /api/pricing/sync — last sync metadata for the settings page. */
export async function GET() {
  try {
    const { meta } = await getSyncedPricing();
    return NextResponse.json({ meta: meta || null });
  } catch (error) {
    console.error("Error reading sync meta:", error);
    return NextResponse.json({ error: "Failed to read sync meta" }, { status: 500 });
  }
}

/** DELETE /api/pricing/sync — clear synced prices (never touches user overrides). */
export async function DELETE() {
  try {
    await clearSyncedPricing();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error clearing synced pricing:", error);
    return NextResponse.json({ error: "Failed to clear synced pricing" }, { status: 500 });
  }
}
