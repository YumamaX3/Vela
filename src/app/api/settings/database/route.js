import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb } from "@/lib/localDb";
import { exportBackup } from "@/lib/db/repos/backupRepo";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { IMPORT_SECTIONS, projectPayloadToSections, normalizeBackupScope } from "@/lib/db/repos/backupSecurity.js";
import * as log from "@/sse/utils/logger.js";

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
    //
    // The selective export (the Data cockpit's export studio): `?sections=a,b`
    // narrows the file to the SAME seven partitions the import understands —
    // one vocabulary, so a file exported here is a file importable there. An
    // absent/empty selection is the whole-database export, byte-identical to
    // the historical surface.
    const { searchParams } = new URL(request.url);

    // SCOPED BACKUP ARTIFACT. `?scope=<json|urlencoded>` (e.g.
    // ?scope={"sections":["providers"],"providers":["openai"]}) returns an
    // artifact-ready object declared by its manifest instead of the bare
    // payload; `?preview=1` answers that manifest and WRITES NOTHING.
    // `?sections=` (below) remains the legacy whole-database crop and is
    // byte-identical to before when absent.
    const rawScope = searchParams.get("scope");
    const wantsPreview = searchParams.get("preview") === "1";
    if (rawScope !== null || wantsPreview) {
      let scope = null;
      if (rawScope) {
        try {
          scope = normalizeBackupScope(JSON.parse(rawScope));
        } catch (err) {
          return NextResponse.json({ error: `Invalid scope: ${err.message}` }, { status: 400 });
        }
      }
      const artifact = await exportBackup({ scope, persistDefault: searchParams.get("persistDefault") === "1" });
      if (wantsPreview) {
        // The manifest is a pure function of the payload — nothing is written.
        return NextResponse.json({ preview: true, ...artifact.manifest });
      }
      return NextResponse.json(artifact);
    }

    const raw = searchParams.get("sections");
    let selected = null;
    if (raw) {
      const wanted = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
      const unknown = wanted.filter((s) => !IMPORT_SECTIONS.includes(s));
      if (unknown.length > 0) {
        return NextResponse.json(
          { error: `Unknown section(s): ${unknown.join(", ")} — valid sections: ${IMPORT_SECTIONS.join(", ")}` },
          { status: 400 }
        );
      }
      if (wanted.length > 0) selected = wanted;
    }
    const payload = await exportDb({ redact: true });
    if (selected) {
      const filtered = await projectPayloadToSections(payload, selected);
      return NextResponse.json(filtered);
    }
    return NextResponse.json(payload);
  } catch (error) {
    log.info("SETTINGS", "Error exporting database:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { password, adoptSecrets, sections, dryRun, velaBackup, manifest: artifactManifest, payload: artifactPayload } = body;
    let { scope: restoreScope } = body;
    // A scoped backup ARTIFACT (produced by /api/backup/export or GET ?scope=)
    // wraps its payload; the manifest's scope is the restore's law. A bare
    // payload keeps the historical shape (everything else rides as payload).
    const payload = {};
    if (velaBackup === true && artifactPayload && typeof artifactPayload === "object") {
      Object.assign(payload, artifactPayload);
      if (restoreScope === undefined || restoreScope === null) restoreScope = artifactManifest?.scope ?? null;
    } else {
      for (const [k, v] of Object.entries(body)) {
        if (["password", "adoptSecrets", "sections", "dryRun"].includes(k)) continue;
        payload[k] = v;
      }
      delete payload.scope;
    }
    // An explicit caller scope and the scope a scoped artifact DECLARES both
    // ride into importDb, which refuses when they disagree (sameScope).
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
    // An explicit caller scope must be well-formed — a typo never widens a wipe.
    let scopeSelection = null;
    if (restoreScope !== undefined && restoreScope !== null) {
      try {
        scopeSelection = normalizeBackupScope(restoreScope);
      } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
    }
    const result = await importDb(payload, {
      adoptSecrets: adoptSecrets === true,
      sections: sectionSelection,
      dryRun: wantsDryRun,
      scope: scopeSelection,
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
      log.warn("SETTINGS", "[DatabaseImport] Failed to re-apply outbound proxy env:", (err?.message ?? err));
    }

    return NextResponse.json({
      success: true,
      appliedSections: result.appliedSections ?? null,
      appliedRows: result.appliedRows ?? null,
      scope: result.scope ?? null,
    });
  } catch (error) {
    log.info("SETTINGS", "Error importing database:", (error?.message ?? error));
    const overBound = String(error?.message || "").includes("restore bound");
    return NextResponse.json(
      { error: error?.message || "Failed to import database" },
      { status: overBound ? 413 : 400 }
    );
  }
}
