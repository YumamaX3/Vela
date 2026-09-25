/**
 * POST /api/network/diagnose — the Network Doctor.
 *
 * Body: { urls?: string[], proxyUrl?: string|null }
 * Runs the full phase sweep (DNS → TCP → TLS → HTTP) over each distinct target
 * plus the harbor's own effective egress identity. Every target crosses the
 * SSRF gate inside the engine; a refused URL returns a refusal verdict, never a
 * dial. ALWAYS_PROTECTED via the /api/network prefix (dashboardGuard).
 */
import { NextResponse } from "next/server";
import { runDoctor, DOCTOR_DEFAULT_TIMEOUT_MS } from "@/lib/network/networkDoctor.js";
import { getSettings } from "@/lib/localDb";

export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const targets = Array.isArray(body?.urls) ? body.urls.filter((u) => typeof u === "string") : [];
    // Default the egress leg to the configured outbound proxy, so "is my proxy
    // really routing?" is answered against the path actually in use.
    let proxyUrl = typeof body?.proxyUrl === "string" ? body.proxyUrl : undefined;
    if (proxyUrl === undefined) {
      const settings = await getSettings();
      proxyUrl = settings?.outboundProxyEnabled && settings?.outboundProxyUrl ? settings.outboundProxyUrl : null;
    }
    const result = await runDoctor({ targets, proxyUrl, timeoutMs: DOCTOR_DEFAULT_TIMEOUT_MS });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API] network/diagnose failed:", error);
    return NextResponse.json({ error: "Diagnostics failed" }, { status: 500 });
  }
}
