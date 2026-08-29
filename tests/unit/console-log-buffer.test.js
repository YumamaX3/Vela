// Console log buffer — the stamped line format + ring cap contract.
// The dashboard's Console Log parses "HH:MM:SS [LEVEL] message"; these
// tests keep that shape honest.
import { describe, it, expect } from "vitest";
import {
  initConsoleLogCapture,
  getConsoleLogs,
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
});
