// thoughtSignatureStore — smoke test for the W6.5 surgical port (v0.9.53).
// The store persists Gemini thoughtSignature values per tool-call id so
// Antigravity's executor can backfill them into later turns (Google drops
// them from client history). No upstream suite exists; this pins the
// contract the three consumers rely on:
//   storeGeminiThoughtSignature(callId, sig, sessionId)  — capture
//   getGeminiThoughtSignatureSync(callId, sessionId)      — executor backfill
//   getGeminiThoughtSignature(callId, sessionId)          — async read path
// DB-backed kv needs the real adapter harness (DATA_DIR isolation); these
// cases ride the memory tier, which is what the sync executor path uses.
import { describe, it, expect, beforeEach } from "vitest";
import {
  storeGeminiThoughtSignature,
  getGeminiThoughtSignatureSync,
} from "../../open-sse/services/thoughtSignatureStore.js";

describe("thoughtSignatureStore (memory tier)", () => {
  beforeEach(() => {
    // memory tier only — each case gets a fresh namespace by unique ids
  });

  it("stores and sync-reads a signature for a tool call", () => {
    storeGeminiThoughtSignature("call-smoke-1", "SIG==abc", "sess-1");
    expect(getGeminiThoughtSignatureSync("call-smoke-1", "sess-1")).toBe("SIG==abc");
  });

  it("scopes by session but falls back to the global key", () => {
    // Store with a session writes BOTH the scoped and the global key
    // (deliberate: the executor's sessionId can wobble between turns —
    // the global fallback keeps the signature reachable). So a *different*
    // session still reads it via the global key, but a session-scoped
    // lookup prefers its own key when one exists.
    storeGeminiThoughtSignature("call-smoke-2", "SIG==x", "sess-A");
    expect(getGeminiThoughtSignatureSync("call-smoke-2", "sess-A")).toBe("SIG==x");
    expect(getGeminiThoughtSignatureSync("call-smoke-2", "sess-B")).toBe("SIG==x"); // global fallback
    // A session-scoped write shadows the global for that session
    storeGeminiThoughtSignature("call-smoke-2", "SIG==scoped", "sess-C");
    expect(getGeminiThoughtSignatureSync("call-smoke-2", "sess-C")).toBe("SIG==scoped");
  });

  it("overwrites with the latest signature for the same call id", () => {
    storeGeminiThoughtSignature("call-smoke-3", "SIG==old", "sess-1");
    storeGeminiThoughtSignature("call-smoke-3", "SIG==new", "sess-1");
    expect(getGeminiThoughtSignatureSync("call-smoke-3", "sess-1")).toBe("SIG==new");
  });

  it("returns null for unknown call ids (no fabricated signature)", () => {
    expect(getGeminiThoughtSignatureSync("call-never-stored", null)).toBeNull();
  });

  it("tolerates a null session id (global scope)", () => {
    storeGeminiThoughtSignature("call-smoke-4", "SIG==global", null);
    expect(getGeminiThoughtSignatureSync("call-smoke-4", null)).toBe("SIG==global");
  });
});
