// POST /api/settings/database/import — the Settings Observatory's Import /
// Merge gate. Differs from the legacy /api/settings/database POST (full
// restore): this route is SCOPE-AWARE.
//
//   body: { payload, mode: "merge"|"replace", scopes: string[], password,
//           dryRun?: boolean }
//
//   scopes  — which domains to bring in: providers | apiKeys | combos |
//             settings | usage. Only selected tables are touched; everything
//             else keeps its current rows verbatim.
//   merge   — add missing rows (INSERT OR IGNORE by id); existing rows keep
//             every current value including keyHash.
//   replace — wipe ONLY the selected tables, then insert the file's rows.
//
// Safety rails (the preview's "safe by design" callout, made law):
//   • An encrypted backup is taken BEFORE any write; a backup failure aborts
//     the import rather than leaving the write unguarded.
//   • Plaintext API keys are never imported — the key column gets a
//     placeholder; existing rows keep their own keyHash on conflict.
//   • Settings ride RESTORE_QUARANTINED_SETTING_KEYS — password/SSO never
//     cross a scope import.
//   • Dry-run returns the per-table diff without writing.
//
// ADAPTER CONTRACT: portable surface only (db.all/db.run via getAdapter) —
// never db.prepare (sql.js/mysql have no public prepare).
import { NextResponse } from "next/server";
import { exportDb, getSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { runBackup } from "@/lib/db/repos/backupRepo.js";
import { getAdapter } from "@/lib/db/driver.js";
import { quarantineSettingsPayload } from "@/lib/db/repos/backupSecurity.js";
import { updateSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

const CLI_TOKEN_HEADER = "x-vela-cli-token";
const PASSWORD_HEADER = "x-9r-password";

const SCOPES = ["providers", "apiKeys", "combos", "settings", "usage"];

function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

function sanitizeScopes(raw) {
  if (!Array.isArray(raw)) return [];
  return SCOPES.filter((s) => raw.includes(s));
}

/** Per-table dry-run diff: how many incoming rows are new vs already present. */
async function diffTables(payload, scopes) {
  const db = await getAdapter();
  const out = {};

  const countFor = async (table, rows) => {
    let existing = [];
    try {
      existing = db.all(`SELECT id FROM ${table}`).map((r) => String(r.id));
    } catch {
      // Table absent in this posture — treat as empty (every row would be new).
    }
    const have = new Set(existing);
    let fresh = 0;
    let same = 0;
    for (const row of rows) {
      if (have.has(String(row?.id))) same += 1;
      else fresh += 1;
    }
    out[table] = { total: rows.length, newRows: fresh, sameRows: same };
  };

  if (scopes.includes("providers")) {
    await countFor("providerConnections", payload.providerConnections || []);
    await countFor("providerNodes", payload.providerNodes || []);
  }
  if (scopes.includes("apiKeys")) await countFor("apiKeys", payload.apiKeys || []);
  if (scopes.includes("combos")) await countFor("combos", payload.combos || []);
  if (scopes.includes("usage")) {
    await countFor("usageHistory", payload.usageHistory || []);
    await countFor("usageDaily", payload.usageDaily || []);
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function jsonSafe(obj) {
  try {
    return JSON.stringify(obj ?? null);
  } catch {
    return "null";
  }
}

/** Merge mode — upsert incoming rows without touching what is already there. */
async function mergeScoped(payload, scopes) {
  const db = await getAdapter();
  const now = nowIso();

  db.transaction(() => {
    if (scopes.includes("providers")) {
      for (const c of payload.providerConnections || []) {
        const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
        db.run(
          `INSERT OR IGNORE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, provider, authType || "oauth", name || null, email || null, priority ?? null, isActive === false ? 0 : 1, jsonSafe(rest), createdAt || now, updatedAt || now]
        );
      }
      for (const n of payload.providerNodes || []) {
        const { id, type, name, createdAt, updatedAt, ...rest } = n;
        db.run(
          `INSERT OR IGNORE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
          [id, type || null, name || null, jsonSafe(rest), createdAt || now, updatedAt || now]
        );
      }
    }

    if (scopes.includes("apiKeys")) {
      for (const k of payload.apiKeys || []) {
        // Plaintext keys are NEVER imported — placeholder key column; an
        // existing row keeps its own identity entirely (OR IGNORE).
        const safeKey = typeof k.key === "string" && /^restored-|^merged-/.test(k.key) ? k.key : `merged-${k.id}`;
        db.run(
          `INSERT OR IGNORE INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
          [k.id, safeKey, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || now]
        );
      }
    }

    if (scopes.includes("combos")) {
      for (const c of payload.combos || []) {
        db.run(
          `INSERT OR IGNORE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
          [c.id, c.name || null, c.kind || null, jsonSafe(c.models || []), c.createdAt || now, c.updatedAt || now]
        );
      }
    }

    if (scopes.includes("usage")) {
      for (const h of payload.usageHistory || []) {
        db.run(
          `INSERT OR IGNORE INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status, tokens, meta)
           VALUES(?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [h.id, h.timestamp, h.provider || "", h.model || "", h.connectionId || "", h.keyId || "", h.keyPrefix ?? null, h.endpoint ?? null, h.promptTokens ?? 0, h.completionTokens ?? 0, h.cost ?? 0, h.status ?? null, jsonSafe(h.tokens ?? null), jsonSafe(h.meta ?? null)]
        );
      }
      for (const d of payload.usageDaily || []) {
        db.run(`INSERT OR IGNORE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [d.dateKey, jsonSafe(d.data ?? {})]);
      }
    }
  });
}

/** Replace mode — wipe ONLY the selected tables, then insert incoming rows. */
async function replaceScoped(payload, scopes) {
  const db = await getAdapter();

  db.transaction(() => {
    if (scopes.includes("providers")) {
      db.run(`DELETE FROM providerConnections`);
      db.run(`DELETE FROM providerNodes`);
      for (const c of payload.providerConnections || []) {
        const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
        db.run(
          `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, provider, authType || "oauth", name || null, email || null, priority ?? null, isActive === false ? 0 : 1, jsonSafe(rest), createdAt || nowIso(), updatedAt || nowIso()]
        );
      }
      for (const n of payload.providerNodes || []) {
        const { id, type, name, createdAt, updatedAt, ...rest } = n;
        db.run(
          `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
          [id, type || null, name || null, jsonSafe(rest), createdAt || nowIso(), updatedAt || nowIso()]
        );
      }
    }

    if (scopes.includes("apiKeys")) {
      db.run(`DELETE FROM apiKeys`);
      for (const k of payload.apiKeys || []) {
        const safeKey = typeof k.key === "string" && /^restored-|^merged-/.test(k.key) ? k.key : `restored-${k.id}`;
        db.run(
          `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, keyVersion, keyHash, keyPrefix)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [k.id, safeKey, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || nowIso(), k.keyVersion ?? null, k.keyHash ?? null, k.keyPrefix ?? null]
        );
      }
    }

    if (scopes.includes("combos")) {
      db.run(`DELETE FROM combos`);
      for (const c of payload.combos || []) {
        db.run(
          `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
          [c.id, c.name || null, c.kind || null, jsonSafe(c.models || []), c.createdAt || nowIso(), c.updatedAt || nowIso()]
        );
      }
    }

    if (scopes.includes("usage")) {
      db.run(`DELETE FROM usageHistory`);
      db.run(`DELETE FROM usageDaily`);
      for (const h of payload.usageHistory || []) {
        db.run(
          `INSERT INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status, tokens, meta)
           VALUES(?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [h.id, h.timestamp, h.provider || "", h.model || "", h.connectionId || "", h.keyId || "", h.keyPrefix ?? null, h.endpoint ?? null, h.promptTokens ?? 0, h.completionTokens ?? 0, h.cost ?? 0, h.status ?? null, jsonSafe(h.tokens ?? null), jsonSafe(h.meta ?? null)]
        );
      }
      for (const d of payload.usageDaily || []) {
        db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`, [d.dateKey, jsonSafe(d.data ?? {})]);
      }
    }
  });
}

/**
 * Merge-mode settings overlay: apply non-quarantined keys onto CURRENT values
 * (quarantine list strips password/SSO). Replace-mode settings are treated the
 * same way — the dashboard password and SSO config are identity, not data, and
 * never ride a scope import.
 */
async function importScopedSettings(incomingSettings) {
  if (!incomingSettings || typeof incomingSettings !== "object" || Array.isArray(incomingSettings)) return;
  const clean = quarantineSettingsPayload(incomingSettings);
  delete clean.password; // defense-in-depth — the quarantine already covers it
  delete clean.mitmSudoEncrypted;
  delete clean.oidcClientSecret;
  await updateSettings(clean);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { password, mode = "merge", scopes: rawScopes, dryRun = false, payload } = body;

    if (!isCliRequest(request) && !(await verifyDashboardPassword(password))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ error: "Missing or invalid payload" }, { status: 400 });
    }
    const scopes = sanitizeScopes(rawScopes);
    if (scopes.length === 0) {
      return NextResponse.json({ error: "Select at least one scope to import" }, { status: 400 });
    }
    const effectiveMode = mode === "replace" ? "replace" : "merge";

    // ── Dry-run — read-only diff, no backup, no write ──────────────────────
    if (dryRun) {
      const diff = await diffTables(payload, scopes);
      return NextResponse.json({ dryRun: true, mode: effectiveMode, scopes, tables: diff });
    }

    // ── Auto-backup BEFORE any write (fail-closed) ─────────────────────────
    if (!isCliRequest(request)) {
      try {
        await runBackup({ trigger: "pre-import" });
      } catch (err) {
        return NextResponse.json(
          { error: `Pre-import backup failed — import aborted (${err?.message || "unknown"})` },
          { status: 500 }
        );
      }
    }

    // ── Write ───────────────────────────────────────────────────────────────
    if (effectiveMode === "replace") {
      await replaceScoped(payload, scopes);
    } else {
      await mergeScoped(payload, scopes);
    }
    if (scopes.includes("settings")) {
      await importScopedSettings(payload.settings);
      try {
        applyOutboundProxyEnv(await getSettings());
      } catch (err) {
        console.warn("[ImportMerge] proxy env re-apply failed:", err?.message);
      }
    }

    return NextResponse.json({
      success: true,
      mode: effectiveMode,
      scopes,
      backedUp: !isCliRequest(request),
    });
  } catch (error) {
    console.log("Error in scoped database import:", error?.message);
    const overBound = String(error?.message || "").includes("restore bound");
    return NextResponse.json(
      { error: error?.message || "Failed to import" },
      { status: overBound ? 413 : 400 }
    );
  }
}
