/**
 * The pre-mend live arm, frozen VERBATIM from
 * src/lib/db/repos/sqlite/usageRepo.js @ 0e2ba927 (the tree P5 opened on) —
 * the `for (const r of filtered)` row walk inside getUsageStats' 24h/today
 * arm, which the P5 SQL seams replaced.
 *
 * Provenance: the loop body below is byte-identical to HEAD lines 753-829
 * (sha256 of the extracted block: b837307eeec2952bd9c732df1e4f51f94e11656883fcd650a3f946c3ab2841f1).
 * A prior regeneration was corrupted by a scripted edit (the cached-tokens
 * fallback chain rewritten as a sum); this file was restored by hand against
 * the HEAD extraction. Do not edit it — its job is to remember exactly what
 * the mend was allowed to move.
 *
 * This file is a WITNESS, not an import: the P5 pin runs it against the same
 * seeded bank the mended repo reads and requires both answers identical
 * (pinned windows, so both walks share one cutoff). Do not edit it — its job
 * is to remember exactly what the mend was allowed to move.
 *
 * One mechanical difference from the source slice: the `const filtered =
 * db.all(...)` statement sits outside it (the caller supplies the row set,
 * parsed as the repo parses it — tokens via parseJson, cost as the stored
 * REAL via the repo's own parseJson, injected here so the file stands
 * alone). The loop body below is byte-identical to HEAD.
 */
export function frozenLiveArm({ rows: filtered, providerNodeNameMap, connectionMap, apiKeyMap, stats, parseJson = (v, f) => { if (v == null || typeof v !== "string") return v ?? f; try { return JSON.parse(v); } catch { return f; } } }) {
      for (const r of filtered) {
      const tokens = parseJson(r.tokens, {}) || {};
      const promptTokens = tokens.prompt_tokens || 0;
      const completionTokens = tokens.completion_tokens || 0;
      const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
      const entryCost = r.cost || 0;
      const providerDisplayName = providerNodeNameMap[r.provider] || r.provider || null;

      stats.totalPromptTokens += promptTokens;
      stats.totalCompletionTokens += completionTokens;
      stats.totalCachedTokens += cachedTokens;
      stats.totalCost += entryCost;

      // migration 004: '' is the normalized form of "unset" — key the display
      // map on null so live stats and artifacts agree.
      const prov = r.provider || null;
      if (!stats.byProvider[prov]) stats.byProvider[prov] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
      stats.byProvider[prov].requests++;
      stats.byProvider[prov].promptTokens += promptTokens;
      stats.byProvider[prov].completionTokens += completionTokens;
      stats.byProvider[prov].cachedTokens += cachedTokens;
      stats.byProvider[prov].cost += entryCost;

      const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model;
      if (!stats.byModel[modelKey]) {
        stats.byModel[modelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
      }
      stats.byModel[modelKey].requests++;
      stats.byModel[modelKey].promptTokens += promptTokens;
      stats.byModel[modelKey].completionTokens += completionTokens;
      stats.byModel[modelKey].cachedTokens += cachedTokens;
      stats.byModel[modelKey].cost += entryCost;
      if (new Date(r.timestamp) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = r.timestamp;

      if (r.connectionId) {
        const accountName = connectionMap[r.connectionId] || `Account ${r.connectionId.slice(0, 8)}...`;
        const accountKey = `${r.model} (${r.provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, connectionId: r.connectionId, accountName, lastUsed: r.timestamp };
        }
        stats.byAccount[accountKey].requests++;
        stats.byAccount[accountKey].promptTokens += promptTokens;
        stats.byAccount[accountKey].completionTokens += completionTokens;
        stats.byAccount[accountKey].cachedTokens += cachedTokens;
        stats.byAccount[accountKey].cost += entryCost;
        if (new Date(r.timestamp) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = r.timestamp;
      }

      if (r.keyId && typeof r.keyId === "string") {
        const keyInfo = apiKeyMap[r.keyId];
        const keyName = keyInfo?.name || `vela-v1-${r.keyId.slice(0, 8)}…`;
        const apiKeyMasked = keyInfo?.keyPrefix || r.keyPrefix || `vela-v1-${r.keyId.slice(0, 8)}…`;
        const akKey = `${r.keyId}|${r.model}|${r.provider || "unknown"}`;
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKeyMasked, keyName, apiKeyKey: r.keyId, lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey[akKey];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      } else {
        if (!stats.byApiKey["local-no-key"]) {
          stats.byApiKey["local-no-key"] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKeyMasked: null, keyName: "Local (No API Key)", apiKeyKey: "local-no-key", lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey["local-no-key"];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      }

      const endpoint = r.endpoint || "Unknown";
      const epKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byEndpoint[epKey]) {
        stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, endpoint, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
      }
      const epe = stats.byEndpoint[epKey];
      epe.requests++; epe.promptTokens += promptTokens; epe.completionTokens += completionTokens; epe.cachedTokens += cachedTokens; epe.cost += entryCost;
      if (new Date(r.timestamp) > new Date(epe.lastUsed)) epe.lastUsed = r.timestamp;
    }
  stats.totalRequests = Object.values(stats.byProvider).reduce((sum, p) => sum + (p.requests || 0), 0);
  return stats;
}
