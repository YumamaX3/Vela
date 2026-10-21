// DATABASE MAINTENANCE — the harbor's own cockpit.
//
// Storage Covenant: every persistence statement lives in src/lib/db/, so this
// file owns the stats probes, the integrity run, usage pruning, VACUUM and the
// repair hand-off. The route above it keeps auth + HTTP shaping only.
//
// SQLite-only by nature: VACUUM, sqlite_master and page pragmas have no MariaDB
// twin. The maintenance API is a harbor instrument, not a mirrored writer.
import fs from "node:fs";
import { getAdapter } from "../../driver.js";
import { DATA_FILE, BACKUPS_DIR } from "../../paths.js";
import { getIntegrityState, probeIntegrity, healAtBoot } from "../../integrity.js";

function safePragma(db, name) {
  try {
    const row = db.get(`PRAGMA ${name}`);
    if (!row) return null;
    const v = Object.values(row)[0];
    return typeof v === "number" ? v : Number(v);
  } catch {
    return null;
  }
}

function fileBytes(p) {
  return fs.existsSync(p) ? fs.statSync(p).size : 0;
}

export async function getDatabaseStats() {
  const db = await getAdapter();
  const tables = [];
  let tableRows;
  try {
    tableRows = db.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
  } catch (e) {
    tableRows = [];
    tables.push({ name: "(sqlite_master)", error: String(e.message || e).slice(0, 160) });
  }
  for (const t of tableRows) {
    try {
      const c = db.get(`SELECT COUNT(*) AS c FROM "${t.name}"`);
      tables.push({ name: t.name, rows: c ? c.c : 0 });
    } catch (e) {
      tables.push({ name: t.name, error: String(e.message || e).slice(0, 160) });
    }
  }

  const pageCount = safePragma(db, "page_count");
  const freelist = safePragma(db, "freelist_count");
  const pageSize = safePragma(db, "page_size");

  return {
    // The driver name is the adapter's own, never re-derived.
    driver: db.driver,
    file: {
      path: DATA_FILE,
      bytes: fileBytes(DATA_FILE),
      walBytes: fileBytes(`${DATA_FILE}-wal`),
    },
    pages: { count: pageCount, freelist, size: pageSize },
    reclaimableBytes: (freelist || 0) * (pageSize || 0),
    integrity: getIntegrityState(),
    backups: {
      dir: BACKUPS_DIR,
      count: fs.existsSync(BACKUPS_DIR) ? fs.readdirSync(BACKUPS_DIR).length : 0,
    },
    tables,
  };
}

export async function runIntegrityProbe({ full = false } = {}) {
  const db = await getAdapter();
  return { ...probeIntegrity(db, { full: full === true }), checkedAt: new Date().toISOString() };
}

export async function pruneUsage({ days, dryRun = false } = {}) {
  const db = await getAdapter();
  const cutoff = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();

  const before = db.get(`SELECT COUNT(*) AS c FROM usageHistory`).c;
  const doomed = db.get(`SELECT COUNT(*) AS c FROM usageHistory WHERE timestamp < ?`, [cutoff]).c;

  if (!dryRun && doomed > 0) {
    db.run(`DELETE FROM usageHistory WHERE timestamp < ?`, [cutoff]);
    // Daily rollups key on dateKey rather than timestamp; prune the days that
    // now sit entirely before the cutoff.
    try {
      db.run(`DELETE FROM usageDaily WHERE dateKey < ?`, [cutoff.slice(0, 10)]);
    } catch { /* usageDaily shape varies by migration level */ }
  }

  return {
    ok: true,
    dryRun,
    cutoff,
    before,
    matched: doomed,
    after: dryRun ? before : db.get(`SELECT COUNT(*) AS c FROM usageHistory`).c,
    fileBytes: fs.existsSync(DATA_FILE) ? fs.statSync(DATA_FILE).size : null,
  };
}

export async function vacuumDatabase() {
  const db = await getAdapter();
  const before = fileBytes(DATA_FILE);
  // VACUUM cannot run inside a transaction; it is its own statement.
  db.exec("VACUUM");
  const after = fileBytes(DATA_FILE);
  return { ok: true, beforeBytes: before, afterBytes: after, reclaimedBytes: before - after };
}

export async function repairImage() {
  // The adapter is closed by healAtBoot, so the caller MUST restart afterwards.
  const db = await getAdapter();
  const result = healAtBoot(db, DATA_FILE);
  return {
    ...result,
    restartRequired: true,
    message: result.healed
      ? `Salvaged the harbor (${result.action}). Restart the gateway to reopen it cleanly.`
      : `Image unreadable — quarantined to ${result.quarantine?.dir}. Restore a backup, then restart.`,
  };
}
