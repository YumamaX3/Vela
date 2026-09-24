import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { IMPORT_SECTIONS } from "@/lib/db/repos/backupSecurity.js";

const CLI_TOKEN_HEADER = "x-vela-cli-token";
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
    // S2 (Storage Covenant Wave B2 + M0 Tag 2): exportDb({ redact: true }) —
    // this plaintext surface can never hand out SECRET_SETTING_KEYS, upstream
    // connection credentials (CONNECTION_SECRET_FIELDS), or gateway key
    // material (apiKeys.key is always NULL in exports). The completeness law
    // still holds for every non-secret field. The encrypted backup artifact
    // path (runBackup) and mirror resync stay full-fidelity — they are NOT
    // plaintext surfaces.
    const payload = await exportDb({ redact: true });
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { password, adoptSecrets, sections, dryRun, ...payload } = await request.json();
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
    // Selective restore (the sections law). Unknown names are refused BY NAME,
    // never silently dropped — a typo'd section name that silently narrowed the
    // wipe would be a lie told at the moment trust is extended. An absent
    // selection is the historical whole-restore, byte-identical to before.
    let sectionSelection = null;
    if (typeof sections !== "undefined" && sections !== null) {
      if (!Array.isArray(sections) || sections.some((s) => typeof s !== "string")) {
        return NextResponse.json({ error: "sections must be an array of section names" }, { status: 400 });
      }
      const unknown = [...new Set(sections)].filter((s) => !IMPORT_SECTIONS.includes(s));
      if (unknown.length > 0) {
        return NextResponse.json(
          { error: `Unknown section(s): ${unknown.join(", ")} — valid sections: ${IMPORT_SECTIONS.join(", ")}` },
          { status: 400 }
        );
      }
      sectionSelection = sections;
    }
    if (typeof dryRun !== "undefined" && typeof dryRun !== "boolean") {
      return NextResponse.json({ error: "dryRun must be a boolean" }, { status: 400 });
    }
    const wantsDryRun = dryRun === true;
    const result = await importDb(payload, {
      adoptSecrets: adoptSecrets === true,
      sections: sectionSelection,
      dryRun: wantsDryRun,
    });
    // The dry run writes NOTHING — proxy env re-application and the applied
    // report below are restore-only concerns.
    if (wantsDryRun) {
      return NextResponse.json({ success: true, dryRun: true, plan: result.plan, _meta: result._meta });
    }

    // Ensure proxy settings take effect immediately after a DB import.
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    return NextResponse.json({
      success: true,
      appliedSections: result.appliedSections ?? null,
      appliedRows: result.appliedRows ?? null,
    });
  } catch (error) {
    console.log("Error importing database:", error);
    const overBound = String(error?.message || "").includes("restore bound");
    return NextResponse.json(
      { error: error?.message || "Failed to import database" },
      { status: overBound ? 413 : 400 }
    );
  }
}
