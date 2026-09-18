/**
 * OpenCode Zen free-tier gate (2026-09-17) — the wire identity regression.
 *
 * Upstream began fingerprinting callers: `User-Agent` must be opencode/<>=1.17>
 * and `x-opencode-session` must wear the canonical `ses_`+12hex+14Base62 shape.
 * A bare "opencode" UA and a UUID-shaped session — exactly what this executor
 * used to emit — now draw 403 FreeTierError on every free model.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: fetchMock,
}));

import { getExecutor } from "../../open-sse/executors/index.js";
import {
  OPENCODE_REQUEST_RE,
  OPENCODE_SESSION_RE,
  generateRequestId,
  generateSessionId,
  translateSessionId,
} from "../../open-sse/executors/opencode.js";

const makeCredentials = (overrides = {}) => ({
  connectionId: "conn_test",
  rawHeaders: {},
  ...overrides,
});
// The ported fingerprint (upstream #4105/#4111) — shared by both describes below.
const FULL_UA = "opencode/1.18.31 ai-sdk/provider-utils/4.0.46 runtime/bun/1.3.14";

const prepare = (executor, overrides = {}) =>
  executor.prepareRequestCredentials({
    body: overrides.body ?? { messages: [{ role: "user", content: "hello" }] },
    credentials: overrides.credentials ?? makeCredentials(),
  });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
  );
});

describe("canonical identifier shape", () => {
  it("mints ses_ ids the gate accepts — 12 hex + 14 Base62, never a UUID", () => {
    for (let i = 0; i < 20; i++) {
      const id = generateSessionId();
      expect(id).toMatch(OPENCODE_SESSION_RE);
      expect(id).toHaveLength(30);
    }
  });

  it("mints the msg_ twin for request ids", () => {
    for (let i = 0; i < 20; i++) {
      const id = generateRequestId();
      expect(id).toMatch(OPENCODE_REQUEST_RE);
      expect(id).toHaveLength(30);
    }
  });
});

describe("session translation", () => {
  it("translates any client session into a valid canonical id", () => {
    for (const raw of [
      "claude:550e8400-e29b-41d4-a716-446655440000",
      "antigravity:conv-abc-123",
      "session-from-codex",
      "12345",
      "",
    ]) {
      expect(translateSessionId(raw, "claude")).toMatch(OPENCODE_SESSION_RE);
    }
  });

  it("passes an already-canonical session through untouched", () => {
    const valid = "ses_f534dfae8ffeCy4Ee4tLWNygDc";
    expect(translateSessionId(valid)).toBe(valid);
    expect(translateSessionId(`  ${valid}  `)).toBe(valid);
  });

  it("keeps one conversation on one id — prompt-cache affinity survives", () => {
    const executor = getExecutor("opencode");
    const a = prepare(executor)._opencodeSession;
    const b = prepare(executor)._opencodeSession;
    expect(a).toBe(b);
    expect(a).toMatch(OPENCODE_SESSION_RE);
  });

  it("isolates distinct conversations and distinct client tools", () => {
    const executor = getExecutor("opencode");
    const convA = prepare(executor, {
      credentials: makeCredentials({ connectionId: "conv-a" }),
    })._opencodeSession;
    const convB = prepare(executor, {
      credentials: makeCredentials({ connectionId: "conv-b" }),
    })._opencodeSession;
    const toolClaude = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "user-agent": "claude-cli/2.1.258" } }),
    })._opencodeSession;
    const toolCodex = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "user-agent": "codex_cli_rs/0.9.0" } }),
    })._opencodeSession;

    expect(convA).not.toBe(convB);
    expect(toolClaude).not.toBe(toolCodex);
  });
});

describe("session resolution from the caller", () => {
  it("preserves a valid native x-opencode-session header, case-insensitively", () => {
    const executor = getExecutor("opencode");
    const valid = "ses_f534dfae8ffeCy4Ee4tLWNygDc";
    const prepared = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "X-OpenCode-Session": ` ${valid} ` } }),
    });
    expect(prepared._opencodeSession).toBe(valid);
  });

  it("translates an invalid native session header rather than forwarding it", () => {
    const executor = getExecutor("opencode");
    const prepared = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "x-opencode-session": "invalid-session-uuid" } }),
    });
    expect(prepared._opencodeSession).toMatch(OPENCODE_SESSION_RE);
    expect(prepared._opencodeSession).not.toBe("invalid-session-uuid");
  });

  it("never mutates the caller's credentials — the session is request-local", () => {
    const executor = getExecutor("opencode");
    const credentials = makeCredentials();
    const prepared = prepare(executor, { credentials });

    expect(prepared).not.toBe(credentials);
    expect(prepared._opencodeSession).toMatch(OPENCODE_SESSION_RE);
    expect(credentials).not.toHaveProperty("_opencodeSession");
    expect(executor).not.toHaveProperty("_currentSessionId");
  });
});

describe("User-Agent identity", () => {
  const uaFor = (rawHeaders) =>
    getExecutor("opencode").buildHeaders(makeCredentials({ rawHeaders }))["User-Agent"];

  it("defaults to a gate-valid version when the caller sends none", () => {
    expect(uaFor({})).toBe(FULL_UA);
    expect(uaFor({ "user-agent": "Claude-Code/1.0" })).toBe(FULL_UA);
  });

  it("replaces a bare or outdated opencode identity", () => {
    expect(uaFor({ "user-agent": "opencode" })).toBe(FULL_UA);
    expect(uaFor({ "user-agent": "opencode/1.15.0" })).toBe(FULL_UA);
  });

  it("passes a gate-valid opencode identity through", () => {
    const genuine = "opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14";
    expect(uaFor({ "user-agent": genuine })).toBe(genuine);
    expect(uaFor({ "user-agent": "opencode/1.19.0" })).toBe("opencode/1.19.0");
  });
});

describe("the wire the gate sees", () => {
  it("sends the canonical session and the keyless bearer on a free-tier POST", async () => {
    const executor = getExecutor("opencode");
    const credentials = makeCredentials({ accessToken: "public" });

    const result = await executor.execute({
      model: "big-pickle",
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials,
    });

    const sent = fetchMock.mock.calls[0][1].headers;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.headers["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
    expect(sent["x-opencode-session"]).toBe(result.headers["x-opencode-session"]);
    expect(sent["x-opencode-session"]).not.toMatch(/^ses_[0-9a-f]{32}$/);
    expect(sent["User-Agent"]).toBe(FULL_UA);
    expect(sent["Authorization"]).toBe("Bearer public");
    expect(credentials).not.toHaveProperty("_opencodeSession");
  });

  it("rides a keyed connection on authenticated Zen without losing the identity", async () => {
    const executor = getExecutor("opencode");

    const result = await executor.execute({
      model: "big-pickle",
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: true,
      credentials: makeCredentials({ apiKey: "zen-key-abc" }),
    });

    const sent = fetchMock.mock.calls[0][1].headers;
    expect(sent["Authorization"]).toBe("Bearer zen-key-abc");
    expect(sent["User-Agent"]).toBe(FULL_UA);
    expect(sent["Accept"]).toBe("text/event-stream");
    expect(sent["x-opencode-session"]).toBe(result.headers["x-opencode-session"]);
  });
});
