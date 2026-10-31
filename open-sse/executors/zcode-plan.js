import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { resolveZcodeProfile } from "../services/zcodeProfile.js";
import { hasZcodeIdentity, zcodeIdentityBlocks, zcodeIdentityText } from "../services/zcodeSystemIdentity.js";

const ZCODE_ORIGIN = "https://zcode.z.ai";
const ZCODE_MESSAGES_PATH = "/api/v1/zcode-plan/anthropic/v1/messages";
const ZCODE_CLIENT_VERSION = "3.16.3";
const ZCODE_UA_SUFFIX = " ai-sdk/provider-utils/4.0.27 runtime/node.js/24";
const ZCODE_BETA_DEFAULT = "mid-conversation-system-2026-04-07";
const ZCODE_MAX_TOKENS = 131072;
const ZCODE_SESSION_NS = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

// Load-family verdicts: the origin answers with a business code inside a
// transient status while its lanes are saturated — re-dial after 1s.
const ZCODE_LOAD_CODES = new Set([3007, 3009, 3010, 3012]);
const ZCODE_LOAD_STATUSES = new Set([405, 429, 503]);
const ZCODE_QUOTA_429_CODES = new Set([1113, 1308, 1309, 1310, 1311, 1313, 1316, 1317, 1318, 1319, 1320, 1321]);
// G1 — 3010 is the admission-limit verdict on a 429: not a quota (the account
// is fine), not a load lane either. It gets its own short cadence below.
const ZCODE_ADMISSION_LIMIT_CODE = 3010;
const ZCODE_ADMISSION_LIMIT_DELAYS = [1000, 2000];
const ZCODE_QUOTA_429_CODE_DELAYS = [1000, 2000, 4000, 8000, 16000];
const ZCODE_FAILOVER_STATUSES = [429, 529, 405, 502, 503];

// The base tryRetry only schedules a status that HAS a retry entry, so the
// ladder for statuses the default table omits (405, 429, 529) is declared
// here; computeRetryDelay vetoes via `false` when no attempt remains.
// G7 — 5xx upstreams are not worth five re-dials: 500 gets two at 1000ms, and
// 502/503 are trimmed from five to two so a broken origin fails over sooner.
const ZCODE_RETRY = {
  429: { attempts: 5, delayMs: 1000 },
  405: { attempts: 5, delayMs: 1000 },
  529: { attempts: 5, delayMs: 1000 },
  503: { attempts: 2, delayMs: 1000 },
  502: { attempts: 2, delayMs: 1000 },
  500: { attempts: 2, delayMs: 1000 }
};
const ZCODE_MAX_ATTEMPTS = 5;

function extractCode(bodyHead) {
  if (typeof bodyHead !== "string" || !bodyHead) return null;
  const match = bodyHead.match(/"code"\s*:\s*\??"?(\d{3,4})"?/);
  return match ? Number(match[1]) : null;
}

export function isZcodeLoadVerdict(status, bodyHead) {
  if (status === 529) return true;
  if (ZCODE_LOAD_STATUSES.has(status) && ZCODE_LOAD_CODES.has(extractCode(bodyHead))) return true;
  return false;
}

export function isQuotaFamily429(status, bodyHead) {
  return status === 429 && ZCODE_QUOTA_429_CODES.has(extractCode(bodyHead));
}

// G1 — 429 + code 3010: the admission limit. Deliberately NOT in
// ZCODE_QUOTA_429_CODES — quota vetoes fail over at once, admission gets two
// short re-dials first.
export function isZcodeAdmissionLimit(status, bodyHead) {
  return status === 429 && extractCode(bodyHead) === ZCODE_ADMISSION_LIMIT_CODE;
}

// The four identity slots read from the resolved profile (G9). Shared by
// buildHeaders and the test's bare-credentials pin.
function zcodeProfileHeaders(credentials) {
  const profile = resolveZcodeProfile(credentials?.providerSpecificData);
  return {
    platform: profile.platform,
    osVersion: profile.osVersion,
    language: profile.language,
    timezone: profile.timezone
  };
}

function inboundBeta(credentials) {
  const raw = credentials?.rawHeaders;
  if (!raw) return "";
  let value = "";
  if (typeof raw.get === "function") value = raw.get("anthropic-beta");
  if (!value) {
    for (const key of Object.keys(raw)) {
      if (key.toLowerCase() === "anthropic-beta") { value = raw[key]; break; }
    }
  }
  return Array.isArray(value) ? value.join(", ") : String(value || "").trim();
}

async function bodyHeadOf(response, limit = 512) {
  try {
    if (typeof response?.clone !== "function") return "";
    const text = await response.clone().text();
    return typeof text === "string" ? text.slice(0, limit) : "";
  } catch {
    return "";
  }
}

// G8 — prepend the three official-client identity blocks ahead of existing
// system content. Injected copies never carry cache_control; existing entries
// keep theirs untouched. Idempotent via the preamble sentinel. Never fatal: on
// any error the caller's clone stands as it was (already un-prepended).
function withZcodeIdentity(clone) {
  try {
    const system = clone.system;
    if (hasZcodeIdentity(system)) return;
    if (typeof system === "string") {
      const text = zcodeIdentityText();
      if (!text) return;
      clone.system = `${text}\n\n${system}`;
      return;
    }
    if (Array.isArray(system)) {
      const injected = zcodeIdentityBlocks().map((block) => ({ type: "text", text: block.text }));
      if (!injected.length) return;
      clone.system = [...injected, ...system];
    }
    // No system at all: the caller has nothing structured for the identity to
    // precede, and inventing a system array is not this transform's place.
  } catch {
    // Fail-open: the body ships exactly as it arrived.
  }
}

// G14 — the client stamps a JSON meta blob in metadata.user_id. An inbound
// user_id is the caller's and is left alone. The session derivation mirrors
// x-session-id in buildHeaders exactly.
function withZcodeUserId(clone, credentials) {
  try {
    if (clone.metadata?.user_id) return;
    const deviceMid = credentials?.providerSpecificData?.deviceMid || "";
    const sessionUuid = uuidv5(deviceMid || "anonymous", ZCODE_SESSION_NS);
    clone.metadata = {
      ...(clone.metadata && typeof clone.metadata === "object" ? clone.metadata : {}),
      user_id: JSON.stringify({ device_id: deviceMid, account_uuid: "", session_id: sessionUuid })
    };
  } catch {
    // Fail-open: a metadata stamp is never worth failing a request.
  }
}

export class ZcodePlanExecutor extends BaseExecutor {
  constructor(provider = "zcode-plan") {
    super(provider, { ...(PROVIDERS[provider] || PROVIDERS.glm), retry: ZCODE_RETRY });
  }

  buildUrl() {
    return ZCODE_ORIGIN + ZCODE_MESSAGES_PATH;
  }

  buildHeaders(credentials, stream = true) {
    const deviceMid = credentials?.providerSpecificData?.deviceMid || "";
    const jwt = credentials?.accessToken || credentials?.apiKey || "";
    const profile = zcodeProfileHeaders(credentials);
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${jwt}`,
      "x-api-key": jwt,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": inboundBeta(credentials) || ZCODE_BETA_DEFAULT,
      "HTTP-Referer": "https://zcode.z.ai",
      "User-Agent": `ZCode/${ZCODE_CLIENT_VERSION}${ZCODE_UA_SUFFIX}`,
      "X-ZCode-App-Version": ZCODE_CLIENT_VERSION,
      "X-Title": "Z Code@electron",
      "X-ZCode-Agent": "glm",
      "X-Platform": profile.platform,
      "X-Release-Channel": "production",
      "X-Client-Language": profile.language,
      "X-Client-Timezone": profile.timezone,
      "X-Os-Category": "macos",
      "X-Os-Version": profile.osVersion,
      "x-query-id": uuidv4(),
      "x-session-id": uuidv5(deviceMid || "anonymous", ZCODE_SESSION_NS),
      "x-request-id": uuidv4(),
      "x-zcode-query-source": "main_turn",
      "x-zcode-session-type": "main",
      "x-zcode-trace-id": uuidv4()
    };
    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const clone = body && typeof body === "object" ? { ...body } : body;
    if (clone && Number.isFinite(body?.max_tokens) && body.max_tokens > ZCODE_MAX_TOKENS) {
      clone.max_tokens = ZCODE_MAX_TOKENS;
    }
    if (!clone || typeof clone !== "object") return clone;
    // G8 runs after the clamp so the body it reads is the body that ships.
    withZcodeIdentity(clone);
    withZcodeUserId(clone, credentials);
    return clone;
  }

  parseError(response, bodyText) {
    const base = super.parseError(response, bodyText);
    try {
      const parsed = JSON.parse(bodyText);
      const code = parsed?.code;
      if (typeof code === "number" || (typeof code === "string" && code !== "")) {
        return { ...base, code };
      }
    } catch {
      // Body not JSON — the base reading stands.
    }
    return base;
  }

  static isZcodeLoadVerdict(status, bodyHead) {
    return isZcodeLoadVerdict(status, bodyHead);
  }

  static isQuotaFamily429(status, bodyHead) {
    return isQuotaFamily429(status, bodyHead);
  }

  static isZcodeAdmissionLimit(status, bodyHead) {
    return isZcodeAdmissionLimit(status, bodyHead);
  }

  async computeRetryDelay(response, attempt, delayMs) {
    const status = response?.status;
    const exhausted = attempt > ZCODE_MAX_ATTEMPTS;
    const bodyHead = await bodyHeadOf(response, 512);

    if (isQuotaFamily429(status, bodyHead)) return false;

    // G1 — admission limit: two short re-dials, then veto so the chain fails over.
    if (isZcodeAdmissionLimit(status, bodyHead)) {
      return attempt <= ZCODE_ADMISSION_LIMIT_DELAYS.length ? ZCODE_ADMISSION_LIMIT_DELAYS[attempt - 1] : false;
    }

    if (status === 429) {
      if (exhausted) return false;
      const retryAfterRaw = response?.headers?.get?.("retry-after");
      const retryAfter = Number(retryAfterRaw);
      if (retryAfterRaw != null && retryAfterRaw !== "" && Number.isFinite(retryAfter) && retryAfter >= 0) {
        return Math.min(retryAfter * 1000, 120000);
      }
      return ZCODE_QUOTA_429_CODE_DELAYS[Math.min(attempt, ZCODE_QUOTA_429_CODE_DELAYS.length) - 1];
    }

    if (status === 529 || status === 405 || status === 503 || status === 502) {
      return exhausted ? false : 1000;
    }

    // G7 — 500 is scheduled by the retry entry floor (attempts: 2). computeRetryDelay
    // runs BEFORE that floor, so it must veto at the same ceiling itself.
    if (status === 500) {
      return attempt > (this.config?.retry?.[500]?.attempts ?? 2) ? false : 1000;
    }

    return null;
  }

  shouldRetry(status, urlIndex) {
    return ZCODE_FAILOVER_STATUSES.includes(status);
  }
}

export default ZcodePlanExecutor;
