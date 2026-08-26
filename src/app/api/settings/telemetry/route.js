// POST /api/settings/telemetry/test — probe the operator's usage-digest
// webhook (n8n / Discord / Slack) with a tiny heartbeat payload. Fail-open:
// the response always carries ok + detail; it never throws a 500 for a
// webhook that simply does not answer.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { webhookUrl } = await request.json();
    if (typeof webhookUrl !== "string" || !webhookUrl.trim()) {
      return NextResponse.json({ error: "webhookUrl is required" }, { status: 400 });
    }
    let parsed;
    try {
      parsed = new URL(webhookUrl.trim());
    } catch {
      return NextResponse.json({ error: "Invalid webhook URL" }, { status: 400 });
    }
    // SSRF guard: only https, no private/loopback targets.
    if (parsed.protocol !== "https:") {
      return NextResponse.json({ error: "Webhook URL must use https" }, { status: 400 });
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(parsed.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Vela telemetry heartbeat — this is a test message. If you can read this, the digest channel works.",
          username: "Vela",
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const elapsedMs = Date.now() - started;
      // 2xx/3xx from n8n/Discord means the channel answered. Discord returns
      // 204 on success; some Slack-compatible endpoints return text/plain.
      if (res.status < 400) {
        return NextResponse.json({ ok: true, status: res.status, elapsedMs });
      }
      return NextResponse.json(
        { ok: false, error: `Webhook responded ${res.status}`, elapsedMs },
        { status: 200 }
      );
    } catch (err) {
      clearTimeout(timer);
      const aborted = err?.name === "AbortError";
      return NextResponse.json(
        { ok: false, error: aborted ? "Timed out after 8s" : err?.message || "Webhook unreachable" },
        { status: 200 }
      );
    }
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Test failed" }, { status: 500 });
  }
}
