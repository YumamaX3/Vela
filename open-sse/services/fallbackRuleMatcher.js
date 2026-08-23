/**
 * fallbackRuleMatcher — the v2 trigger-condition engine (v0.9.23)
 *
 * Consumes normalized rules from fallbackRulesRepo and decides, per event,
 * which rules fire. Trigger types (condition builder):
 *   status         — HTTP status in conditionVal CSV ("429,503")
 *   contentPolicy  — upstream refused content (400/403 + policy words)
 *   contextWindow  — input tokens exceeded (pre-call, before dispatch)
 *   timeout        — request timed out
 *   anyError       — any failure
 *
 * Matching is pure and dependency-free (no db, no log) so it unit-tests
 * cleanly and can run pre-call or post-failure in combo.js.
 */

const TRIGGER_TYPES = new Set(["status", "contentPolicy", "contextWindow", "timeout", "anyError"]);

/** Normalize a value list ("429, 503" | ["429","503"]) into a Set of trimmed strings. */
function valueSet(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  return new Set(list.map((s) => String(s).trim()).filter(Boolean));
}

/** Does a raw (pre-normalizeRule) row describe a content-policy refusal? */
function isContentPolicy(status, errorText) {
  const s = Number(status) || 0;
  if (s === 400 || s === 403) {
    const text = String(errorText || "").toLowerCase();
    return (
      text.includes("content") && (
        text.includes("policy") || text.includes("filter") ||
        text.includes("moderation") || text.includes("safety") ||
        text.includes("disallowed") || text.includes("refused")
      )
    );
  }
  return false;
}

/**
 * Does the rule fire for the given event?
 * @param {Object} rule — normalized v2 rule (triggerType/conditionOp/conditionVal)
 * @param {Object} event — { status, errorText, inputTokens, contextLimit, timedOut }
 * @returns {boolean}
 */
export function ruleMatches(rule, event) {
  if (!rule) return false;
  // isActive: 1 (or absent — legacy v1 rules have no flag) = active; 0 = disabled.
  if (rule.isActive !== undefined && rule.isActive !== 1 && rule.isActive !== true) return false;

  const type = TRIGGER_TYPES.has(rule.triggerType) ? rule.triggerType : "status";

  switch (type) {
    case "anyError":
      return Boolean(event.status || event.timedOut);

    case "status": {
      // Prefer the v2 conditionVal; fall back to legacy triggerOnStatus CSV;
      // if neither is set (bare legacy rule), default to the gateway's 429,503.
      const source = rule.conditionVal != null
        ? rule.conditionVal
        : (rule.triggerOnStatus != null && rule.triggerOnStatus !== "" ? rule.triggerOnStatus : "429,503");
      return valueSet(source).has(String(event.status ?? ""));
    }

    case "contentPolicy":
      return isContentPolicy(event.status, event.errorText);

    case "contextWindow": {
      if (!event.contextLimit) return false;
      const ratio = (event.inputTokens || 0) / event.contextLimit;
      const threshold = parseFloat(rule.conditionVal) || 1;
      // conditionOp: "gte" (default) — ratio >= threshold. "lte" — ratio <= threshold.
      return rule.conditionOp === "lte" ? ratio <= threshold : ratio >= threshold;
    }

    case "timeout":
      return Boolean(event.timedOut);

    default:
      return false;
  }
}

/**
 * Build the ordered fallback chain from all matching rules for a source.
 * Rules are already priority-sorted by the repo; lower priority runs first.
 * Accepts both v2 rules (targetModels[] chain) and v1 legacy rules
 * (single targetModel) — the chain falls back to the legacy field.
 * @param {Array} rules — normalized rules for the source (priority ASC)
 * @param {Object} event — the trigger event
 * @returns {string[]} ordered, deduped target chain
 */
export function buildFallbackChain(rules, event) {
  if (!Array.isArray(rules) || rules.length === 0) return [];
  const chain = [];
  for (const rule of rules) {
    if (ruleMatches(rule, event)) {
      const targets = Array.isArray(rule.targetModels) && rule.targetModels.length > 0
        ? rule.targetModels
        : (rule.targetModel ? [rule.targetModel] : []);
      for (const t of targets) {
        if (t && !chain.includes(t)) chain.push(t);
      }
    }
  }
  return chain;
}
