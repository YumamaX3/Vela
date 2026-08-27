import { describe, it, vi, beforeEach } from "vitest";
const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetchMock(...args) }));
const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
describe("debug11", () => {
  beforeEach(() => { fetchMock.mockReset(); });
  it("reads the 401 body via the retry", async () => {
    process.env.KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS = "3000";
    process.env.KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS = "3000";
    // Only a single 401 — the first attempt is the 401, no empty stream.
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const exec = new KiroExecutor();
    const res = await exec.execute({
      model: "kr/claude-opus-4.8",
      body: { systemPrompt: "base", conversationState: {} },
      stream: true,
      credentials: { accessToken: "t", providerSpecificData: { kiroToolCallRepair: true } },
    });
    console.log("EXEC-STATUS:", res.response.status);
    const t0 = Date.now();
    const body = await res.response.text();
    console.log("BODY-DONE:", Date.now() - t0, body.slice(0, 120));
  }, 10000);
});
