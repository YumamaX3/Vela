// M5 — zcode-plan claim. Preview listing and ownership join, the captcha-then-POST
// claim with its single re-mint on 3007, the exact 16-field activation event, and
// the two warm event POSTs. proxyAwareFetch, fetchZcodeQuota and solveCaptcha are
// all mocked at the specifiers the service imports.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
vi.mock("../../open-sse/services/zcodeCaptcha.js", () => ({ solveCaptcha: vi.fn() }));
vi.mock("../../open-sse/services/zcodePlanQuota.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchZcodeQuota: vi.fn() };
});

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { solveCaptcha } from "../../open-sse/services/zcodeCaptcha.js";
import { fetchZcodeQuota } from "../../open-sse/services/zcodePlanQuota.js";
import {
  listOfferedPlans,
  claimPlan,
  claimAllOffered,
  buildActivationEvent,
  sendWarmEvents,
} from "../../open-sse/services/zcodePlanClaim.js";

const KERNEL =
  "Darwin Kernel Version 21.6.0: Mon Jun 24 00:56:10 PDT 2024; root:xnu-8020.240.18.709.2~1/RELEASE_X86_64";

const DEVICE_MID = "mid-claim";
const USER_ID = "u-claim";
const JWT = "jwt-claim";

function credentials(overrides = {}) {
  return {
    accessToken: JWT,
    providerSpecificData: { deviceMid: DEVICE_MID, userId: USER_ID },
    ...overrides,
  };
}

// proxyAwareFetch returns an object read with res.status / res.text().
function fetchRes(status, body) {
  return {
    status,
    text: async () => (body == null ? "" : typeof body === "string" ? body : JSON.stringify(body)),
  };
}

const PREVIEW_URL = "https://zcode.z.ai/api/v1/zcode-plan/billing/preview?app_version=3.16.3&platform=darwin-x64";
const CLAIM_URL = "https://zcode.z.ai/api/v1/zcode-plan/billing/claim";
const EVENT_URL = "https://zcode.z.ai/api/v1/event/report";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listOfferedPlans", () => {
  it("sorts priority desc and flags ownership from lowercased balance planIds", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      fetchRes(200, {
        code: 0,
        data: {
          plans: [
            { plan_id: "Basic", name: "Basic", priority: 1 },
            { plan_id: "PRO", name: "Pro", priority: 10 },
            { plan_id: "Mid", name: "Mid", priority: 5 },
          ],
        },
      }),
    );
    fetchZcodeQuota.mockResolvedValueOnce({ planIds: ["pro", "mid"], entitlements: [] });

    const offers = await listOfferedPlans(credentials());
    expect(offers.map((o) => o.planId)).toEqual(["PRO", "Mid", "Basic"]);
    expect(offers.find((o) => o.planId === "PRO").owned).toBe(true);
    expect(offers.find((o) => o.planId === "Mid").owned).toBe(true);
    expect(offers.find((o) => o.planId === "Basic").owned).toBe(false);

    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(PREVIEW_URL);
    expect(init.method).toBe("GET");
    expect(init.headers["X-Device-Mid"]).toBe(DEVICE_MID);
    expect(init.headers.Authorization).toBe(`Bearer ${JWT}`);
  });

  it("a failing balance read leaves every plan unowned", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      fetchRes(200, { code: 0, data: { plans: [{ plan_id: "p1", name: "One", priority: 2 }] } }),
    );
    fetchZcodeQuota.mockRejectedValueOnce(new Error("billing HTTP 502"));

    const offers = await listOfferedPlans(credentials());
    expect(offers).toHaveLength(1);
    expect(offers[0].owned).toBe(false);
  });

  it("throws on a non-200 preview", async () => {
    proxyAwareFetch.mockResolvedValueOnce(fetchRes(500, "boom"));
    await expect(listOfferedPlans(credentials())).rejects.toThrow("preview HTTP 500");
  });

  it("throws on a non-zero preview code", async () => {
    proxyAwareFetch.mockResolvedValueOnce(fetchRes(200, { code: 1005, msg: "denied" }));
    await expect(listOfferedPlans(credentials())).rejects.toThrow("preview code 1005");
  });

  it("drops plans without a plan_id and defaults name to the id", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      fetchRes(200, {
        code: 0,
        data: { plans: [{ plan_id: "", name: "blank" }, { plan_id: "keep" }, null] },
      }),
    );
    fetchZcodeQuota.mockResolvedValueOnce({ planIds: [] });

    const offers = await listOfferedPlans(credentials());
    expect(offers).toEqual([{ planId: "keep", name: "keep", priority: 0, owned: false }]);
  });
});

describe("claimPlan", () => {
  it("mints a captcha and posts the plan with both X-Aliyun headers", async () => {
    solveCaptcha.mockResolvedValueOnce({ param: "P", region: "sgp" });
    proxyAwareFetch.mockResolvedValueOnce(fetchRes(200, { code: 0 }));

    const out = await claimPlan(credentials(), "PRO");
    expect(out).toEqual({ ok: true, alreadyClaimed: false });
    expect(solveCaptcha).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);

    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(CLAIM_URL);
    expect(init.method).toBe("POST");
    expect(init.headers["X-Aliyun-Captcha-Verify-Param"]).toBe("P");
    expect(init.headers["X-Aliyun-Captcha-Verify-Region"]).toBe("sgp");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ plan_id: "PRO" });
  });

  it("omits the captcha headers when the mint returns an empty param", async () => {
    solveCaptcha.mockResolvedValueOnce({ param: "", region: "sgp" });
    proxyAwareFetch.mockResolvedValueOnce(fetchRes(200, { code: 0 }));

    await claimPlan(credentials(), "PRO");
    const [, init] = proxyAwareFetch.mock.calls[0];
    expect(init.headers).not.toHaveProperty("X-Aliyun-Captcha-Verify-Param");
    expect(init.headers).not.toHaveProperty("X-Aliyun-Captcha-Verify-Region");
  });

  it("code 1003 is ok with alreadyClaimed true", async () => {
    solveCaptcha.mockResolvedValueOnce({ param: "P", region: "sgp" });
    proxyAwareFetch.mockResolvedValueOnce(fetchRes(200, { code: 1003 }));
    expect(await claimPlan(credentials(), "PRO")).toEqual({ ok: true, alreadyClaimed: true });
  });

  it("3007 then 0 → two mints, ok", async () => {
    solveCaptcha.mockResolvedValueOnce({ param: "P1", region: "sgp" });
    solveCaptcha.mockResolvedValueOnce({ param: "P2", region: "sgp" });
    proxyAwareFetch
      .mockResolvedValueOnce(fetchRes(200, { code: 3007, msg: "captcha" }))
      .mockResolvedValueOnce(fetchRes(200, { code: 0 }));

    const out = await claimPlan(credentials(), "PRO");
    expect(out).toEqual({ ok: true, alreadyClaimed: false });
    expect(solveCaptcha).toHaveBeenCalledTimes(2);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(proxyAwareFetch.mock.calls[1][1].headers["X-Aliyun-Captcha-Verify-Param"]).toBe("P2");
  });

  it("3007 twice → problem names 'captcha rejected twice'", async () => {
    solveCaptcha.mockResolvedValue({ param: "P", region: "sgp" });
    proxyAwareFetch.mockResolvedValue(fetchRes(200, { code: 3007 }));

    const out = await claimPlan(credentials(), "PRO");
    expect(out.ok).toBe(false);
    expect(out.problem).toContain("captcha rejected twice");
    expect(solveCaptcha).toHaveBeenCalledTimes(2);
  });

  it("HTTP 500 on the claim → problem carries 'HTTP 500' and the body head", async () => {
    solveCaptcha.mockResolvedValueOnce({ param: "P", region: "sgp" });
    proxyAwareFetch.mockResolvedValueOnce(fetchRes(500, "kaboom"));

    const out = await claimPlan(credentials(), "PRO");
    expect(out.ok).toBe(false);
    expect(out.problem).toContain("HTTP 500");
    expect(out.problem).toContain("kaboom");
  });

  it("401/403 are NOT HTTP failures — they fall through to the business code", async () => {
    solveCaptcha.mockResolvedValueOnce({ param: "P", region: "sgp" });
    proxyAwareFetch.mockResolvedValueOnce(fetchRes(401, { code: 0 }));
    expect(await claimPlan(credentials(), "PRO")).toEqual({ ok: true, alreadyClaimed: false });
  });

  it("an unknown business code surfaces code and message", async () => {
    solveCaptcha.mockResolvedValueOnce({ param: "P", region: "sgp" });
    proxyAwareFetch.mockResolvedValueOnce(fetchRes(200, { code: 1005, message: "no seat" }));

    const out = await claimPlan(credentials(), "PRO");
    expect(out.ok).toBe(false);
    expect(out.problem).toContain("code 1005");
    expect(out.problem).toContain("no seat");
  });

  it("a captcha mint failure → problem carries the mint error and no claim POST", async () => {
    solveCaptcha.mockRejectedValueOnce(new Error("solver died"));

    const out = await claimPlan(credentials(), "PRO");
    expect(out.ok).toBe(false);
    expect(out.problem).toContain("solver died");
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("a transport failure on the claim → problem, never thrown", async () => {
    solveCaptcha.mockResolvedValueOnce({ param: "P", region: "sgp" });
    proxyAwareFetch.mockRejectedValueOnce(new Error("ECONNRESET"));

    const out = await claimPlan(credentials(), "PRO");
    expect(out.ok).toBe(false);
    expect(out.problem).toContain("ECONNRESET");
  });
});

describe("claimAllOffered", () => {
  // Builds a listOfferedPlans-shaped flow: one preview fetch, then one claim per
  // unowned plan (each a mint + a claim POST).
  function mockPreview(plans, ownedIds) {
    proxyAwareFetch.mockResolvedValueOnce(fetchRes(200, { code: 0, data: { plans } }));
    fetchZcodeQuota.mockResolvedValueOnce({ planIds: ownedIds });
  }

  it("claims the unowned plans in priority order, skips the owned, collects problems", async () => {
    mockPreview(
      [
        { plan_id: "low", name: "Low", priority: 1 },
        { plan_id: "top", name: "Top", priority: 9 },
        { plan_id: "owned", name: "Owned", priority: 5 },
      ],
      ["owned"],
    );
    solveCaptcha.mockResolvedValue({ param: "P", region: "sgp" });
    // top → ok, low → rejected twice (3007 twice over two mints)
    proxyAwareFetch
      .mockResolvedValueOnce(fetchRes(200, { code: 0 }))
      .mockResolvedValueOnce(fetchRes(200, { code: 3007 }))
      .mockResolvedValueOnce(fetchRes(200, { code: 3007 }));

    const out = await claimAllOffered(credentials());
    expect(out.claimed).toEqual(["Top"]);
    expect(out.skipped).toEqual(["Owned"]);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toContain("captcha rejected twice");
    expect(out.alreadyOwned).toBe(false);

    // the first claim POST after the preview must be the highest priority plan
    const claimBodies = proxyAwareFetch.mock.calls
      .slice(1)
      .map(([url, init]) => (url === CLAIM_URL ? JSON.parse(init.body).plan_id : null))
      .filter(Boolean);
    expect(claimBodies[0]).toBe("top");
    expect(claimBodies).not.toContain("owned");
  });

  it("alreadyOwned true when every offered plan is owned — no claims minted", async () => {
    mockPreview(
      [
        { plan_id: "a", name: "A", priority: 2 },
        { plan_id: "b", name: "B", priority: 1 },
      ],
      ["a", "b"],
    );

    const out = await claimAllOffered(credentials());
    expect(out).toEqual({ claimed: [], skipped: ["A", "B"], problems: [], alreadyOwned: true });
    expect(solveCaptcha).not.toHaveBeenCalled();
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
});

describe("buildActivationEvent", () => {
  it("emits exactly 16 fields with the exact upstream values", () => {
    const ev = buildActivationEvent("app_launch", USER_ID, DEVICE_MID, "3.16.3");

    expect(Object.keys(ev)).toHaveLength(16);
    expect(Object.keys(ev).sort()).toEqual(
      [
        "event_id",
        "client_timezone",
        "client_language",
        "element_name",
        "event_region",
        "event_type",
        "event_text",
        "event_extra_detail",
        "user_id",
        "screen_resolution",
        "app_version",
        "device_os_category",
        "device_os_version",
        "device_mid",
        "mac_id",
        "marketing_params",
      ].sort(),
    );

    expect(ev.client_language).toBe("en-US");
    expect(ev.client_timezone).toBe("Europe/Bucharest");
    expect(ev.screen_resolution).toBe("1920x1080");
    expect(ev.device_os_version).toBe(KERNEL);
    expect(ev.device_os_category).toBe("macos");
    expect(ev.marketing_params).toBe("{}");
    expect(ev.event_region).toBe("app");
    expect(ev.event_type).toBe("view");
    expect(ev.event_text).toBe("");
    expect(ev.event_extra_detail).toEqual({});
    expect(ev.mac_id).toBe("");
    expect(ev.element_name).toBe("app_launch");
    expect(ev.user_id).toBe(USER_ID);
    expect(ev.device_mid).toBe(DEVICE_MID);
    expect(ev.app_version).toBe("3.16.3");
    expect(ev.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("mints a fresh event_id per call", () => {
    const a = buildActivationEvent("app_launch", "u", "d", "v");
    const b = buildActivationEvent("app_launch", "u", "d", "v");
    expect(a.event_id).not.toBe(b.event_id);
  });
});

describe("sendWarmEvents", () => {
  it("posts both warm events and reports 2", async () => {
    proxyAwareFetch.mockResolvedValue(fetchRes(200, { code: 0 }));

    const out = await sendWarmEvents(credentials());
    expect(out).toEqual({ ok: true, events: 2 });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);

    const elements = proxyAwareFetch.mock.calls.map(([url, init]) => {
      expect(url).toBe(EVENT_URL);
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Type"]).toBe("application/json");
      return JSON.parse(init.body).element_name;
    });
    expect(elements).toEqual(["app_launch", "app_daily_active"]);

    const first = JSON.parse(proxyAwareFetch.mock.calls[0][1].body);
    expect(first.device_mid).toBe(DEVICE_MID);
    expect(first.user_id).toBe(USER_ID);
    expect(first.app_version).toBe("3.16.3");
  });

  it("a 400 on the first event → ok:false naming app_launch, second never sent", async () => {
    proxyAwareFetch.mockResolvedValueOnce(fetchRes(400, { code: 1 }));

    const out = await sendWarmEvents(credentials());
    expect(out.ok).toBe(false);
    expect(out.problem).toContain("app_launch");
    expect(out.problem).toContain("HTTP 400");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
});
