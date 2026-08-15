import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const PASSWORD_HEADER = "x-9r-password";

// CLI token requests are already trusted (local machine); skip password re-auth.
function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

export async function GET(request) {
  try {
    if (!isCliRequest(request) && !(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER)))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    // S2 (Storage Covenant Wave B2): exportDb now redacts SECRET_SETTING_KEYS
    // at the source — this endpoint can never hand out password /
    // mitmSudoEncrypted / oidcClientSecret again. The completeness law still
    // holds for every non-secret field.
    const payload = await exportDb();
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { password, adoptSecrets, ...payload } = await request.json();
    if (!isCliRequest(request) && !(await verifyDashboardPassword(password))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    // S1 (Storage Covenant Wave B2): the payload is HOSTILE input — size bound
    // + shape validation happen inside importDb BEFORE any write. The
    // RESTORE-QUARANTINED fields (password/requireLogin/authMode/oidc*,
    // apiKeys keyHash/isInternal/deletedAt) restore only under an explicit
    // adoptSecrets — the default preserves CURRENT values.
    if (typeof adoptSecrets !== "undefined" && typeof adoptSecrets !== "boolean") {
      return NextResponse.json({ error: "adoptSecrets must be a boolean" }, { status: 400 });
    }
    await importDb(payload, { adoptSecrets: adoptSecrets === true });

    // Ensure proxy settings take effect immediately after a DB import.
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error importing database:", error);
    const overBound = String(error?.message || "").includes("restore bound");
    return NextResponse.json(
      { error: error?.message || "Failed to import database" },
      { status: overBound ? 413 : 400 }
    );
  }
}
