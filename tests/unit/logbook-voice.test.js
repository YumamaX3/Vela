// The Logbook voice — proves the recut emitters speak the new tongue while
// keeping every field shape the ledger and the e2e regexes grep for.
// Pure emitters only: logfmt (pure), logger (pure printers), streamHandler
// (controller cries), requestDetail.formatDoneLine (pure formatter).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fmtDur, fmtTok, kv } from "../../open-sse/utils/logfmt.js";

describe("logfmt — the tide's arithmetic", () => {
  it("reads durations as a tide does", () => {
    expect(fmtDur(724)).toBe("724ms");
    expect(fmtDur(58365)).toBe("58.4s");
    expect(fmtDur(67956)).toBe("1m08s");
    expect(fmtDur(76762)).toBe("1m17s");
    expect(fmtDur(393498)).toBe("6m33s");
    expect(fmtDur(250483)).toBe("4m10s");
  });
  it("never goes negative or NaN", () => {
    expect(fmtDur(-5)).toBe("0ms");
    expect(fmtDur(NaN)).toBe("0ms");
    expect(fmtDur(undefined)).toBe("0ms");
  });
  it("wears thousands separators at 1000 and above", () => {
    expect(fmtTok(724)).toBe("724");
    expect(fmtTok(76162)).toBe("76,162");
    expect(fmtTok(1000)).toBe("1,000");
    expect(fmtTok(0)).toBe("0");
  });
  it("renders kv chains with clamped fields", () => {
    expect(kv({ a: 1, b: "x" })).toBe(" · a=1 · b=x");
    expect(kv(null)).toBe("");
    expect(kv("note")).toBe(" · note");
    const long = "x".repeat(120);
    const cell = kv({ k: long });
    expect(cell).toContain("…");
    expect(cell.startsWith(" · k=xxx")).toBe(true);
    expect(cell.length).toBeLessThan(110);
  });
  it("reads arrays as lists with a spillover count", () => {
    expect(kv({ ids: ["a", "b", "c"] })).toBe(" · ids=a,b,c");
    expect(kv({ ids: ["a", "b", "c", "d", "e"] })).toBe(" · ids=a,b,c +2");
  });
});

describe("logger printers — one row, inline fields", () => {
  let spy;
  beforeEach(() => {
    spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("info wears the tag, the message, and an inline kv chain", async () => {
    const log = await import("../../src/sse/utils/logger.js");
    log.info("TOKEN_REFRESH", "renewing credentials ahead of the tide", {
      provider: "cline",
      expiresIn: -3974637,
    });
    const line = spy.mock.calls[spy.mock.calls.length - 1][0];
    expect(line).toContain("[TOKEN_REFRESH]");
    expect(line).toContain("renewing credentials ahead of the tide");
    expect(line).toContain("provider=cline");
    expect(line).toContain("expiresIn=-3974637");
    // one row: no JSON.stringify object dump
    expect(line).not.toMatch(/\{.*\}/);
  });
  it("warn and error keep their channels", async () => {
    const log = await import("../../src/sse/utils/logger.js");
    log.warn("LOOPGUARD", "a loop in the current");
    expect(console.warn).toHaveBeenCalled();
    const w = console.warn.mock.calls[0][0];
    expect(w).toContain("[LOOPGUARD]");
    expect(w).toContain("a loop in the current");
    log.error("E", "stowing credentials broke", { error: "invalid_grant" });
    const e = spy.mock.calls[spy.mock.calls.length - 1][0];
    expect(e).toContain("error=invalid_grant");
  });
});

describe("stream controller — the three cries on one tag", async () => {
  const { createStreamController } = await import("../../open-sse/utils/streamHandler.js");

  it("parted moorings carries reason and the duration tide", () => {
    const lines = [];
    const errors = [];
    const ctl = createStreamController({
      log: { line: (t, s, m) => lines.push({ t, s, m }), errorLine: (t, s, m) => errors.push({ t, s, m }) },
      provider: "cline",
      model: "claude-x",
      reqTag: "#T1",
    });
    ctl.handleDisconnect?.("ResponseAborted");
    expect(lines.length).toBe(1);
    expect(lines[0].t).toBe("#T1");
    expect(lines[0].s).toBe("⚡");
    expect(lines[0].m).toContain("parted moorings · ResponseAborted");
    expect(lines[0].m).toContain("cline/claude-x");
    expect(lines[0].m).toMatch(/· \d+(\.\d+)?(ms|s)$/);
  });

  it("hauled ashore on AbortError, current broke on real errors", () => {
    const lines = [];
    const errors = [];
    const ctl = createStreamController({
      log: { line: (t, s, m) => lines.push({ s, m }), errorLine: (t, s, m) => errors.push({ s, m }) },
      provider: "p",
      model: "m",
      reqTag: "#T2",
    });
    const mk = () => createStreamController({
      log: { line: (t, s, m) => lines.push({ s, m }), errorLine: (t, s, m) => errors.push({ s, m }) },
      provider: "p",
      model: "m",
      reqTag: "#T2",
    });
    const a = mk();
    a.handleError(Object.assign(new Error("no matter"), { name: "AbortError" }));
    expect(lines.map((l) => l.m).join("|")).toContain("hauled ashore");
    const b = mk();
    b.handleError(new Error("boom"));
    expect(errors.length).toBe(1);
    expect(errors[0].m).toContain("the current broke · boom");
  });

  it("the stall keeps its wire contract while the debug line speaks", async () => {
    const { pipeWithDisconnect } = await import("../../open-sse/utils/streamHandler.js");
    const lines = [];
    const errors = [];
    const ctl = createStreamController({
      log: { line: (t, s, m) => lines.push({ s, m }), errorLine: (t, s, m) => errors.push({ s, m }) },
      provider: "p",
      model: "m",
      reqTag: "#T3",
    });
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: x\n\n"));
      },
    });
    const ts = new TransformStream({ transform(chunk, ctrl) { ctrl.enqueue(chunk); } });
    const out = pipeWithDisconnect({ body }, ts, ctl, null, 40);
    const reader = out.getReader();
    await reader.read(); // first light lands
    const stall = new Promise((resolve) => {
      const iv = setInterval(() => {
        if (errors.length) { clearInterval(iv); resolve(true); }
      }, 10);
      setTimeout(() => { clearInterval(iv); resolve(false); }, 500);
    });
    const pulled = Promise.race([
      reader.read().then(() => "chunk").catch(() => "threw"),
      new Promise((r) => setTimeout(() => r("timeout"), 400)),
    ]);
    const [came] = await Promise.all([pulled, stall]);
    expect(errors.length).toBe(1);
    expect(errors[0].m).toContain("stream stall timeout");
    expect(["threw", "timeout"]).toContain(came);
  });
});

describe("formatDoneLine — the anchored row", async () => {
  const { formatDoneLine } = await import("../../open-sse/handlers/chatCore/requestDetail.js");

  it("reads the hour, first light, and the cache split", () => {
    const line = formatDoneLine({
      usage: { prompt_tokens: 76162, completion_tokens: 724, cache_read_input_tokens: 67956, cache_creation_input_tokens: 1200 },
      latency: { total: 58365, ttft: 1234 },
    });
    expect(line).toContain("DONE 58.4s"); // recut emitter
    expect(line).toContain("first light 1.2s");
    expect(line).toContain("IN 76,162 (CACHE ↻67,956 +1,200)");
    expect(line).toContain("OUT 724");
  });
  it("stays honest when the tide carries no cache and no ttft", () => {
    const line = formatDoneLine({ usage: { prompt_tokens: 724, completion_tokens: 12 }, latency: { total: 724 } });
    expect(line).toBe("DONE 724ms · IN 724 · OUT 12");
  });
});

describe("combo + tokenRefresh — the fleet's cries carry their fields", () => {
  it("combo files keep the new voice and their status fields", () => {
    const fs = require("node:fs");
    const combo = fs.readFileSync("open-sse/services/combo.js", "utf8");
    expect(combo).toContain("`anchored · ${modelStr}`");
    expect(combo).toContain("`every hull refused · ${msg}`");
    expect(combo).toContain("riding at anchor");
  });
  it("tokenRefresh keeps expiresIn as a number field", () => {
    const fs = require("node:fs");
    const tr = fs.readFileSync("src/sse/services/tokenRefresh.js", "utf8");
    expect(tr).toContain('"renewing credentials ahead of the tide"');
    expect(tr).toContain("expiresIn: remaining === null ? null : Math.round(remaining / 1000)");
  });
});
