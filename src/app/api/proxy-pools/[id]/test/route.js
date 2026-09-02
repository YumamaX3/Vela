import { NextResponse } from "next/server";
import { getProxyPoolById, updateProxyPool } from "@/models";
import { testPoolReachability } from "@/lib/network/proxyTest";

// POST /api/proxy-pools/[id]/test - Test proxy pool entry
//
// v0.9.42: this route carried its own copy of the relay test and its own idea
// of what a failure meant, while proxyFleet's health sweep carried a different
// one — and the sweep's copy called a symbol that was never imported, so it
// judged EVERY pool dead every five minutes. A manual test here would revive a
// pool; the next sweep liquidated it again. Two verdicts, one fleet, a flicker.
//
// Both paths now go through testPoolReachability, which is type-aware (relays
// are probed through their envelope, not CONNECTed through) and returns a
// three-state verdict. isActive is touched ONLY on a deterministic result:
//   alive         → activate
//   dead          → deactivate
//   indeterminate → leave the operator's own choice alone, report honestly
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const proxyPool = await getProxyPoolById(id);

    if (!proxyPool) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    const result = await testPoolReachability(proxyPool);
    const now = new Date().toISOString();

    // Only a deterministic verdict may move isActive. An indeterminate one
    // records what happened without overwriting the operator's intent —
    // otherwise a flaky probe target silently disables a working pool.
    const updates = {
      testStatus: result.verdict === "alive"
        ? "active"
        : result.verdict === "dead"
          ? "error"
          : "unknown",
      lastTestedAt: now,
      lastError: result.verdict === "alive"
        ? null
        : (result.error || `Proxy test failed with status ${result.status}`),
    };
    if (result.verdict !== "indeterminate") updates.isActive = result.verdict === "alive";

    await updateProxyPool(id, updates);

    return NextResponse.json({
      ok: result.verdict === "alive",
      verdict: result.verdict,
      status: result.status,
      statusText: result.statusText || null,
      error: result.error || null,
      elapsedMs: result.elapsedMs || 0,
      testedAt: now,
      // Tells the UI whether the pool's enabled state was actually changed,
      // so an indeterminate result is not mistaken for a pass or a disable.
      activeStateChanged: Object.prototype.hasOwnProperty.call(updates, "isActive"),
    });
  } catch (error) {
    console.log("Error testing proxy pool:", error);
    return NextResponse.json({ error: "Failed to test proxy pool" }, { status: 500 });
  }
}
