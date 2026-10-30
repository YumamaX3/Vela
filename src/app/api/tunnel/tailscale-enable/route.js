import { NextResponse } from "next/server";
import { enableTailscale } from "@/lib/tunnel";
import { getSettings } from "@/lib/localDb";
import { configureTunnelMonitoring } from "@/shared/services/initializeApp";
import * as log from "@/sse/utils/logger.js";

export async function POST() {
  try {
    const result = await enableTailscale();
    getSettings()
      .then(configureTunnelMonitoring)
      .catch((error) => log.warn("TUNNEL", "Tailscale monitor start failed:", error.message));
    return NextResponse.json(result);
  } catch (error) {
    log.error("TUNNEL", "Tailscale enable error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
