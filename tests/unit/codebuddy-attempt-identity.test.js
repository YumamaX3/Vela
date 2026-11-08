// The attempt-identity battery — the ported law (codebuddy2api v1.5.4,
// app/request_context.py) proven as vectors: session keys stable, conversation ids
// shaped per profile, attempt headers fresh per call, credential context present.
import { describe, it, expect } from "vitest";
import {
  sessionKey,
  conversationId,
  attemptHeaders,
  SDK_HEADERS,
  __test__,
} from "../../open-sse/shared/codebuddy/attemptIdentity.js";

const { stableUuid7, canonicalDigest, uuidText } = __test__;

describe("sessionKey", () => {
  it("derives a stable 32-hex key from system + first user message", () => {
    const payload = {
      messages: [
        { role: "system", content: "You are CodeBuddy Code." },
        { role: "user", content: "hello world" },
      ],
    };
    const a = sessionKey(payload);
    const b = sessionKey(payload);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("concatenates consecutive system/developer messages, stops at the first non-system", () => {
    const a = sessionKey({
      messages: [
        { role: "system", content: "A" },
        { role: "developer", content: "B" },
        { role: "user", content: "u" },
      ],
    });
    const b = sessionKey({
      messages: [
        { role: "system", content: "AB" },
        { role: "user", content: "u" },
      ],
    });
    // "A" + "B" with no separator === "AB" — upstream's law (converter.py:518-523).
    expect(a).toBe(b);
  });

  it("falls back to the Responses-API input (string and block list)", () => {
    expect(sessionKey({ input: "hi there" })).toMatch(/^[0-9a-f]{32}$/);
    expect(sessionKey({ input: [{ role: "user", content: "hi" }] })).toMatch(/^[0-9a-f]{32}$/);
  });

  it("reads array content parts and returns null when nothing qualifies", () => {
    expect(sessionKey({ messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })).toMatch(/^[0-9a-f]{32}$/);
    expect(sessionKey({ messages: [{ role: "assistant", content: "x" }] })).toBeNull();
    expect(sessionKey({})).toBeNull();
    expect(sessionKey(null)).toBeNull();
  });
});

describe("conversationId", () => {
  const sk = sessionKey({ messages: [{ role: "user", content: "hello" }] });

  it("is stable for the same (profile, account, sessionKey) triple", () => {
    expect(conversationId("cn-work", "acc1", sk)).toBe(conversationId("cn-work", "acc1", sk));
  });

  it("gives cn-work a UUIDv7-shaped id (version nibble 7, RFC variant)", () => {
    const id = conversationId("cn-work", "acc1", sk);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("gives cli lanes a dashed digest id that differs from cn-work and is stable", () => {
    // A digest byte can read 7 or [89ab] by chance, so no nibble is a law here.
    // What distinguishes the lanes is that cn-work always carries the v7 variant
    // mark; the cli id is a bare digest — pinned by shape, difference, determinism.
    const cli = conversationId("cn-cli", "acc1", sk);
    expect(cli).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(cli).not.toBe(conversationId("cn-work", "acc1", sk));
    expect(conversationId("cn-cli", "acc1", sk)).toBe(cli);
  });

  it("differs per account and per session key", () => {
    expect(conversationId("cn-cli", "acc1", sk)).not.toBe(conversationId("cn-cli", "acc2", sk));
    expect(conversationId("cn-cli", "acc1", sk)).not.toBe(conversationId("cn-cli", "acc1", sk + "0"));
  });
});

describe("attemptHeaders", () => {
  const sk = sessionKey({ messages: [{ role: "user", content: "hello" }] });
  const conv = conversationId("cn-cli", "acc1", sk);
  const base = { "User-Agent": "CLI/2.179.3 CodeBuddy/2.179.3" };

  it("carries the full trace block and the SDK fingerprint", () => {
    const h = attemptHeaders(base, "cn-cli", { conversationId: conv });
    expect(h["X-Conversation-ID"]).toBe(conv);
    expect(h["X-Request-ID"]).toMatch(/^[0-9a-f]{32}$/);
    expect(h["X-Conversation-Message-ID"]).toMatch(/^[0-9a-f]{32}$/);
    expect(h["X-Conversation-Request-ID"]).toBe(h["X-Root-Request-ID"]);
    expect(h["X-Trace-ID"]).toMatch(/^[0-9a-f]{32}$/);
    expect(h["traceparent"]).toBe(`00-${h["X-Trace-ID"]}-${h["X-B3-SpanId"]}-01`);
    expect(h["b3"]).toBe(`${h["X-Trace-ID"]}-${h["X-B3-SpanId"]}-1-${h["X-B3-ParentSpanId"]}`);
    expect(h["X-B3-Sampled"]).toBe("1");
    for (const [k, v] of Object.entries(SDK_HEADERS)) expect(h[k]).toBe(v);
  });

  it("regenerates per-attempt ids on every call but keeps the conversation id", () => {
    const a = attemptHeaders(base, "cn-cli", { conversationId: conv });
    const b = attemptHeaders(base, "cn-cli", { conversationId: conv });
    expect(a["X-B3-SpanId"]).not.toBe(b["X-B3-SpanId"]);
    expect(a["X-Request-ID"]).not.toBe(b["X-Request-ID"]);
    expect(a["X-Conversation-ID"]).toBe(b["X-Conversation-ID"]);
  });

  it("does not mutate the base headers", () => {
    const snapshot = { ...base };
    attemptHeaders(base, "cn-cli", { conversationId: conv });
    expect(base).toEqual(snapshot);
  });

  it("shapes the CLI lanes: request←message, trace←root, runtime other", () => {
    const h = attemptHeaders(base, "intl-cli", { conversationId: conv });
    expect(h["X-Request-ID"]).toBe(h["X-Conversation-Message-ID"]);
    expect(h["X-Trace-ID"]).toBe(h["X-Conversation-Request-ID"]);
    expect(h["X-Agent-Runtime"]).toBe("other");
    expect(h["X-Session-ID"]).toBeUndefined();
    expect(h["baggage"]).toBeUndefined();
  });

  it("shapes the WorkBuddy lanes: dashed ids, runtime local-agent", () => {
    const wconv = conversationId("intl-work", "acc1", sk);
    const h = attemptHeaders(base, "intl-work", { conversationId: wconv });
    expect(h["X-Agent-Runtime"]).toBe("local-agent");
    expect(h["X-Request-ID"]).toContain("-");
    expect(h["X-Conversation-Message-ID"]).toContain("-");
  });

  it("shapes cn-work only: session trio + baggage over the stable conversation id", () => {
    const wconv = conversationId("cn-work", "acc1", sk);
    const h = attemptHeaders(base, "cn-work", { conversationId: wconv });
    expect(h["X-Session-ID"]).toBe(wconv);
    expect(h["X-Root-Request-ID"]).toMatch(/^[0-9a-f]{32}$/);
    expect(h["acp-connection-id"]).toMatch(/^[0-9a-f]{8}-/);
    expect(h["baggage"]).toContain(`codebuddy.session_id=${wconv}`);
    expect(h["baggage"]).toContain("x-agent-runtime=local-agent");
    // The trio is stable per conversation, not per attempt.
    const h2 = attemptHeaders(base, "cn-work", { conversationId: wconv });
    expect(h2["X-Root-Request-ID"]).toBe(h["X-Root-Request-ID"]);
    expect(h2["acp-connection-id"]).toBe(h["acp-connection-id"]);
  });
});

describe("helpers", () => {
  it("uuidText dashes a 32-hex value and leaves others alone", () => {
    expect(uuidText("0123456789abcdef0123456789abcdef")).toBe("01234567-89ab-cdef-0123-456789abcdef");
    expect(uuidText("not-hex")).toBe("not-hex");
  });

  it("canonicalDigest matches Python's json.dumps(sort_keys, tight separators) ordering", () => {
    // Same members, different key order — canonical form must agree.
    expect(canonicalDigest([{ b: 2, a: 1 }])).toBe(canonicalDigest([{ a: 1, b: 2 }]));
    expect(canonicalDigest(["x"])).not.toBe(canonicalDigest([["x"]]));
  });

  it("stableUuid7 output is dashed and v7-shaped", () => {
    const id = stableUuid7(["cn-work", "acc", "skey"]);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableUuid7(["cn-work", "acc", "skey"])).toBe(id);
  });
});
