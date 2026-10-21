// GET /api/metrics — Prometheus text exposition (port of 9router-go /metrics).
import { metrics } from "@/lib/metrics.js";

export async function GET() {
  return new Response(metrics.render(), {
    status: 200,
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
