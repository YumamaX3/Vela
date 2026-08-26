import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * Lightweight status snapshot — no secrets, no full blob.
 * The Overview dashboard calls this to render KPI cards.
 * ~10KB lighter than GET /api/settings — cacheable, no PII.
 */
export async function GET() {
  try {
    const s = await getSettings();
    const ba = s.budgetAlerts || {};
    const ca = s.capacityAdapter || {};

    return NextResponse.json(
      {
        requireLogin: s.requireLogin === true,
        hasPassword: !!s.hasPassword,
        authMode: s.authMode || "password",
        ssoConfigured: !!(s.oidcConfigured || s.samlEntryPoint),
        outboundProxyActive: s.outboundProxyEnabled === true,
        rtkActive: s.rtkEnabled !== false,
        rtkFiltersActive: [
          s.cavemanEnabled && "caveman",
          s.ponytailEnabled && "ponytail",
          s.pxpipeEnabled && "pxpipe",
          s.headroomEnabled && "headroom",
        ].filter(Boolean),
        alertsActive: !!(ba.discordEnabled || ba.n8nEnabled || ba.weeklyDigestEnabled),
        usageWebhookActive: s.usageWebhookEnabled === true,
        observabilityActive: s.enableObservability === true,
        capacityActive: Object.values(ca).some((c) => c?.enabled === true),
        backupEnabled: !!process.env.VELA_BACKUP_ENABLED,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (error) {
    console.error("Error getting settings status:", error?.message || error);
    return NextResponse.json({ error: "Failed to get settings status" }, { status: 500 });
  }
}