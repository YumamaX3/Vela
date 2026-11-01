import { NextResponse } from "next/server";
// Responsive Tide P1 — the event-loop-lag instrument. Imported statically
// (it is a Node built-in wrapper with no fs/db tree) so each call sees the
// process singleton the instrumentation hook booted. eventLoopHealth() is
// itself fail-open: it answers `{ available: false }` rather than throwing, so
// the `ok` flag below — the only field the Docker HEALTHCHECK parses — is
// never decided by the instrument's health.
import { eventLoopHealth } from "@/lib/perf/eventLoopMonitor.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  // The lag snapshot must be fresh on every poll — a cached `ok` is not a
  // liveness truth and a cached histogram is a stale one.
  "Cache-Control": "no-store",
};

export async function GET() {
  // `ok` stays first and unconditional: liveness is Vela's ability to answer,
  // not the monitor's ability to measure. eventLoop is purely additive.
  const body = { ok: true };
  try {
    body.eventLoop = eventLoopHealth();
  } catch {
    // Defence in depth — eventLoopHealth already fails open, but the route's
    // promise to its healthcheck consumers outranks any instrument.
    body.eventLoop = { available: false };
  }
  return NextResponse.json(body, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
