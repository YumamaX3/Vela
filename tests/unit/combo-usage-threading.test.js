// Test covenant: combo-usage-threading — the requested combo name survives the
// saveUsageStats → saveRequestUsage hop and the buildRequestDetail shape, so a
// combo-attributed request lands in usageHistory/requestDetails with its name
// intact (migration 015, v0.9.40). Proves both that a combo rides through and
// that a direct request stays NULL (never 0-faked, never mis-attributed).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/usageDb", () => ({
  saveRequestUsage: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
}));

let saveRequestUsage;
let saveRequestDetail;

beforeEach(async () => {
  vi.clearAllMocks();
  const usageDb = await import("@/lib/usageDb");
  saveRequestUsage = usageDb.saveRequestUsage;
  saveRequestDetail = usageDb.saveRequestDetail;
});

describe("combo threading — saveUsageStats → saveRequestUsage", () => {
  it("passes the combo name through to the usage write", async () => {
    const { saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js");
    saveUsageStats({
      provider: "openai",
      model: "gpt-5",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      combo: "vela/cc/opus",
      silent: true,
    });
    await vi.waitFor(() => expect(saveRequestUsage).toHaveBeenCalledTimes(1));
    expect(saveRequestUsage.mock.calls[0][0].combo).toBe("vela/cc/opus");
    expect(saveRequestUsage.mock.calls[0][0].model).toBe("gpt-5");
  });

  it("direct request (no combo) writes combo: null — never a stray name", async () => {
    const { saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js");
    saveUsageStats({
      provider: "openai",
      model: "gpt-5",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      silent: true,
    });
    await vi.waitFor(() => expect(saveRequestUsage).toHaveBeenCalledTimes(1));
    expect(saveRequestUsage.mock.calls[0][0].combo).toBeNull();
  });

  it("skips the write entirely when there are no tokens (no phantom rows)", async () => {
    const { saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js");
    saveUsageStats({
      provider: "openai",
      model: "gpt-5",
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      combo: "vela/cc/opus",
      silent: true,
    });
    // give the async boundary a beat — the write must still not fire
    await new Promise((r) => setTimeout(r, 10));
    expect(saveRequestUsage).not.toHaveBeenCalled();
  });
});

describe("combo threading — buildRequestDetail", () => {
  it("carries combo onto the request-detail row", async () => {
    const { buildRequestDetail } = await import("../../open-sse/handlers/chatCore/requestDetail.js");
    const detail = buildRequestDetail({
      provider: "openai",
      model: "gpt-5",
      connectionId: "c1",
      combo: "vela/deepseek/deepseek-v4-flash",
    });
    expect(detail.combo).toBe("vela/deepseek/deepseek-v4-flash");
    expect(detail.provider).toBe("openai");
  });

  it("defaults combo to null when absent", async () => {
    const { buildRequestDetail } = await import("../../open-sse/handlers/chatCore/requestDetail.js");
    const detail = buildRequestDetail({ provider: "openai", model: "gpt-5" });
    expect(detail.combo).toBeNull();
  });
});

describe("combo column presence — the INSERT contracts", () => {
  it("sqlite usageRepo INSERT writes the combo column", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../../src/lib/db/repos/sqlite/usageRepo.js", import.meta.url), "utf8");
    expect(src).toContain("statusClass, combo)");
    expect(src).toContain("entry.combo || null");
  });

  it("sqlite requestDetailsRepo INSERT writes the combo column", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../../src/lib/db/repos/sqlite/requestDetailsRepo.js", import.meta.url), "utf8");
    expect(src).toContain("status, combo, data)");
    expect(src).toContain("item.combo || null");
  });

  it("mysql twins mirror the combo column", async () => {
    const fs = await import("node:fs");
    const usage = fs.readFileSync(new URL("../../src/lib/db/repos/mysql/usageRepo.js", import.meta.url), "utf8");
    const details = fs.readFileSync(new URL("../../src/lib/db/repos/mysql/requestDetailsRepo.js", import.meta.url), "utf8");
    expect(usage).toContain("statusClass, combo)");
    expect(usage).toContain("entry.combo || null");
    expect(details).toContain("status, combo, data)");
    expect(details).toContain("item.combo || null");
  });
});
