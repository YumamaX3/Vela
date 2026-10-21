// COMPRESSION ANALYTICS — MySQL/MariaDB twin.
// Same contract as the sqlite harbor; only the adapter import differs.
import { getMysqlAdapter } from "../../mysql/adapter.js";

function parseJson(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

function hourBucket(timestamp) {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toISOString().slice(0, 13)}:00`;
}

export async function getCompressionAnalyticsSummary({ sinceIso = null, period = "24h" } = {}) {
  const db = await getMysqlAdapter();
  const rows = sinceIso
    ? await db.all(
      `SELECT timestamp, provider, model, promptTokens, completionTokens, tokens, meta, latencyMs
       FROM usageHistory WHERE timestamp >= ?`,
      [sinceIso]
    )
    : await db.all(
      `SELECT timestamp, provider, model, promptTokens, completionTokens, tokens, meta, latencyMs
       FROM usageHistory`
    );

  const byMode = {};
  const byProvider = {};
  const byModel = {};
  const trendMap = new Map();
  const realUsage = {
    requestsWithReceipts: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, estimatedUsdSaved: 0, bySource: {},
  };

  let totalRequests = 0;
  let totalTokensSaved = 0;
  let durationSum = 0;
  let durationCount = 0;

  for (const row of rows) {
    const tokens = parseJson(row.tokens, {});
    const meta = parseJson(row.meta, {});
    const prompt = Number(row.promptTokens) || 0;
    const completion = Number(row.completionTokens) || 0;

    if (prompt > 0 || completion > 0) {
      realUsage.requestsWithReceipts++;
      realUsage.promptTokens += prompt;
      realUsage.completionTokens += completion;
      realUsage.totalTokens += prompt + completion;
      realUsage.cacheReadTokens += Number(tokens.cached_tokens || tokens.cache_read_input_tokens || 0);
      realUsage.cacheWriteTokens += Number(tokens.cache_creation_input_tokens || tokens.cache_write_tokens || 0);
    }

    const rtk = meta?.rtk;
    if (!rtk) continue;
    const tokensSaved = Number(rtk.tokensSavedEst) > 0
      ? Number(rtk.tokensSavedEst)
      : Math.floor(Number(rtk.bytesSaved || 0) / 4);
    if (tokensSaved <= 0) continue;

    totalRequests++;
    totalTokensSaved += tokensSaved;
    realUsage.estimatedUsdSaved += Number(meta.rtkSavedCostUsd) || 0;
    if (Number(row.latencyMs) > 0) { durationSum += Number(row.latencyMs); durationCount++; }

    byMode.rtk = byMode.rtk || { count: 0, tokensSaved: 0, avgSavingsPct: 0 };
    byMode.rtk.count++;
    byMode.rtk.tokensSaved += tokensSaved;
    byMode.rtk.avgSavingsPct += prompt > 0 ? (tokensSaved / (prompt + tokensSaved)) * 100 : 0;

    const provider = row.provider || "";
    byProvider[provider] = byProvider[provider] || { count: 0, tokensSaved: 0 };
    byProvider[provider].count++;
    byProvider[provider].tokensSaved += tokensSaved;

    const model = row.model || "";
    byModel[model] = byModel[model] || { count: 0, tokensSaved: 0, avgSavingsPct: 0 };
    byModel[model].count++;
    byModel[model].tokensSaved += tokensSaved;
    byModel[model].avgSavingsPct += prompt > 0 ? (tokensSaved / (prompt + tokensSaved)) * 100 : 0;

    const hour = hourBucket(row.timestamp);
    if (hour) {
      const bucket = trendMap.get(hour) || { hour, count: 0, tokensSaved: 0 };
      bucket.count++;
      bucket.tokensSaved += tokensSaved;
      trendMap.set(hour, bucket);
    }
  }

  realUsage.bySource = totalTokensSaved > 0 ? { rtk: totalTokensSaved } : {};
  for (const group of [byMode, byModel]) {
    for (const value of Object.values(group)) {
      value.avgSavingsPct = value.count > 0 ? value.avgSavingsPct / value.count : 0;
    }
  }

  return {
    period,
    totalRequests,
    totalTokensSaved,
    avgSavingsPct: totalRequests > 0 && realUsage.promptTokens > 0
      ? (totalTokensSaved / (realUsage.promptTokens + totalTokensSaved)) * 100
      : 0,
    avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
    byMode,
    byProvider,
    byModel,
    trend: [...trendMap.values()].sort((a, b) => a.hour.localeCompare(b.hour)),
    realUsage,
  };
}
