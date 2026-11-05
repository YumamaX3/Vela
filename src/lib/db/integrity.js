// INTEGRITY GUARDIAN for the SQLite harbor.
//
// THE DEFECT THIS CLOSES — measured, not theorised:
//   The tree had NO integrity check anywhere. `grep -rn 'integrity_check|
//   quick_check' src` returned nothing, so a database whose image was already
//   malformed booted happily, migrated over the damage, and only surfaced the
//   wound later as a wall of runtime noise:
//
//     [requestDetailsRepo] Batch write failed: SqliteError: database disk image is malformed
//     Failed to save usage stats: SqliteError: database disk image is malformed
//
//   Every one of those failures was fail-open — the gateway kept answering
//   requests while silently losing usage history and request details, and only
//   the console knew. A corrupt harbor must be discovered at the door, not
//   discovered by the first writer who trips on it.
//
// THE CONTRACT:
//   probe()      — FULL integrity_check by default: quick_check skips the
//                  index-vs-table cross-verify that the 11-02/11-04 corruption
//                  class (SQLITE_CORRUPT_INDEX) needed in order to be seen at
//                  all. Measured: ~1.5 s on a 114 MB image — boot-cheap.
//   quarantine() — move the wounded file (and its -wal/-shm siblings) into
//                  backups/quarantine-<ts>/ so nothing is destroyed.
//   recoverInto()— VACUUM INTO a fresh image, salvaging what SQLite can still
//                  read. Best effort: some corruption is readable, some isn't.
//   healAtBoot() — probe → (recover | quarantine) → reopen. Never boot onto a
//                  malformed image.
//   noteRuntimeCorruption() — the ONE counter every buffered/regenerable
//                  writer shares; reports loudly once, then counts.
//
// Everything here is side-effect-light and unit-testable: the pure pieces take
// an adapter, the file pieces take explicit paths.

import fs from "node:fs";
import path from "node:path";
import { BACKUPS_DIR, ensureDirs } from "./paths.js";

/** SQLite error codes that mean "the image itself is damaged". */
const CORRUPT_CODES = new Set([
  "SQLITE_CORRUPT",
  "SQLITE_CORRUPT_VTAB",
  "SQLITE_CORRUPT_INDEX",
  "SQLITE_NOTADB",
]);

/** True when an error is an image-integrity failure rather than a query bug. */
export function isCorruptionError(err) {
  if (!err) return false;
  const code = err.code || err.errcode || "";
  if (CORRUPT_CODES.has(String(code))) return true;
  const msg = String(err.message || err.msg || "");
  return /database disk image is malformed|file is not a database|malformed database schema/i.test(msg);
}

/** Module-level health state — read by /api/settings/database/integrity. */
const state = {
  checkedAt: null,
  healthy: null,
  messages: [],
  bootHeal: null,
  runtimeFailures: 0,
  runtimeLastAt: null,
  runtimeLastMessage: null,
  reportedRuntimeOnce: false,
};

export function getIntegrityState() {
  return { ...state };
}

/**
 * Record a runtime corruption hit. Returns TRUE the first time only — callers
 * use that to emit one loud message instead of one per request.
 *
 * LAYER LAW (why this is not a blanket "swallow corruption" helper):
 *   Fail-open is correct ONLY for buffered, regenerable telemetry —
 *   usage history and request details. Those losses are an observability gap.
 *   A write to a COVENANT-BEARING table (providerConnections, apiKeys,
 *   settings, combo/key definitions, migrations, backups) must THROW: silently
 *   returning "ok" there would let an operator believe a credential was saved
 *   when it was not. Pass `{ failOpen: false }` from any such writer and this
 *   function rethrows instead of counting.
 */
export function noteRuntimeCorruption(err, where = "write", { failOpen = true } = {}) {
  state.runtimeFailures += 1;
  state.runtimeLastAt = new Date().toISOString();
  state.runtimeLastMessage = `${where}: ${String(err?.message || err).slice(0, 200)}`;
  state.healthy = false;
  if (!failOpen) throw err;
  return state.runtimeFailures === 1;
}

export function resetIntegrityStateForTests() {
  state.checkedAt = null;
  state.healthy = null;
  state.messages = [];
  state.bootHeal = null;
  state.runtimeFailures = 0;
  state.runtimeLastAt = null;
  state.runtimeLastMessage = null;
  state.reportedRuntimeOnce = false;
}

/**
 * Run SQLite's own self-check.
 *
 * THE 2026-11-04 CORRECTION (measured on the homelab wreck): the 11-02 and
 * 11-04 corruption episodes were SQLITE_CORRUPT_INDEX class — index b-trees
 * diverged from their table b-trees (child-depth drift, duplicate child
 * pointers). quick_check SKIPS the index-vs-table cross-verification that
 * would have caught them, so an index-blind boot declared a wounded harbor
 * healthy and kept writing on rot. Measured boot cost of the FULL check on a
 * 114 MB image: ~1.5 s (cheaper than quick_check's own ~4.9 s on that store) —
 * boot price is no excuse. `full` now DEFAULTS to true; a caller may still opt
 * into the cheap probe explicitly.
 *
 * Returns { ok, messages } and never throws.
 */
export function probeIntegrity(adapter, { full = true } = {}) {
  const pragma = full ? "integrity_check" : "quick_check";
  let messages;
  try {
    const rows = adapter.all(`PRAGMA ${pragma}`);
    messages = rows.map((r) => Object.values(r)[0]).filter((v) => typeof v === "string");
  } catch (e) {
    // A probe that cannot even run is itself the finding.
    const out = {
      ok: false,
      messages: [`${pragma} failed: ${e.code || "?"} ${String(e.message || e).slice(0, 200)}`],
      pragma,
    };
    state.checkedAt = new Date().toISOString();
    state.healthy = false;
    state.messages = out.messages;
    return out;
  }
  const ok = messages.length === 1 && messages[0].toLowerCase() === "ok";
  const out = { ok, messages: ok ? [] : messages.slice(0, 20), pragma };
  state.checkedAt = new Date().toISOString();
  state.healthy = ok;
  state.messages = out.messages;
  return out;
}

/** Timestamp slug safe for a directory name. */
function tsSlug(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
}

/**
 * Move a database and its WAL siblings aside. Returns the directory used.
 * Nothing is deleted — a wounded harbor is evidence, and the operator may still
 * salvage it with `sqlite3 .recover`.
 */
export function quarantineFile(filePath) {
  ensureDirs();
  const dir = path.join(BACKUPS_DIR, `quarantine-${tsSlug()}`);
  fs.mkdirSync(dir, { recursive: true });
  const moved = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    const src = filePath + suffix;
    if (!fs.existsSync(src)) continue;
    const dest = path.join(dir, path.basename(src));
    try {
      fs.renameSync(src, dest);
      moved.push(dest);
    } catch {
      // Windows can refuse a rename while a handle is open. Fall back to copy,
      // then unlink — the quarantine copy is what matters.
      try {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
        moved.push(dest);
      } catch {
        /* leave it; the caller will report the failure */
      }
    }
  }
  return { dir, moved };
}

/**
 * Salvage a readable subset into a brand-new image via VACUUM INTO.
 * Works for logical damage (bad index, one broken table); fails on the
 * index-corruption class, where the per-table fallback below takes over.
 */
export function recoverInto(adapter, destPath) {
  try {
    try { fs.rmSync(destPath, { force: true }); } catch {}
    const escaped = destPath.replace(/'/g, "''");
    adapter.exec(`VACUUM INTO '${escaped}'`);
    const size = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
    return { ok: size > 0, path: destPath, size };
  } catch (e) {
    return { ok: false, error: `${e.code || "?"} ${String(e.message || e).slice(0, 200)}` };
  }
}

/**
 * Per-table salvage — the fallback engine healAtBoot reaches when VACUUM INTO
 * refuses the image (the 2026-11-04 SQLITE_CORRUPT_INDEX class).
 *
 * MEASURED BASIS: on the homelab wreck this engine recovered every readable
 * table from the very image VACUUM INTO rejected — the only tables left behind
 * were the ones whose TABLE b-trees were themselves gone. Schema, indexes and
 * triggers ride `sqlite_master` DDL verbatim; rows cross one INSERT..SELECT
 * per table, ordered by rowid, inside ONE transaction per table so a mid-table
 * failure abandons only that table. The result is re-probed before the caller
 * trusts it: a salvage output that is itself damaged is not a salvage.
 */
export function salvagePerTable(adapter, destPath, { log = console } = {}) {
  try {
    try { fs.rmSync(destPath, { force: true }); } catch {}
    fs.writeFileSync(destPath, Buffer.alloc(0));
    const escaped = destPath.replace(/'/g, "''");
    adapter.exec(`ATTACH DATABASE '${escaped}' AS salvage`);

    let saved = 0;
    let skipped = 0;
    let total = 0;
    try {
      const objects = adapter.all(
        `SELECT name, sql, type FROM sqlite_master ` +
        `WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL`
      );
      const tables = objects.filter((o) => o.type === "table");
      const postTables = objects.filter((o) => o.type !== "table");
      total = tables.length;

      for (const t of tables) {
        const ident = `"${String(t.name).replace(/"/g, '""')}"`;
        try {
          // Replay the table's ORIGINAL DDL, never CREATE TABLE ... AS SELECT:
          // the AS-SELECT shape copies columns but silently drops every
          // constraint — PRIMARY KEY, UNIQUE, NOT NULL, defaults, foreign
          // keys. A healed image rebuilt that way answers reads and then
          // fails its first keyed write ("ON CONFLICT clause does not match
          // any PRIMARY KEY"), which is a wound swapped for a wound. The
          // original `sql` from sqlite_master carries the constraints
          // verbatim; the INSERT..SELECT below fills it row by row.
          if (t.sql) adapter.exec(String(t.sql).replace(/^CREATE (TABLE|UNIQUE INDEX|INDEX)\s+("[^"]+"|\S+)/i, "CREATE $1 salvage.$2"));
          else adapter.exec(`CREATE TABLE salvage.${ident} AS SELECT * FROM main.${ident} WHERE 0`);
          adapter.transaction(() => {
            adapter.exec(`INSERT INTO salvage.${ident} SELECT * FROM main.${ident} ORDER BY rowid`);
          });
          saved += 1;
        } catch (e) {
          skipped += 1;
          log.warn?.(`[DB] salvage: table ${t.name} unreadable (${String(e?.message || e).slice(0, 120)}) — skipped, not silently lost`);
          try { adapter.exec(`DROP TABLE IF EXISTS salvage.${ident}`); } catch {}
        }
      }

      // Indexes/triggers/views land only from tables that made it across —
      // a broken tree's secondary objects would be rot, not structure.
      for (const o of postTables) {
        const ident = `"${String(o.name).replace(/"/g, '""')}"`;
        try { adapter.exec(o.sql); } catch {}
      }
    } finally {
      try { adapter.exec("DETACH DATABASE salvage"); } catch {}
    }

    const size = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
    if (saved === 0 || size === 0) {
      try { fs.rmSync(destPath, { force: true }); } catch {}
      return { ok: false, error: `no tables recoverable (0/${total})` };
    }
    return { ok: true, path: destPath, size, saved, total, skipped };
  } catch (e) {
    try { fs.rmSync(destPath, { force: true }); } catch {}
    return { ok: false, error: `${e.code || "?"} ${String(e.message || e).slice(0, 200)}` };
  }
}

/**
 * Boot-time heal. Probes the image; on damage it salvages what it can and
 * swaps the salvaged copy into place, otherwise it quarantines and lets the
 * caller create a fresh harbor.
 *
 * `adapter` is the already-open adapter for `filePath`; the caller owns
 * closing/reopening when `reopened` is false.
 */
export function healAtBoot(adapter, filePath, { log = console } = {}) {
  const probe = probeIntegrity(adapter);
  if (probe.ok) {
    state.bootHeal = { at: new Date().toISOString(), action: "none" };
    return { healed: true, action: "none", probe };
  }

  log.warn?.(
    `[DB] integrity check FAILED — the harbor image is damaged: ${probe.messages.join("; ").slice(0, 300)}`
  );

  // 1) Try to salvage into a temp image beside the original.
  //    Two engines, in order — the 2026-11-04 wreck proved why BOTH exist:
  //    (a) VACUUM INTO (fast, native) — but it FAILS on the index-corruption
  //        class, leaving a 0-byte file (the empty data.sqlite.recovered the
  //        operator found). (b) The per-table copy — measured to recover every
  //        readable table (only genuinely damaged trees stay behind), on the
  //        very image VACUUM INTO refuses. The fallback is the difference
  //        between losing ~131,786 rows by default and losing only the trees
  //        that are truly gone.
  const salvagePath = `${filePath}.recovered`;
  let recovered = recoverInto(adapter, salvagePath);
  if (!recovered.ok) {
    const perTable = salvagePerTable(adapter, salvagePath);
    if (perTable.ok) {
      recovered = { ok: true, path: salvagePath, size: perTable.size, engine: "per-table" };
      log.warn?.(
        `[DB] VACUUM INTO failed (${recovered.error ?? "corrupt"}); per-table salvage saved ` +
          `${perTable.saved}/${perTable.total} tables, ${perTable.skipped} skipped (damaged trees)`
      );
    }
  }
  if (recovered.ok) {
    try {
      adapter.close?.();
    } catch {}
    const quarantine = quarantineFile(filePath);
    try {
      fs.renameSync(salvagePath, filePath);
    } catch (e) {
      log.error?.(`[DB] could not install recovered image: ${e.message}`);
      state.bootHeal = { at: new Date().toISOString(), action: "recover-install-failed", quarantine };
      return { healed: false, action: "recover-install-failed", probe, quarantine };
    }
    state.bootHeal = {
      at: new Date().toISOString(),
      action: "recovered",
      bytes: recovered.size,
      engine: recovered.engine ?? "vacuum-into",
      quarantineDir: quarantine.dir,
    };
    log.warn?.(
      `[DB] recovered ${recovered.size} bytes into a fresh image; damaged original kept at ${quarantine.dir}`
    );
    return { healed: true, action: "recovered", reopen: true, probe, quarantine };
  }

  // 2) Salvage impossible — quarantine and start clean rather than migrate over rot.
  try {
    adapter.close?.();
  } catch {}
  const quarantine = quarantineFile(filePath);
  state.bootHeal = { at: new Date().toISOString(), action: "quarantined", quarantineDir: quarantine.dir };
  log.error?.(
    `[DB] image unreadable (${recovered.error}); quarantined to ${quarantine.dir} and starting a fresh harbor. ` +
      `Restore a backup from ${BACKUPS_DIR} if this data matters.`
  );
  return { healed: false, action: "quarantined", reopen: true, probe, quarantine };
}
