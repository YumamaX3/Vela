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
//   probe()      — quick_check, cheap enough to run at every boot.
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
 * Run SQLite's own self-check. quick_check is the boot-time choice: it skips
 * the (expensive) index-vs-table cross-verification that integrity_check does,
 * while still catching malformed pages, broken b-trees and bad headers.
 *
 * Returns { ok, messages } and never throws.
 */
export function probeIntegrity(adapter, { full = false } = {}) {
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
 * Works for logical damage (bad index, one broken table); fails for a damaged
 * header, where the only honest answer is quarantine-and-restart.
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
  const salvagePath = `${filePath}.recovered`;
  const recovered = recoverInto(adapter, salvagePath);
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
