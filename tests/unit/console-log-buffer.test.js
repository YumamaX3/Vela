// Console log buffer — the stamped line format + ring cap contract + structured telemetry.
// The dashboard's Console Log parses "HH:MM:SS [LEVEL] message" and consumes structured entries.
import { describe, it, expect } from "vitest";
import {
  initConsoleLogCapture,
  getConsoleLogs,
  getConsoleLogStats,
  clearConsoleLogs,
} from "@/lib/consoleLogBuffer.js";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";

describe("consoleLogBuffer — stamped capture", () => {
  it("stamps every line with HH:MM:SS and the level tag", () => {
    initConsoleLogCapture();
    clearConsoleLogs();
    console.error("harbor probe");
    const logs = getConsoleLogs();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[logs.length - 1]).toMatch(/^\d{2}:\d{2}:\d{2} \[ERROR\] harbor probe$/);
  });

  it("stamps info-level lines too", () => {
    clearConsoleLogs();
    console.info("tide check");
    const logs = getConsoleLogs();
    expect(logs[logs.length - 1]).toMatch(/^\d{2}:\d{2}:\d{2} \[INFO\] tide check$/);
  });

  it("trims the ring to maxLines", () => {
    clearConsoleLogs();
    const max = CONSOLE_LOG_CONFIG.maxLines;
    for (let i = 0; i < max + 25; i++) console.log(`ring-line-${i}`);
    const logs = getConsoleLogs();
    expect(logs.length).toBe(max);
    expect(logs[logs.length - 1]).toContain(`ring-line-${max + 24}`);
  });

  it("produces structured entries with tags and timestamps", () => {
    clearConsoleLogs();
    console.warn("[RTK] filter compressed 450 tokens on [OPENCODE]");
    const entries = getConsoleLogs({ structured: true });
    expect(entries.length).toBeGreaterThan(0);
    const last = entries[entries.length - 1];
    expect(last.level).toBe("WARN");
    expect(last.message).toContain("filter compressed 450 tokens");
    expect(last.tags).toContain("RTK");
    expect(last.tags).toContain("OPENCODE");
    expect(last.id).toMatch(/^log_\d+_\d+$/);
  });

  it("filters structured entries by level and query", () => {
    clearConsoleLogs();
    console.log("[DB] connection established");
    console.error("[AUTH] key verification failed");
    console.warn("[STREAM] timeout waiting for upstream");

    const errorsOnly = getConsoleLogs({ structured: true, level: "error" });
    expect(errorsOnly.every((e) => e.level === "ERROR")).toBe(true);
    expect(errorsOnly.some((e) => e.message.includes("key verification"))).toBe(true);

    const authOnly = getConsoleLogs({ structured: true, tag: "AUTH" });
    expect(authOnly.length).toBe(1);
    expect(authOnly[0].tags).toContain("AUTH");

    const queryMatch = getConsoleLogs({ structured: true, query: "upstream" });
    expect(queryMatch.length).toBe(1);
    expect(queryMatch[0].message).toContain("timeout waiting for upstream");
  });

  it("computes accurate log stats and tag frequency", () => {
    clearConsoleLogs();
    console.log("[PROXY] selected pool-alpha");
    console.error("[PROXY] pool-alpha connection refused");
    console.warn("[RTK] compression skipped");

    const stats = getConsoleLogStats();
    expect(stats.counts.total).toBe(3);
    expect(stats.counts.LOG).toBe(1);
    expect(stats.counts.ERROR).toBe(1);
    expect(stats.counts.WARN).toBe(1);
    expect(stats.tagCounts.PROXY).toBe(2);
    expect(stats.tagCounts.RTK).toBe(1);
  });
});
