import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCursorModelCache,
  parseCursorUsableModels,
  resolveCursorModels,
} from "../../open-sse/services/cursorModels.js";

// ── node:http2 mock (2026-10-11 mend) ────────────────────────────────────
// The service's transport is http2.connect (the host is HTTP/2-only), so the
// old global.fetch mock intercepted nothing. This mock streams the planted
// payload back over a fake session and records what the service dialed.
const mockH2State = vi.hoisted(() => ({ payload: null, status: 200, sessions: [] }));
vi.mock("node:http2", () => ({
  default: {
    connect: vi.fn(() => {
      const session = { recorded: null };
      const client = {
        on: vi.fn(() => client),
        request: vi.fn((headers) => {
          mockH2State.sessions.push({ authority: headers[":authority"], path: headers[":path"], headers });
          const req = {
            _handlers: {},
            on(event, cb) { this._handlers[event] = cb; return this; },
            end() {
              setTimeout(() => this._handlers.response?.({ ":status": mockH2State.status }), 0);
              if (mockH2State.payload) setTimeout(() => this._handlers.data?.(Buffer.from(mockH2State.payload)), 1);
              setTimeout(() => this._handlers.end?.(), 5);
              return this;
            },
            close() {},
            destroy() {},
          };
          return req;
        }),
        close() {},
        destroy() {},
      };
      return client;
    }),
    constants: { NGHTTP2_NO_ERROR: 0 },
  },
}));
const originalFetch = global.fetch;

function varint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Uint8Array.from(bytes);
}

function field(fieldNumber, value) {
  return Uint8Array.from([(fieldNumber << 3) | 2, ...varint(value.length), ...value]);
}

function text(value) {
  return new TextEncoder().encode(value);
}

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function model(id, name) {
  return field(1, concat(field(1, text(id)), field(4, text(name))));
}

describe("Cursor live model catalog", () => {
  beforeEach(() => {
    clearCursorModelCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearCursorModelCache();
  });

  it("decodes the GetUsableModels protobuf response", () => {
    const payload = concat(
      model("default", "Auto"),
      model("gpt-5.3-codex", "GPT 5.3 Codex"),
      model("gpt-5.3-codex", "Duplicate"),
    );

    expect(parseCursorUsableModels(payload)).toEqual([
      { id: "default", name: "Auto" },
      { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
    ]);
  });

  it("fetches the account-specific catalog and caches it", async () => {
    const payload = concat(model("claude-4.6-opus", "Claude 4.6 Opus"));
    // 2026-10-11 mend: the service rides http2.connect (1de8680b — the host is
    // HTTP/2-only), never global.fetch. The file-scope vi.mock("node:http2")
    // below streams `mockH2.payload` back; we plant it here.
    mockH2State.payload = payload;
    mockH2State.status = 200;
    const credentials = {
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    };

    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });
    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });

    expect(mockH2State.sessions).toHaveLength(1);
    expect(mockH2State.sessions[0].authority).toBe("agent.api5.cursor.sh");
    expect(mockH2State.sessions[0].path).toBe("/agent.v1.AgentService/GetUsableModels");
    expect(mockH2State.sessions[0].headers).toEqual(expect.objectContaining({
      "content-type": "application/proto",
      accept: "application/proto",
    }));
  });

  it("fails open when the Cursor catalog request fails", async () => {
    mockH2State.status = 403;
    mockH2State.payload = null;
    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    })).resolves.toBeNull();
  });
});
