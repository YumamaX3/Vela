// zcode-plan quota — the billing balance read, the entitlement fraction, and the
// per-connection cache write. Every failure here is fail-open: a quota refresh that
// cannot reach upstream is NOT an account-health signal, so it never marks a mooring.

import { v4 as uuidv4 } from "uuid";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import * as log from "../../src/sse/utils/logger.js";

export const ZCODE_ORIGIN = "https://zcode.z.ai";
export const ZCODE_BILLING_VERSION = "3.16.3";

// Billing carries the LONG kernel string; chat carries "21.6.0". Two upstreams, two
// exact values — do not unify them.
const BILLING_OS_VERSION =
  "Darwin Kernel Version 21.6.0: Mon Jun 24 00:56:10 PDT 2024; root:xnu-8020.240.18.709.2~1/RELEASE_X86_64";

/**
 * The exact header set the upstream billing call expects. x-request-id is fresh
 * per call.
 */
export function billingHeaders(jwt, deviceMid) {
  return {
    Authorization: `Bearer ${jwt}`,
    Accept: "*/*",
    "Accept-Language": "*",
    "User-Agent": `ZCode/${ZCODE_BILLING_VERSION}`,
    "HTTP-Referer": ZCODE_ORIGIN,
    "X-Title": "Z Code@electron",
    "X-ZCode-App-Version": ZCODE_BILLING_VERSION,
    "X-Os-Category": "macos",
    "X-Os-Version": BILLING_OS_VERSION,
    "X-Platform": "darwin-x64",
    "X-Release-Channel": "production",
    "X-Client-Language": "en-US",
    "X-Client-Timezone": "Europe/Bucharest",
    "X-Device-Mid": deviceMid || "",
    "x-request-id": uuidv4(),
    "sec-fetch-mode": "cors",
  };
}

/** Lowercase, strip every non [a-z0-9] — the upstream's own name comparison key. */
export function normModelId(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchingEntitlements(ents, model) {
  const list = Array.isArray(ents) ? ents : [];
  const want = normModelId(model);
  if (!want) return list;
  return list.filter((e) => normModelId(e?.name) === want);
}

/** Fraction of entitlement remaining (0..1), upstream semantics. */
export function fracFromEntitlements(ents, model) {
  const matches = matchingEntitlements(ents, model);
  if (matches.length === 0) return { frac: 0, ok: false };
  for (const e of matches) {
    const periodEnd = Number(e?.period_end) || 0;
    if (periodEnd > 0 && periodEnd <= nowSec()) return { frac: 0, ok: true };
    const limit = Number(e?.limit) || 0;
    const remaining = Number(e?.remaining) || 0;
    if (limit > 0) return { frac: remaining / limit, ok: true };
    return { frac: remaining > 0 ? 1 : 0, ok: true };
  }
  return { frac: 0, ok: false };
}

/** period_end of the matching entitlement (0 when absent or unmatched). */
export function periodEndFromEntitlements(ents, model) {
  const matches = matchingEntitlements(ents, model);
  if (matches.length === 0) return 0;
  return Number(matches[0]?.period_end) || 0;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/** Seconds-or-ms epoch → ISO string, null when absent. */
function unixDate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Port of the upstream quotaFromBalance: plan name, plan ids, expiry, entitlements. */
export function quotaFromBalance(data) {
  if (!data) return { planName: "Free", planIds: [], expiresAt: null, entitlements: [] };
  const plans = Array.isArray(data.plans) ? data.plans : [];
  const first = plans[0] || null;
  const balances = Array.isArray(data.balances) ? data.balances : [];
  const planIds = [
    ...new Set(
      plans
        .map((p) => String(p?.plan_id ?? "").trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  return {
    planName: first?.name || "Free",
    planIds,
    expiresAt: unixDate(first?.ends_at || first?.expires_at),
    entitlements: balances,
  };
}

/** GET the live billing balance. Throws on transport/auth/shape failure. */
export async function fetchZcodeQuota(credentials, proxyOptions = null) {
  const jwt = credentials?.accessToken;
  if (!jwt) throw new Error("zcode-plan: missing access token");
  const deviceMid = credentials?.providerSpecificData?.deviceMid || "";

  const url = `${ZCODE_ORIGIN}/api/v1/zcode-plan/billing/balance?app_version=${ZCODE_BILLING_VERSION}`;
  const res = await proxyAwareFetch(
    url,
    { method: "GET", headers: billingHeaders(jwt, deviceMid) },
    proxyOptions
  );
  if (res.status !== 200) throw new Error(`billing HTTP ${res.status}`);
  let wrap;
  try {
    wrap = await res.json();
  } catch (err) {
    throw new Error(`billing body unreadable: ${err?.message ?? String(err)}`);
  }
  if (wrap?.code !== 0) throw new Error(`billing code ${wrap?.code}`);
  return quotaFromBalance(wrap.data);
}

/**
 * Refresh one connection's cached quota. Full connection row expected (needs id).
 * On failure the error is recorded beside the cache and null returned — fail-open.
 */
export async function refreshZcodeQuotaForConnection(connection, proxyOptions = null) {
  try {
    const quota = await fetchZcodeQuota(connection, proxyOptions);
    const base = connection.providerSpecificData || {};
    const { zcodeQuotaError: _ignored, ...rest } = base;
    const { updateProviderConnection } = await import("@/lib/localDb");
    await updateProviderConnection(connection.id, {
      providerSpecificData: {
        ...rest,
        zcodeQuota: { ...quota, fetchedAt: new Date().toISOString() },
      },
      testStatus: "active",
      lastError: null,
      errorCode: null,
      rateLimitedUntil: null,
    });
    log.info("ZCODE_QUOTA", "the balance is read — the plan holds", {
      id: connection.id,
      planName: quota.planName,
      expiresAt: quota.expiresAt,
    });
    return quota;
  } catch (err) {
    const message = err?.message ?? String(err);
    log.warn("ZCODE_QUOTA", "the balance call stumbled — swallowed, the cache stands", {
      id: connection?.id,
      provider: connection?.provider,
      error: message,
    });
    try {
      const base = connection?.providerSpecificData || {};
      const { updateProviderConnection } = await import("@/lib/localDb");
      await updateProviderConnection(connection.id, {
        providerSpecificData: {
          ...base,
          zcodeQuotaError: { at: new Date().toISOString(), message },
        },
      });
    } catch {
      // A failure to record the failure is still no reason to break the sweep.
    }
    return null;
  }
}

/**
 * When the model's entitlement is spent, the epoch-ms at which it returns:
 * period_end when known, else one hour from now. Null when it is not spent.
 */
export function quotaResetAtMs(quota, model) {
  const ents = quota?.entitlements || [];
  const { frac, ok } = fracFromEntitlements(ents, model);
  if (!ok || frac > 0) return null;
  const pe = periodEndFromEntitlements(ents, model);
  return pe > 0 ? pe * 1000 : Date.now() + 3600_000;
}
