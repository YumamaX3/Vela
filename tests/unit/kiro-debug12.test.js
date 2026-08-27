import { describe, it, vi, beforeEach } from "vitest";
const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetchMock(...args) }));
const { BaseExecutor } = await import("../../open-sse/executors/base.js");
describe("debug12", () => {
  beforeEach(() => { fetchMock.mockReset(); });
  it("base execute with 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const exec = new BaseExecutor("x", { baseUrl: "http://x", format: "openai" });
    const t0 = Date.now();
    const res = await exec.execute({
      model: "m", body: { messages: [] }, stream: false,
      credentials: { accessToken: "t" },
    });
    console.log("BASE-EXEC:", Date.now() - t0, res.response.status);
  }, 8000);
});
