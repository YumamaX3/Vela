// zcode-plan claim — preview the offered plans, claim the unowned ones (captcha-then-
// POST, one re-mint on code 3007), and send the two warm activation events. Every
// result is reported, never thrown from the caller's perspective, and never treated
// as an account-health signal.

import { v4 as uuidv4 } from "uuid";
import {
  ZCODE_ORIGIN,
  ZCODE_BILLING_VERSION,
  billingHeaders,
  fetchZcodeQuota,
} from "./zcodePlanQuota.js";
import { solveCaptcha } from "./zcodeCaptcha.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import * as log from "../../src/sse/utils/logger.js";

const CLAIM_TIMEOUT_MS = 30 * 1000;
const CODE_ALREADY_CLAIMED = 1003;
const CODE_CAPTCHA_REJECTED = 3007;

async function claimFetch(method, url, credentials, body, extraHeaders, proxyOptions) {
  const jwt = credentials?.accessToken;
  const deviceMid = credentials?.providerSpecificData?.deviceMid || "";
  const headers = { ...billingHeaders(jwt, deviceMid), ...(extraHeaders || {}) };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await proxyAwareFetch(
    url,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(CLAIM_TIMEOUT_MS),
    },
    proxyOptions
  );

  let json = null;
  let rawText = "";
  try {
    rawText = await res.text();
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, head: rawText.slice(0, 200) };
}

/**
 * The plans upstream offers this account, highest priority first, each flagged
 * owned. A failing balance read still yields the preview — owned just comes back
 * false for everything.
 */
export async function listOfferedPlans(credentials, proxyOptions = null) {
  const res = await claimFetch(
    "GET",
    `${ZCODE_ORIGIN}/api/v1/zcode-plan/billing/preview?app_version=${ZCODE_BILLING_VERSION}&platform=darwin-x64`,
    credentials,
    undefined,
    null,
    proxyOptions
  );
  if (res.status !== 200) throw new Error(`preview HTTP ${res.status}`);
  const json = res.json;
  if (!json || json.code !== 0) throw new Error(`preview code ${json?.code}`);

  const plans = json?.data?.plans || json?.data || [];

  let owned = new Set();
  try {
    const quota = await fetchZcodeQuota(credentials, proxyOptions);
    owned = new Set(quota?.planIds || []);
  } catch {
    // The preview still lists unowned plans even when balance is unreachable.
    owned = new Set();
  }

  return (Array.isArray(plans) ? plans : [])
    .filter((p) => p && p.plan_id !== undefined && p.plan_id !== null && p.plan_id !== "")
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .map((p) => ({
      planId: p.plan_id,
      name: p.name || p.plan_id,
      priority: p.priority || 0,
      owned: owned.has(String(p.plan_id).toLowerCase()),
    }));
}

/** Claim one plan. Codes 0/1003 are success; 3007 earns exactly one re-mint. */
export async function claimPlan(credentials, planId, proxyOptions = null) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let mint;
    try {
      mint = await solveCaptcha();
    } catch (err) {
      return { ok: false, problem: `claim ${planId}: ${err?.message ?? String(err)}` };
    }

    const extra = {};
    if (mint.param) {
      extra["X-Aliyun-Captcha-Verify-Param"] = mint.param;
      if (mint.region) extra["X-Aliyun-Captcha-Verify-Region"] = mint.region;
    }

    let res;
    try {
      res = await claimFetch(
        "POST",
        `${ZCODE_ORIGIN}/api/v1/zcode-plan/billing/claim`,
        credentials,
        { plan_id: planId },
        extra,
        proxyOptions
      );
    } catch (err) {
      return { ok: false, problem: `claim ${planId}: ${err?.message ?? String(err)}` };
    }

    if (res.status !== 200 && res.status !== 401 && res.status !== 403) {
      return { ok: false, problem: `claim ${planId} HTTP ${res.status}: ${res.head}` };
    }

    const code = res.json?.code;
    if (code === 0 || code === CODE_ALREADY_CLAIMED) {
      return { ok: true, alreadyClaimed: code === CODE_ALREADY_CLAIMED };
    }
    if (code === CODE_CAPTCHA_REJECTED) {
      if (attempt === 1) {
        log.info("ZCODE_CLAIM", "captcha rejected — one more mint", { planId });
        continue;
      }
      // Second rejection falls out of the loop — the caller gets the
      // captcha-rejected reading, not a bare code echo.
      break;
    }
    const msg = res.json?.message || res.json?.msg || "";
    return { ok: false, problem: `claim ${planId} code ${code} ${msg}`.trim() };
  }
  return { ok: false, problem: `claim ${planId}: captcha rejected twice` };
}

/** Claim every offered plan this account does not yet own. */
export async function claimAllOffered(credentials, proxyOptions = null) {
  const offers = await listOfferedPlans(credentials, proxyOptions);
  const unowned = offers.filter((o) => !o.owned);
  const skipped = offers.filter((o) => o.owned).map((o) => o.name);

  if (unowned.length === 0) {
    return { claimed: [], skipped, problems: [], alreadyOwned: true };
  }

  const results = [];
  for (const offer of unowned) {
    try {
      const r = await claimPlan(credentials, offer.planId, proxyOptions);
      results.push({ name: offer.name, ...r });
    } catch (err) {
      results.push({
        name: offer.name,
        ok: false,
        problem: `claim ${offer.planId}: ${err?.message ?? String(err)}`,
      });
    }
  }

  return {
    claimed: results.filter((r) => r.ok).map((r) => r.name),
    skipped,
    problems: results.filter((r) => !r.ok).map((r) => r.problem),
    alreadyOwned: false,
  };
}

/** Upstream warm.go BuildActivationEvent — exact 16 fields, exact strings. */
export function buildActivationEvent(element, userId, deviceMid, appVersion) {
  return {
    event_id: uuidv4(),
    client_timezone: "Europe/Bucharest",
    client_language: "en-US",
    element_name: element,
    event_region: "app",
    event_type: "view",
    event_text: "",
    event_extra_detail: {},
    user_id: userId,
    screen_resolution: "1920x1080",
    app_version: appVersion,
    device_os_category: "macos",
    device_os_version:
      "Darwin Kernel Version 21.6.0: Mon Jun 24 00:56:10 PDT 2024; root:xnu-8020.240.18.709.2~1/RELEASE_X86_64",
    device_mid: deviceMid,
    mac_id: "",
    marketing_params: "{}",
  };
}

const WARM_ELEMENTS = ["app_launch", "app_daily_active"];

export async function sendWarmEvents(credentials, proxyOptions = null) {
  const deviceMid = credentials?.providerSpecificData?.deviceMid || "";
  const userId = credentials?.providerSpecificData?.userId || "";
  const jwt = credentials?.accessToken;

  for (const element of WARM_ELEMENTS) {
    const res = await proxyAwareFetch(
      `${ZCODE_ORIGIN}/api/v1/event/report`,
      {
        method: "POST",
        headers: { ...billingHeaders(jwt, deviceMid), "Content-Type": "application/json" },
        body: JSON.stringify(
          buildActivationEvent(element, userId, deviceMid, ZCODE_BILLING_VERSION)
        ),
        signal: AbortSignal.timeout(CLAIM_TIMEOUT_MS),
      },
      proxyOptions
    );
    if (res.status >= 400) {
      return { ok: false, problem: `event ${element} HTTP ${res.status}` };
    }
  }
  return { ok: true, events: WARM_ELEMENTS.length };
}
