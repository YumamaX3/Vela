import { NextResponse } from "next/server";
import { disableTailscale } from "@/lib/tunnel";
import { getSettings } from "@/lib/localDb";
import { configureTunnelMonitoring } from "@/shared/services/initializeApp";
import * as log from "@/sse/utils/logger.js";

export async function POST() {
  try {
    const result = await disableTailscale();
    getSettings()
      .then(configureTunnelMonitoring)
      .catch((error) => log.warn("TUNNEL", "Tailscale monitor update failed:", error.message));
    return NextResponse.json(result);
  } catch (error) {
    log.error("TUNNEL", "Tailscale disable error:", (error?.message ?? error));
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
