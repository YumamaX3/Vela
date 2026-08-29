// Freebuff (Codebuff free tier) wire constants — single drift point.
// The free tier is NOT an official API: it is the official CLI's wire protocol,
// guarded by three anti-abuse gates. If upstream drifts (UA version, agent ids,
// marker text), this file is the only place that needs a patch.
//
// Sources (re-verified 2026-08-30 against trefeon/freebuff-proxy@main — the
// battle-hardened Go reference that reverse-verifies against the pinned CLI
// snapshot, plus the upstream constant files it cites):
//   - internal/upstream/client.go          → cliUserAgent / bunUserAgent (G5 UA scoping)
//   - internal/upstream/chat.go            → system markers + the five gate openings
//   - internal/upstream/ratelimit.go       → the bounded cooldown table
//   - internal/upstream/client_chat.go     → 13-char base36 client_id shape
//   - internal/upstream/session.go         → bodyless session POST (#120), GLM 1h TTL
//   - internal/modelcat/catalog.go         → served catalog + paused models
//   - internal/registry/registry.go        → model → root agent roots
//   - internal/upstream/ads.go             → waiting-room ad chain endpoints
//   - upstream common/src/constants/free-agents.ts → FREEBUFF_ROOT_AGENT_ID_BY_MODEL

// ── endpoints ───────────────────────────────────────────────────────────────
// Login runs on freebuff.com (the server builds loginUrl from the request host);
// LLM traffic runs on www.codebuff.com. freebuff.com does NOT serve /api/v1/*.
export const FREEBUFF_LOGIN_URL = "https://freebuff.com/api/auth/cli/code";
export const FREEBUFF_STATUS_URL = "https://freebuff.com/api/auth/cli/status";
export const FREEBUFF_CHAT_URL = "https://www.codebuff.com/api/v1/chat/completions";
export const FREEBUFF_SESSION_URL = "https://www.codebuff.com/api/v1/freebuff/session";
export const FREEBUFF_RUNS_URL = "https://www.codebuff.com/api/v1/agent-runs";
// Read-only account probes (zero quota cost): identity + waiting-room streak.
export const FREEBUFF_ME_URL = "https://www.codebuff.com/api/v1/me";
export const FREEBUFF_STREAK_URL = "https://www.codebuff.com/api/v1/freebuff/streak";
// Waiting-room ad chain (POST gravity/zeroclick before the next session create
// when upstream stamps waiting_room_required — reference ads.go).
export const FREEBUFF_ADS_URL = "https://www.codebuff.com/api/v1/ads";
// The ads POST carries the product UA (getCliAdRequestUserAgent), NOT the chat
// ai-sdk UA; the body userAgent is a platform-consistent browser UA (native
// runtime UAs look bot-like to ad networks).
export const FREEBUFF_CLI_ADS_UA = "Freebuff-CLI/1.0.0";
export const FREEBUFF_AD_BROWSER_UAS = {
  macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};
export const FREEBUFF_WAITING_ROOM_AD_PROVIDERS = ["gravity", "zeroclick"];

// Hosts the device-code loginUrl may point at before window.open. Never trust
// an upstream-supplied URL to reach the browser unvalidated (phishing surface).
export const FREEBUFF_LOGIN_HOSTS = new Set(["freebuff.com", "www.freebuff.com", "codebuff.com", "www.codebuff.com"]);

// ── anti-abuse gates ────────────────────────────────────────────────────────
// Gate 1: User-Agent. Wrong UA → 403 free_mode_cli_required (gate appeared
// 2026-08-03). G5 UA SCOPING (newest-CLI wire behavior): the real CLI sends
// the pinned ai-sdk UA ONLY on the chat POST — every other call (session
// claim/poll, agent-runs START/FINISH, streak) goes through plain Bun fetch,
// whose default UA is Bun/<version>. Sending the ai-sdk UA on those paths is
// itself a fingerprint deviation. Two pins, two surfaces:
export const FREEBUFF_USER_AGENT = "ai-sdk/openai-compatible/1.0.0/codebuff"; // chat ONLY
export const FREEBUFF_BUN_USER_AGENT = "Bun/1.3.14"; // everything else

// Gate 2: the first system message must byte-exactly OPEN with one of the
// canonical root identities. The free-mode gate is an ANY-OF-FIVE trimmed
// PREFIX test at position 0 (hasFreebuffRootSystemPromptOpening) — a request
// already opening with ANY canonical identity must be left untouched.
// base2 roots speak the two-sentence base2 marker; base3 roots speak base3's.
export const FREEBUFF_SYSTEM_MARKER =
  "You are Buffy, the strategic coding assistant. You are the AI agent behind the product, Freebuff, a tool where users can chat with you to code with AI for free.";
export const FREEBUFF_SYSTEM_MARKER_BASE3 = "You are Buffy, the coding agent behind Codebuff.";
export const FREEBUFF_GATE_OPENINGS = [
  "You are Buffy, the strategic coding assistant",
  "You are Buffy, the coding agent behind Codebuff.",
  "You are Buffy, the Freebuff Cloud project planner.",
  "You are Buffy, the auto-run agent behind Freebuff Desktop.",
  "You are Buffy, a strategic assistant that orchestrates complex coding tasks through specialized sub-agents.",
];

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

// The CLI's global stop sequence is the JSON-ENCODED token (agent-runtime
// constants.ts: globalStopSequence = `${JSON.stringify(endsAgentStepParam)}`),
// not the bare one. Injected as the stop sentinel when the client sent none.
export const FREEBUFF_STOP_SENTINEL = '"cb_easp"';

// ── models ──────────────────────────────────────────────────────────────────
// Static catalog (Star's decree — no live refresh), synced 2026-08-30 to the
// upstream SERVED set (modelcat.Catalog Served rows). Model id → root agent id
// (registry.go fallbackRootByModel). Paused models are upstream-recognized but
// admission-refused — never served, never burned.
export const FREEBUFF_MODEL_AGENT_IDS = {
  "openai/gpt-5.6-luna": "base2-free-luna",
  "upstage/solar-pro4": "base2-free-solar-pro4",
  "z-ai/glm-5.2": "base2-free-glm",
  "z-ai/glm-5.3-flash": "base2-free-glm-5-3-flash",
  "deepseek/deepseek-v4-flash": "base2-free-deepseek-flash",
  "mimo/mimo-v2.5": "base2-free-mimo",
};
// All-models root, used when a model has no dedicated entry.
export const FREEBUFF_FALLBACK_AGENT_ID = "base2-free";

// Paused (recognized-but-withdrawn) models → the replacement upstream's
// refusal copy recommends. Refused BEFORE any session burn (registry.go
// WithdrawnModelMessage): deepseek-v4-pro paused 2026-08-26 (cost),
// minimax-m3 paused 2026-08-20 ($213/hr).
export const FREEBUFF_PAUSED_MODELS = {
  "deepseek/deepseek-v4-pro": "openai/gpt-5.6-luna",
  "minimax/minimax-m3": "openai/gpt-5.6-luna",
};

export const FREEBUFF_DEFAULT_MODEL = "openai/gpt-5.6-luna";
// Region-universal fallback — premium-pool models only resolve on full-tier
// accounts, so any "no model" default must be mimo, never the premium lead.
export const FREEBUFF_FALLBACK_MODEL = "mimo/mimo-v2.5";

// ── sessions ────────────────────────────────────────────────────────────────
// Upstream session TTLs: GLM-5.2 sessions are exactly ONE hour
// (FREEBUFF_GLM_V52_SESSION_LENGTH_MS); everything else runs 24h. We claim
// with margin so local expiry precedes upstream expiry — this stops burning a
// claim unit every 55 minutes on the non-GLM rows (the pre-ascension wound).
export const FREEBUFF_GLM_MODELS = new Set(["z-ai/glm-5.2"]);
export const FREEBUFF_SESSION_TTL_MS = 23 * 60 * 60 * 1000;          // 23h margin on a 24h upstream TTL
export const FREEBUFF_GLM_SESSION_TTL_MS = 55 * 60 * 1000;           // 55min margin on the 1h GLM TTL
export function freebuffSessionTtlMs(model) {
  return FREEBUFF_GLM_MODELS.has(model) ? FREEBUFF_GLM_SESSION_TTL_MS : FREEBUFF_SESSION_TTL_MS;
}
// Network budget for claim POST / rediscovery GET — a hung upstream must not
// hold the per-(connection|model) claim mutex and serialize all traffic.
export const FREEBUFF_SESSION_FETCH_TIMEOUT_MS = 20 * 1000;
// Agent-run START network budget (cold-claim latency lives here).
export const FREEBUFF_RUN_FETCH_TIMEOUT_MS = 20 * 1000;
// Waiting-room ad chain budget per call (best-effort — never blocks the claim
// past this).
export const FREEBUFF_WAITING_ROOM_FETCH_TIMEOUT_MS = 8 * 1000;

// ── gate classification ─────────────────────────────────────────────────────
// Keyed on HTTP status + structured code fields ONLY — never upstream message
// text (untrusted data must not drive reclaim logic).
export const FREEBUFF_SESSION_STALE_STATUSES = new Set([409, 410, 428]);
// session_superseded moved OUT of the reclaimable set (reference ratelimit.go
// #119): another instance took over the account — auto-reacquire in-request
// risks ping-pong. Terminal: clear local state, surface 409, let the NEXT
// request re-join fresh.
export const FREEBUFF_RECLAIMABLE_CODES = new Set(["session_expired"]);
export const FREEBUFF_MODEL_LOCKED_CODE = "model_locked";
export const FREEBUFF_SUPERSEDED_CODE = "session_superseded";

// Egress IP-scoped codes that justify instant re-pick (C16 LOCKED)
export const FREEBUFF_REPICK_CODES = new Set(["country_blocked", "ip_capped"]);

// Instant re-pick policy for blocked claims (decree: cap + budget)
export const FREEBUFF_REPICK_MAX_ATTEMPTS = 3;
export const FREEBUFF_REPICK_BUDGET_MS = 45_000; // 45s total latency budget
export const FREEBUFF_CLAIM_BLOCKED_CODES = new Set([
  "country_blocked", "banned", "ip_capped", "rate_limited",
  "spend_limited", "model_unavailable", "premium_slot_taken",
]);

// ── bounded cooldown table (ratelimit.go:494–534 parity) ───────────────────
// Minutes-scale refusals that must NEVER lock an account until Pacific
// midnight: retrying sooner only amplifies the upstream's sweep signals, and
// the midnight lock was built for genuine daily caps. Each code rotates the
// account for a bounded window instead.
export const FREEBUFF_COOLDOWNS = {
  RUN_FANOUT_MS: 60_000,            // free_mode_run_fanout — concurrency, drains in seconds
  INVALID_AGENT_MODEL_MS: 60_000,   // free_mode_invalid_agent_model — config/mismatch refusal
  LOAD_SHED_MS: 90_000,             // insufficient_quota / limit_burst_rate — upstream saturation
  PEAK_HOURS_MS: 30 * 60_000,       // "peak hours" — hours-scale, end unknowable
  OPAQUE_429_MS: 60_000,            // 429 with no timestamp/period/reset — never a midnight lock
  IP_CAPPED_DEFAULT_MS: 60_000,     // ip_capped with no retryAfterMs — admission-only, not quota
  WAITING_ROOM_RETRY_MS: 30_000,    // waiting_room_queued / session_limit_reached — transient
  BAN_MS: 24 * 60 * 60_000,         // banned / account_suspended — 24h default (no resumes_at)
};
// Ceiling for any cooldown derived from upstream retry fields — 7 days.
export const FREEBUFF_MAX_COOLDOWN_MS = 7 * 24 * 60 * 60_000;
// free_mode_capacity_deferred retry-in-place budget (chat.go #105): honor the
// body's retryAfterMs with a floor, bounded attempts, never a cooldown.
export const FREEBUFF_CAPACITY_DEFERRED = { ATTEMPTS: 2, MIN_WAIT_MS: 10_000, MAX_WAIT_MS: 60_000 };

// Lockouts (src/sse/services/auth.js branches — all precede the capped generic
// resetsAtMs path, which truncates at MAX_RATE_LIMIT_COOLDOWN_MS=30min):
// a daily-quota 429 locks until the real resetAt (Pacific midnight), a
// model_locked refusal locks for one session TTL, the bounded codes rotate
// accounts for their window, and bans lock the account for 24h.
export const FREEBUFF_MODEL_LOCK_MS = 65 * 60 * 1000;
export const FREEBUFF_PACIFIC_TZ = "America/Los_Angeles";

// ── providerSpecificData.freebuff state shape ──────────────────────────────
// {
//   authMethod: "freebuff_cli",
//   fingerprintId, fingerprintHash,        // per-connection — NEVER machine-global
//   session: { model, instanceId, agentId, claimedAt, expiresAt } | null,
//   quotaCache: { fetchedAt, rateLimitsByModel } | null,
//   lastClaimError: { code, at } | null,
//   waitingRoomRequiredAt: <ISO> | undefined,   // 428 stamp → ad chain before next claim
// }
