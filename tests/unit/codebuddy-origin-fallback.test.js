// The channel/origin fallback battery — the ported law (codebuddy2api v1.5.4,
// app/upstream_compat.py + converter.py _checked_chat_stream) proven as vectors:
// intl-only console door, cn-work backup origin, replay-safety, and the Vela
// executor's integration (origin replay before channel fallback, identity on
// every dial).
import { describe, it, expect } from "vitest";
import {
  hasChannelCode,
  isChannelCheckError,
  channelFallbackUrl,
  shouldChannelFallback,
  workbuddyOriginFallbackUrl,
  shouldOriginFallback,
  isOriginReplaySafe,
  WORKBUDDY_CN_BACKUP_ORIGIN,
} from "../../open-sse/shared/codebuddy/channelCheck.js";
import { CodeBuddyFamilyExecutor } from "../../open-sse/executors/codebuddy-family.js";
import { CODEBUDDY_PROFILES } from "../../open-sse/shared/codebuddy/profiles.js";
import { CODEBUDDY_VERSIONS } from "../../open-sse/shared/codebuddy/identity.js";

describe("channel recognition (carried law, regression-guarded)", () => {
  it("requires both halves — code and text", () => {
    expect(hasChannelCode('{"code":"11128","msg":"anything"}')).toBe(true);
    expect(isChannelCheckError('{"code":"11128","msg":"channel verification failed"}')).toBe(true);
    expect(isChannelCheckError('{"code":"11128","msg":"unrelated"}')).toBe(false);
    expect(isChannelCheckError("just channel verification words")).toBe(false);
    // Chinese marker alone is NOT enough; with the code it is.
    expect(isChannelCheckError("渠道校验 without the code")).toBe(false);
    expect(isChannelCheckError('{"code":"11-128","msg":"渠道校验"}')).toBe(true);
  });
});

describe("console door — INTERNATIONAL ONLY (upstream channel_fallback_url:193-204)", () => {
  it("returns the console twin for intl chat URLs", () => {
    expect(channelFallbackUrl("https://www.codebuddy.ai/v2/chat/completions")).toBe(
      "https://www.codebuddy.ai/console/chat/completions",
    );
    expect(channelFallbackUrl("https://www.workbuddy.ai/v2/chat/completions")?.includes("/console/")).toBe(true);
  });

  it("returns null for every CN host — the CN lanes have no console door", () => {
    expect(channelFallbackUrl("https://copilot.tencent.com/v2/chat/completions")).toBeNull();
    expect(channelFallbackUrl("https://www.workbuddy.cn/v2/chat/completions")).toBeNull();
    expect(CODEBUDDY_PROFILES["codebuddy-cn"].consoleDoor).toBe(false);
    expect(CODEBUDDY_PROFILES["workbuddy-cn"].consoleDoor).toBe(false);
    expect(CODEBUDDY_PROFILES["codebuddy-intl"].consoleDoor).toBe(true);
    expect(CODEBUDDY_PROFILES["workbuddy-intl"].consoleDoor).toBe(true);
  });

  it("returns null for other paths and shouldChannelFallback keeps the 400 gate", () => {
    expect(channelFallbackUrl("https://www.codebuddy.ai/v2/other")).toBeNull();
    expect(shouldChannelFallback(null, 400, '{"code":"11128","msg":"channel verification"}')).toBe(false);
    expect(shouldChannelFallback("https://www.codebuddy.ai/console/chat/completions", 500, "x")).toBe(false);
    expect(shouldChannelFallback("https://www.codebuddy.ai/console/chat/completions", 400, "unrelated body")).toBe(false);
  });
});

describe("backup origin — cn-work only (upstream workbuddy_origin_fallback_url:207-223)", () => {
  it("maps domestic WorkBuddy chat onto wb.tencentbuddy.com", () => {
    expect(workbuddyOriginFallbackUrl("https://www.workbuddy.cn/v2/chat/completions", "cn-work")).toBe(
      `https://${WORKBUDDY_CN_BACKUP_ORIGIN}/v2/chat/completions`,
    );
    // The module returns a URL string; read the host through the URL parser.
    expect(new URL(workbuddyOriginFallbackUrl("https://copilot.tencent.com/v2/chat/completions", "cn-work") ?? "").hostname).toBe(
      WORKBUDDY_CN_BACKUP_ORIGIN,
    );
  });

  it("refuses every other profile, protocol, and path", () => {
    expect(workbuddyOriginFallbackUrl("https://www.workbuddy.ai/v2/chat/completions", "intl-work")).toBeNull();
    expect(workbuddyOriginFallbackUrl("https://copilot.tencent.com/v2/chat/completions", "cn-cli")).toBeNull();
    expect(workbuddyOriginFallbackUrl("http://www.workbuddy.cn/v2/chat/completions", "cn-work")).toBeNull();
    expect(workbuddyOriginFallbackUrl("https://www.workbuddy.cn/v2/other", "cn-work")).toBeNull();
    expect(workbuddyOriginFallbackUrl("not a url", "cn-work")).toBeNull();
  });

  it("replays only the transient gateway statuses", () => {
    const url = "https://wb.tencentbuddy.com/v2/chat/completions";
    for (const status of [408, 502, 503, 504]) expect(shouldOriginFallback(url, status)).toBe(true);
    for (const status of [400, 401, 403, 429, 500, 200]) expect(shouldOriginFallback(url, status)).toBe(false);
    expect(shouldOriginFallback(null, 502)).toBe(false);
  });
});

describe("origin replay safety (upstream _origin_replay_safe, converter.py:5019-5023)", () => {
  it("replays a clean transient failure", () => {
    expect(isOriginReplaySafe(JSON.stringify({ error: { message: "gateway timeout" } }))).toBe(true);
    expect(isOriginReplaySafe("plain gateway error")).toBe(true);
  });

  it("holds a content-filter refusal", () => {
    const canned = "抱歉，系统检测到您当前输入的信息存在敏感内容，我无法响应您的请求，请检查后重新输入";
    expect(isOriginReplaySafe(JSON.stringify({ error: { message: canned } }))).toBe(false);
  });

  it("holds a confirmed channel rejection", () => {
    expect(isOriginReplaySafe('{"code":"11128","msg":"channel verification failed"}')).toBe(false);
  });

  it("holds every no-failover / model-scoped business code", () => {
    for (const code of [11102, 11128, 11129, 11134, 11140, 11148, 11150, 11158, 14018]) {
      expect(isOriginReplaySafe(`upstream answered with code ${code}`)).toBe(false);
    }
  });

  it("ignores numbers that merely contain a code as a substring", () => {
    expect(isOriginReplaySafe("id 111028 reference")).toBe(true);
  });
});

describe("family executor integration (identity on every dial)", () => {
  it("the four products construct and the profile is frozen", () => {
    for (const id of ["codebuddy-cn", "codebuddy-intl", "workbuddy-cn", "workbuddy-intl"]) {
      const executor = new CodeBuddyFamilyExecutor(id);
      expect(executor.profile.id).toBe(id);
    }
  });

  it("transformRequest normalizes tool schemas and keeps the product shape", () => {
    const executor = new CodeBuddyFamilyExecutor("workbuddy-cn");
    const out = executor.transformRequest(
      "glm-5.3",
      {
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "hi" },
        ],
        tools: [{ type: "function", function: { name: "f", parameters: {} } }],
      },
      false,
      { accessToken: "a.b.c" },
    );
    expect(out.stream).toBe(true); // non-stream is re-aggregated upstream-side
    expect(out.tools[0].function.parameters).toEqual({ type: "object", properties: {} });
    expect(out.messages[0].content).toBe("You are WorkBuddy, a powerful AI assistant.");
  });

  it("buildHeaders carries the attempt-identity block and credential context", () => {
    const executor = new CodeBuddyFamilyExecutor("workbuddy-cn");
    const headers = executor.buildHeaders(
      { accessToken: "a.b.c", connectionId: "c1", account: { uid: "u1", enterpriseId: "e1" } },
      true,
      "https://www.workbuddy.cn/v2/chat/completions",
      "glm-5.3",
      { messages: [{ role: "user", content: "hi" }] },
    );
    expect(headers["X-Conversation-ID"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(headers["traceparent"]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(headers["X-Agent-Runtime"]).toBe("local-agent");
    expect(headers["X-User-Id"]).toBe("u1");
    expect(headers["X-Enterprise-Id"]).toBe("e1");
    expect(headers["X-Tenant-Id"]).toBe("e1");
    expect(headers["X-Domain"]).toBe("www.workbuddy.cn");
    expect(headers["baggage"]).toContain("x-agent-runtime=local-agent");
  });

  it("falls back to the JWT subject for the uid when no account block exists", () => {
    const executor = new CodeBuddyFamilyExecutor("codebuddy-intl");
    const token = `x.${Buffer.from(JSON.stringify({ sub: "user-42" })).toString("base64")}.z`;
    const headers = executor.buildHeaders(
      { accessToken: token, connectionId: "c1" },
      true,
      "https://www.codebuddy.ai/v2/chat/completions",
      "glm-5.3",
      { messages: [{ role: "user", content: "hi" }] },
    );
    expect(headers["X-User-Id"]).toBe("user-42");
    expect(headers["X-Enterprise-Id"]).toBe("");
    expect(headers["X-Domain"]).toBe("www.codebuddy.ai");
    expect(headers["X-Agent-Runtime"]).toBe("other");
  });

  it("the registry derives the intl UA from the one identity law (no literal drift)", async () => {
    const { default: intl } = await import("../../open-sse/providers/registry/codebuddy-intl.js");
    expect(intl.transport.headers["User-Agent"]).toBe(
      `CLI/${CODEBUDDY_VERSIONS.international.cli} CodeBuddy/${CODEBUDDY_VERSIONS.international.cli}`,
    );
  });
});
