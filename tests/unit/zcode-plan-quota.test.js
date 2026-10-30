// M5 — zcode-plan quota. The pure helpers (norm / fraction / reset), the billing
// header set, the live balance read over a mocked proxyAwareFetch, and the
// per-connection cache write through a mocked "@/lib/localDb" (the exact dynamic
// import specifier the service uses).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ updateProviderConnection: vi.fn() }));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { updateProviderConnection } from "@/lib/localDb";
import {
  normModelId,
  fracFromEntitlements,
  periodEndFromEntitlements,
  quotaFromBalance,
  billingHeaders,
  fetchZcodeQuota,
  refreshZcodeQuotaForConnection,
  quotaResetAtMs,
} from "../../open-sse/services/zcodePlanQuota.js";

const UA = "ZCode/3.16.3";
const KERNEL =
  "Darwin Kernel Version 21.6.0: Mon Jun 24 00:56:10 PDT 2024; root:xnu-8020.240.18.709.2~1/RELEASE_X86_64";

const DEVICE_MID = "device-mid-abc";
const JWT = "jwt-token-xyz";

function credentials(overrides = {}) {
  return {
    id: "conn-1",
    provider: "zcode-plan",
    accessToken: JWT,
    providerSpecificData: { deviceMid: DEVICE_MID },
    ...overrides,
  };
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// A fetch-like response for the quota service (status + async json()).
function res(status, json) {
  return { status, json: async () => json };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normModelId", () => {
  it("lowercases and strips every non [a-z0-9]", () => {
    expect(normModelId("GLM-5.3")).toBe("glm53");
    expect(normModelId(" glm 5.3 ")).toBe("glm53");
    expect(normModelId("Z.AI/GLM_5.3")).toBe("zaiglm53");
  });

  it("handles null / undefined / empty", () => {
    expect(normModelId(null)).toBe("");
    expect(normModelId(undefined)).toBe("");
    expect(normModelId("")).toBe("");
  });
});

describe("fracFromEntitlements", () => {
  const ents = [
    { name: "GLM-5.3", limit: 100, remaining: 25, period_end: nowSec() + 3600 },
    { name: "GLM-4.6", limit: 50, remaining: 50 },
  ];

  it("0.25 for 25/100 on glm-5.3 matched to name 'GLM-5.3'", () => {
    expect(fracFromEntitlements(ents, "glm-5.3")).toEqual({ frac: 0.25, ok: true });
  });

  it("0 for zero remaining", () => {
    const zeroed = [{ name: "glm-5.3", limit: 100, remaining: 0 }];
    expect(fracFromEntitlements(zeroed, "glm-5.3")).toEqual({ frac: 0, ok: true });
  });

  it("0 (but ok) for an expired period_end", () => {
    const expired = [{ name: "glm-5.3", limit: 100, remaining: 80, period_end: nowSec() - 60 }];
    expect(fracFromEntitlements(expired, "glm-5.3")).toEqual({ frac: 0, ok: true });
  });

  it("ok:false when no entitlement matches the model", () => {
    expect(fracFromEntitlements(ents, "glm-9.9")).toEqual({ frac: 0, ok: false });
  });

  it("ok:false on a non-array", () => {
    expect(fracFromEntitlements(null, "glm-5.3")).toEqual({ frac: 0, ok: false });
  });

  it("model \"\" matches the first entitlement", () => {
    expect(fracFromEntitlements(ents, "")).toEqual({ frac: 0.25, ok: true });
  });

  it("a limit of 0 falls back to remaining > 0 → 1, else 0", () => {
    expect(fracFromEntitlements([{ name: "m", limit: 0, remaining: 7 }], "m")).toEqual({ frac: 1, ok: true });
    expect(fracFromEntitlements([{ name: "m", limit: 0, remaining: 0 }], "m")).toEqual({ frac: 0, ok: true });
  });
});

describe("periodEndFromEntitlements", () => {
  it("returns the matching period_end", () => {
    const ents = [
      { name: "GLM-4.6", period_end: 100 },
      { name: "glm-5.3", period_end: 200 },
    ];
    expect(periodEndFromEntitlements(ents, "glm-5.3")).toBe(200);
  });

  it("0 when unmatched or absent", () => {
    expect(periodEndFromEntitlements([{ name: "x" }], "y")).toBe(0);
    expect(periodEndFromEntitlements([{ name: "x", period_end: 5 }], "x")).toBe(5);
    expect(periodEndFromEntitlements(null, "x")).toBe(0);
  });
});

describe("quotaFromBalance", () => {
  it("extracts planName, lowercase-deduped planIds, ISO expiry and entitlements", () => {
    const data = {
      plans: [
        { plan_id: "GLM-Pro", name: "GLM Pro", expires_at: 1893456000 },
        { plan_id: "glm-pro", name: "GLM Pro" },
        { plan_id: "Start", name: "" },
        { plan_id: "", name: "blank skipped" },
      ],
      balances: [{ name: "GLM-5.3", limit: 100, remaining: 25 }],
    };
    const q = quotaFromBalance(data);
    expect(q.planName).toBe("GLM Pro");
    expect(q.planIds).toEqual(["glm-pro", "start"]);
    expect(q.expiresAt).toBe(new Date(1893456000 * 1000).toISOString());
    expect(q.entitlements).toEqual(data.balances);
  });

  it("accepts a millisecond expiry", () => {
    const ms = 1893456000000;
    const q = quotaFromBalance({ plans: [{ plan_id: "p", name: "P", ends_at: ms }] });
    expect(q.expiresAt).toBe(new Date(ms).toISOString());
  });

  it("null data → Free with empty collections", () => {
    expect(quotaFromBalance(null)).toEqual({ planName: "Free", planIds: [], expiresAt: null, entitlements: [] });
  });

  it("no plans → Free, no expiry", () => {
    const q = quotaFromBalance({ balances: [] });
    expect(q.planName).toBe("Free");
    expect(q.planIds).toEqual([]);
    expect(q.expiresAt).toBe(null);
  });
});

describe("quotaResetAtMs", () => {
  it("spent with no period_end → about one hour from now", () => {
    const quota = { entitlements: [{ name: "glm-5.3", limit: 100, remaining: 0 }] };
    const before = Date.now();
    const at = quotaResetAtMs(quota, "glm-5.3");
    expect(at).toBeGreaterThanOrEqual(before + 3600000);
    expect(at).toBeLessThanOrEqual(Date.now() + 3600000);
  });

  it("spent with a period_end → period_end * 1000", () => {
    const pe = nowSec() + 86400;
    const quota = { entitlements: [{ name: "glm-5.3", limit: 100, remaining: 0, period_end: pe }] };
    expect(quotaResetAtMs(quota, "glm-5.3")).toBe(pe * 1000);
  });

  it("unspent → null", () => {
    const quota = { entitlements: [{ name: "glm-5.3", limit: 100, remaining: 40 }] };
    expect(quotaResetAtMs(quota, "glm-5.3")).toBe(null);
  });

  it("no match (ok:false) → null", () => {
    expect(quotaResetAtMs({ entitlements: [] }, "glm-5.3")).toBe(null);
    expect(quotaResetAtMs(null, "glm-5.3")).toBe(null);
  });
});

describe("billingHeaders", () => {
  it("carries exactly 16 headers", () => {
    const h = billingHeaders(JWT, DEVICE_MID);
    expect(Object.keys(h)).toHaveLength(16);
  });

  it("passes X-Device-Mid straight through and carries the Bearer", () => {
    const h = billingHeaders(JWT, DEVICE_MID);
    expect(h["X-Device-Mid"]).toBe(DEVICE_MID);
    expect(h.Authorization).toBe(`Bearer ${JWT}`);
  });

  it("empty device mid still keys the header to ''", () => {
    expect(billingHeaders(JWT, undefined)["X-Device-Mid"]).toBe("");
  });

  it("carries the exact billing User-Agent", () => {
    expect(billingHeaders(JWT, DEVICE_MID)["User-Agent"]).toBe(UA);
  });

  it("carries the LONG Darwin kernel string on X-Os-Version", () => {
    expect(billingHeaders(JWT, DEVICE_MID)["X-Os-Version"]).toBe(KERNEL);
  });

  it("mints a fresh x-request-id per call", () => {
    const a = billingHeaders(JWT, DEVICE_MID);
    const b = billingHeaders(JWT, DEVICE_MID);
    expect(a["x-request-id"]).toBeTruthy();
    expect(a["x-request-id"]).not.toBe(b["x-request-id"]);
  });
});

describe("fetchZcodeQuota", () => {
  it("200 {code:0,data} → quotaFromBalance(data)", async () => {
    const data = {
      plans: [{ plan_id: "start", name: "Start", expires_at: 1893456000 }],
      balances: [{ name: "glm-5.3", limit: 10, remaining: 3 }],
    };
    proxyAwareFetch.mockResolvedValueOnce(res(200, { code: 0, data }));

    const q = await fetchZcodeQuota(credentials());
    expect(q).toEqual(quotaFromBalance(data));
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);

    const [url, init, proxyOptions] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=3.16.3");
    expect(init.method).toBe("GET");
    expect(init.headers["X-Device-Mid"]).toBe(DEVICE_MID);
    expect(init.headers.Authorization).toBe(`Bearer ${JWT}`);
    expect(proxyOptions).toBe(null);
  });

  it("passes proxyOptions through", async () => {
    proxyAwareFetch.mockResolvedValueOnce(res(200, { code: 0, data: null }));
    const proxy = { url: "http://proxy" };
    await fetchZcodeQuota(credentials(), proxy);
    expect(proxyAwareFetch.mock.calls[0][2]).toBe(proxy);
  });

  it("502 → throws 'billing HTTP 502'", async () => {
    proxyAwareFetch.mockResolvedValueOnce(res(502, {}));
    await expect(fetchZcodeQuota(credentials())).rejects.toThrow("billing HTTP 502");
  });

  it("{code:1005} → throws 'billing code 1005'", async () => {
    proxyAwareFetch.mockResolvedValueOnce(res(200, { code: 1005, msg: "denied" }));
    await expect(fetchZcodeQuota(credentials())).rejects.toThrow("billing code 1005");
  });

  it("an unreadable body → throws 'billing body unreadable'", async () => {
    proxyAwareFetch.mockResolvedValueOnce({
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(fetchZcodeQuota(credentials())).rejects.toThrow("billing body unreadable: not json");
  });

  it("missing access token → throws before any fetch", async () => {
    await expect(fetchZcodeQuota({ providerSpecificData: {} })).rejects.toThrow("missing access token");
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
});

describe("refreshZcodeQuotaForConnection", () => {
  it("success writes zcodeQuota with fetchedAt, clears lastError and returns the quota", async () => {
    const data = { plans: [{ plan_id: "start", name: "Start" }], balances: [{ name: "glm-5.3", limit: 1, remaining: 1 }] };
    proxyAwareFetch.mockResolvedValueOnce(res(200, { code: 0, data }));
    updateProviderConnection.mockResolvedValueOnce({});

    const conn = credentials({ providerSpecificData: { deviceMid: DEVICE_MID, zcodeQuotaError: { at: "x", message: "old" } } });
    const q = await refreshZcodeQuotaForConnection(conn);

    expect(q).toEqual(quotaFromBalance(data));
    expect(updateProviderConnection).toHaveBeenCalledTimes(1);

    const [id, patch] = updateProviderConnection.mock.calls[0];
    expect(id).toBe("conn-1");
    expect(patch.providerSpecificData.deviceMid).toBe(DEVICE_MID);
    expect(patch.providerSpecificData.zcodeQuota.planName).toBe("Start");
    expect(typeof patch.providerSpecificData.zcodeQuota.fetchedAt).toBe("string");
    expect(Number.isNaN(Date.parse(patch.providerSpecificData.zcodeQuota.fetchedAt))).toBe(false);
    // the stale error is dropped on success
    expect(patch.providerSpecificData).not.toHaveProperty("zcodeQuotaError");
    expect(patch.testStatus).toBe("active");
    expect(patch.lastError).toBe(null);
    expect(patch.errorCode).toBe(null);
    expect(patch.rateLimitedUntil).toBe(null);
  });

  it("failure writes zcodeQuotaError and returns null — fail-open", async () => {
    proxyAwareFetch.mockResolvedValueOnce(res(502, {}));
    updateProviderConnection.mockResolvedValueOnce({});

    const out = await refreshZcodeQuotaForConnection(credentials({ id: "conn-1" }));
    expect(out).toBe(null);
    expect(updateProviderConnection).toHaveBeenCalledTimes(1);

    const [id, patch] = updateProviderConnection.mock.calls[0];
    expect(id).toBe("conn-1");
    expect(patch.providerSpecificData.zcodeQuotaError.message).toBe("billing HTTP 502");
    expect(typeof patch.providerSpecificData.zcodeQuotaError.at).toBe("string");
    expect(patch.providerSpecificData.deviceMid).toBe(DEVICE_MID);
    // the failure records ONLY the error — it never marks the connection unhealthy
    expect(patch).not.toHaveProperty("testStatus");
    expect(patch).not.toHaveProperty("lastError");
  });

  it("a failing write of the failure still returns null", async () => {
    proxyAwareFetch.mockResolvedValueOnce(res(502, {}));
    updateProviderConnection.mockRejectedValueOnce(new Error("db down"));

    await expect(refreshZcodeQuotaForConnection(credentials({ id: "conn-1" }))).resolves.toBe(null);
  });
});
