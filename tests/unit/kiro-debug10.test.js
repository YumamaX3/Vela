import { describe, it, vi, beforeEach } from "vitest";
const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetchMock(...args) }));
const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
describe("debug10", () => {
  beforeEach(() => { fetchMock.mockReset(); });
  it("traces recovery with 401 retry", async () => {
    process.env.KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS = "3000";
    process.env.KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS = "3000";
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 }))
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const exec = new KiroExecutor();
    const res = await exec.runIntegrityRecovery(
      new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 }),
      { model: "kr/claude-opus-4.8", body: { systemPrompt: "base" }, stream: true, credentials: { accessToken: "t", providerSpecificData: { kiroToolCallRepair: true } } },
      { signal: new AbortController().signal, maxBytes: 4096, ttftTimeoutMs: 3000, stallTimeoutMs: 3000, repairEnabled: true }
    );
    console.log("RECOVERY:", typeof res === "string" ? "bytes:" + res.length : res.kind, typeof res === "object" ? JSON.stringify(res).slice(0, 150) : "");
  }, 10000);
});
