/**
 * Freebuff (Codebuff free tier) — www.codebuff.com
 *
 * NOT an official API: this rides the official Freebuff CLI's wire protocol.
 * Auth is a fingerprint device flow (NOT OAuth2) on freebuff.com; LLM traffic
 * runs OpenAI-compatible on www.codebuff.com behind three anti-abuse gates
 * (exact User-Agent, byte-exact "You are Buffy…" system marker, top-level
 * codebuff_metadata with cost_mode:"free"). Sessions are claimed per model and
 * locked to one model per account (~1h); quota is ~6 sessions/day per egress
 * IP, resetting at Pacific midnight. Full mechanics: open-sse/config/freebuff.js.
 *
 * ⚠️ ToS: routing Freebuff tokens through a gateway violates Freebuff/Codebuff
 * terms; accounts may be suspended. Surfaced in display.notice on purpose.
 *
 * Category is "freeTier" + authType "oauth" deliberately: the "free" category
 * with noAuth injects a virtual "noauth" connection (auth.js FREE_PROVIDERS)
 * which would bypass every session/claim mechanism this provider needs.
 */
import {
  FREEBUFF_CHAT_URL,
  FREEBUFF_SESSION_URL,
  FREEBUFF_LOGIN_URL,
  FREEBUFF_STATUS_URL,
  FREEBUFF_USER_AGENT,
  FREEBUFF_MODEL_AGENT_IDS,
} from "../../config/freebuff.js";

export default {
  id: "freebuff",
  priority: 45,
  hasFree: true,
  alias: "fb",
  aliases: ["codebuff"],
  uiAlias: "fb",
  display: {
    name: "Freebuff",
    icon: "bolt",
    color: "#84CC16",
    textIcon: "FB",
    website: "https://freebuff.com",
    notice: {
      signupUrl: "https://freebuff.com",
      text: "Free ad-supported coding agent by Codebuff. Sign in with your Freebuff/Codebuff account via browser login. Free tier is ad-supported and limited in some regions (limited mode: ~6 one-hour sessions/day); quota resets at Pacific midnight and is keyed to the egress IP. ⚠️ One account holds ONE session locked to ONE model — Vela routes same-model traffic to the warm session. ⚠️ Using Freebuff through a gateway violates Freebuff/Codebuff ToS; accounts may be suspended or banned.",
    },
  },
  category: "freeTier",
  authType: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: FREEBUFF_CHAT_URL,
    format: "openai",
    headers: {
      "User-Agent": FREEBUFF_USER_AGENT,
    },
    // Session endpoint doubles as the read-only quota API. GET returns the
    // shared daily quota; a POST would CLAIM a session and burn one unit, so
    // the usage tracker must only ever GET (enforced + tested).
    usage: {
      url: FREEBUFF_SESSION_URL,
    },
    // No blind 429 retry — daily quota resets at Pacific midnight; the
    // executor's parseError extracts resetAt and auth.js locks to it precisely.
    retry: {
      429: { attempts: 0 },
    },
  },
  models: Object.keys(FREEBUFF_MODEL_AGENT_IDS).map((id) => ({
    id,
    name: id.split("/")[1]
      .replace(/^deepseek-v4-/, "DeepSeek V4 ")
      .replace(/^mimo-/, "MiMo ")
      .replace(/^minimax-/, "MiniMax ")
      .replace(/^gpt-/, "GPT-")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
  })),
  features: {
    usage: true,
  },
  oauth: {
    // Fingerprint device flow (NOT OAuth2): request a code with a per-connection
    // fingerprintId, the user opens loginUrl in a browser, then we poll status
    // until user.authToken appears. There is NO refresh path — a dead token
    // means re-login (mapTokens returns refreshToken:null, no expiresAt).
    baseUrl: "https://freebuff.com",
    deviceCodeUrl: FREEBUFF_LOGIN_URL,
    statusUrl: FREEBUFF_STATUS_URL,
    oauthTimeoutMs: 300000,
  },
};
