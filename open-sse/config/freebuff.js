// Freebuff (Codebuff free tier) wire constants — single drift point.
// The free tier is NOT an official API: it is the official CLI's wire protocol,
// guarded by three anti-abuse gates. If upstream drifts (UA version, agent ids,
// marker text), this file is the only place that needs a patch.
//
// Sources (live-verified 2026-08-15 against CodebuffAI/codebuff@main):
//   - common/src/constants/free-agents.ts      → FREEBUFF_ROOT_AGENT_ID_BY_MODEL
//   - common/src/constants/freebuff-models.ts  → FREEBUFF_MODELS picker catalog
//   - trefeon/freebuff-proxy registry.go       → cross-check (base2 map identical)

// ── endpoints ───────────────────────────────────────────────────────────────
// Login runs on freebuff.com (the server builds loginUrl from the request host);
// LLM traffic runs on www.codebuff.com. freebuff.com does NOT serve /api/v1/*.
export const FREEBUFF_LOGIN_URL = "https://freebuff.com/api/auth/cli/code";
export const FREEBUFF_STATUS_URL = "https://freebuff.com/api/auth/cli/status";
export const FREEBUFF_CHAT_URL = "https://www.codebuff.com/api/v1/chat/completions";
export const FREEBUFF_SESSION_URL = "https://www.codebuff.com/api/v1/freebuff/session";
export const FREEBUFF_RUNS_URL = "https://www.codebuff.com/api/v1/agent-runs";

// Hosts the device-code loginUrl may point at before window.open. Never trust
// an upstream-supplied URL to reach the browser unvalidated (phishing surface).
export const FREEBUFF_LOGIN_HOSTS = new Set(["freebuff.com", "www.freebuff.com", "codebuff.com", "www.codebuff.com"]);

// ── anti-abuse gates ────────────────────────────────────────────────────────
// Gate 1: User-Agent. Wrong UA → 403 free_mode_cli_required (gate appeared
// 2026-08-03). The official CLI builds "ai-sdk/openai-compatible/${VERSION}"
// with a build-injected version; the live-tested proxy that passes the gate
// ships the string below. Pinned here as the single drift point.
export const FREEBUFF_USER_AGENT = "ai-sdk/openai-compatible/0.10.7/codebuff";

// Gate 2: the first system message must byte-exactly OPEN with this marker.
// Injected idempotently by the executor as its LAST body mutation before fetch
// (chatCore savers mutate the body after translation — a pre-translate check
// would be provably breakable).
export const FREEBUFF_SYSTEM_MARKER = "You are Buffy, the strategic coding assistant.";

// Gate 3: any tool-calling request lacking the CLI's end_turn tool is rejected
// with a misleading 404 "No endpoints found for {model}". Injected when the
// client sent tools.
export const FREEBUFF_END_TURN_TOOL = {
  type: "function",
  function: {
    name: "end_turn",
    description: "Signal the end of the current task.",
    parameters: { type: "object", properties: {} },
  },
};

// ── models ──────────────────────────────────────────────────────────────────
// Static catalog (Star's decree — no live refresh). Model id → root agent id,
// mirrors upstream FREEBUFF_ROOT_AGENT_ID_BY_MODEL.
export const FREEBUFF_MODEL_AGENT_IDS = {
  "deepseek/deepseek-v4-flash": "base2-free-deepseek-flash",
  "deepseek/deepseek-v4-pro": "base2-free-deepseek",
  "mimo/mimo-v2.5": "base2-free-mimo",
  "minimax/minimax-m3": "base2-free-minimax-m3",
  "openai/gpt-5.6-luna": "base2-free-luna",
};
// All-models root, used when a model has no dedicated entry.
export const FREEBUFF_FALLBACK_AGENT_ID = "base2-free";

export const FREEBUFF_DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

// ── sessions ────────────────────────────────────────────────────────────────
// One account holds ONE session locked to ONE model (~1h server TTL). We claim
// with margin so local expiry precedes upstream expiry.
export const FREEBUFF_SESSION_TTL_MS = 55 * 60 * 1000;
// Network budget for claim POST / rediscovery GET — a hung upstream must not
// hold the per-(connection|model) claim mutex and serialize all traffic.
export const FREEBUFF_SESSION_FETCH_TIMEOUT_MS = 20 * 1000;
// Agent-run START network budget (cold-claim latency lives here).
export const FREEBUFF_RUN_FETCH_TIMEOUT_MS = 20 * 1000;

// ── gate classification ─────────────────────────────────────────────────────
// Keyed on HTTP status + structured code fields ONLY — never upstream message
// text (untrusted data must not drive reclaim logic).
export const FREEBUFF_SESSION_STALE_STATUSES = new Set([409, 410, 428]);
export const FREEBUFF_RECLAIMABLE_CODES = new Set(["session_superseded", "session_expired"]);
export const FREEBUFF_MODEL_LOCKED_CODE = "model_locked";

// Egress IP-scoped codes that justify instant re-pick (C16 LOCKED)
export const FREEBUFF_REPICK_CODES = new Set(["country_blocked", "ip_capped"]);

// Instant re-pick policy for blocked claims (decree: cap + budget)
export const FREEBUFF_REPICK_MAX_ATTEMPTS = 3;
export const FREEBUFF_REPICK_BUDGET_MS = 45_000; // 45s total latency budget
export const FREEBUFF_CLAIM_BLOCKED_CODES = new Set([
  "country_blocked", "banned", "ip_capped", "rate_limited",
  "spend_limited", "model_unavailable", "premium_slot_taken",
]);

// Lockouts (src/sse/services/auth.js branches — both precede the capped
// generic resetsAtMs path, which truncates at MAX_RATE_LIMIT_COOLDOWN_MS=30min):
// a daily-quota 429 locks until the real resetAt (Pacific midnight), and a
// model_locked refusal locks for one session TTL.
export const FREEBUFF_MODEL_LOCK_MS = 65 * 60 * 1000;
export const FREEBUFF_PACIFIC_TZ = "America/Los_Angeles";

// ── providerSpecificData.freebuff state shape ──────────────────────────────
// {
//   authMethod: "freebuff_cli",
//   fingerprintId, fingerprintHash,        // per-connection — NEVER machine-global
//   session: { model, instanceId, agentId, claimedAt, expiresAt } | null,
//   quotaCache: { fetchedAt, rateLimitsByModel } | null,
//   lastClaimError: { code, at } | null,
// }
