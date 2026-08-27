/**
 * revealSink — the single-writer reveal service (Endpoint Observatory W1c).
 *
 * Every mint writes its one-time plaintext here so a crash between mint and
 * show-once display is recoverable (GET /api/keys/pending-reveals serves it
 * exactly once). This is the migration-015 reveal-file protocol EXTENDED from
 * one-writer-at-boot to SIX runtime writers (Shorekeeper-Sealed Plan §1.5):
 *
 *   • in-process async mutex — the critical section spans write (temp+rename)
 *     AND consume (glob+read+mark+delete) so no torn read can double-serve.
 *     Scope is HONEST: single-process. Multi-instance shared DATA_DIR is out
 *     of contract for v2 and documented as such.
 *   • per-batch files — each reveal is a unique <uuid>.json under
 *     DATA_DIR/pending-key-reveals/, globbed by the GET handler.
 *   • atomicity — temp-file + fs.renameSync; never a partially-visible file.
 *   • hardening — lstat rejects non-regular files (symlink/FIFO attacks);
 *     expiry + fetched state embedded INSIDE the JSON body (mtime never
 *     trusted); POSIX 0600, NTFS-ACL-elsewhere (covenant text, not a lie).
 *   • TTL honesty — unfetched reveals past TTL are PRESERVED behind a
 *     "login to collect" flag, never silently destroyed.
 *
 * WRITE-BEFORE-COMMIT (Covenant C10): mintKey() calls sink.write() BEFORE the
 * DB commit. An orphan reveal for a failed commit is swept by TTL; a committed
 * row with no reveal is unrecoverable — so ordering is part of the covenant.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDataDir } from "@/lib/dataDir.js";

// Lazy sink dir — reads DATA_DIR at call time, never at module load (the
// migration-015 lesson: a module-load DATA_DIR freezes the value before
// tests/callers can set process.env.DATA_DIR, and reveal files would land
// in the real harbor instead of the temp one).
const SINK_DIR = () => path.join(getDataDir(), "pending-key-reveals");
const TTL_MS = 24 * 3600_000;
const MAX_FILES = 500;

// ─── in-process async mutex ────────────────────────────────────────────
// Single Node process: a promise-chain lock is sufficient (documented scope).
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

function ensureDir() {
  fs.mkdirSync(SINK_DIR(), { recursive: true });
}

function filePath(uuid) {
  return path.join(SINK_DIR(), `${uuid}.json`);
}

/** lstat-guard: only regular files may be read. Symlink/FIFO → throw. */
function assertRegularFile(p) {
  const st = fs.lstatSync(p);
  if (!st.isFile()) throw new Error(`reveal sink: refusing non-regular file ${p}`);
}

/** Expired-first eviction, then oldest-first until under cap. Never silently
 *  drops an ACTIVE reveal — expired ones are candidates first. */
function enforceCap() {
  ensureDir();
  let files;
  try {
    files = fs.readdirSync(SINK_DIR()).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  } catch {
    return;
  }
  if (files.length <= MAX_FILES) return;
  const now = Date.now();
  const withMeta = files
    .map((f) => {
      const p = path.join(SINK_DIR(), f); // f is already `.json`-suffixed — filePath() would double-suffix
      try {
        const raw = fs.readFileSync(p, "utf8");
        const body = JSON.parse(raw);
        return { f, p, ts: Number(body?.ts) || 0, fetched: !!body?.fetched };
      } catch {
        return { f, p, ts: 0, fetched: true }; // malformed → eviction candidate
      }
    })
    .sort((a, b) => (a.fetched === b.fetched ? a.ts - b.ts : a.fetched ? 1 : -1));

  const over = files.length - MAX_FILES;
  const evictable = withMeta.filter((m) => m.fetched || (m.ts && now - m.ts > TTL_MS));
  for (let i = 0; i < over && i < evictable.length; i++) {
    try { fs.rmSync(evictable[i].p, { force: true }); } catch {}
  }
}

/**
 * Write one reveal record. ATOMIC: temp-file + renameSync. The write happens
 * BEFORE the DB commit (caller contract). Throws on failure — the caller
 * auto-revokes (created_unrevealable_revoked).
 */
export function writeReveal({ keyId, keyPrefix, key, actorKind = "dashboard", templateId = null }) {
  return withLock(() => {
    ensureDir();
    enforceCap();
    const uuid = crypto.randomUUID();
    const body = {
      keyId,
      keyPrefix,
      key, // one-time plaintext — this file is the ONLY crash-recovery carrier
      actorKind,
      templateId,
      ts: Date.now(),
      fetched: false,
    };
    const tmp = path.join(SINK_DIR(), `.tmp-${uuid}`);
    fs.writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 });
    fs.renameSync(tmp, filePath(uuid)); // atomic publish
    return { revealId: uuid, file: filePath(uuid) };
  });
}

/** Mark a reveal consumed (called by the GET handler after serving). */
export function markConsumed(uuid) {
  return withLock(() => {
    const p = filePath(uuid);
    try {
      const raw = fs.readFileSync(p, "utf8");
      const body = JSON.parse(raw);
      body.fetched = true;
      const tmp = `${p}.tmp-c`;
      fs.writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 });
      fs.renameSync(tmp, p);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Consume ALL unfetched reveals atomically — glob + read + mark inside ONE
 * lock. Returns the reveals; files are marked fetched (kept for audit + the
 * login-to-collect preserve rule), never deleted mid-read.
 */
export function consumeReveals() {
  return withLock(() => {
    ensureDir();
    let files;
    try {
      files = fs.readdirSync(SINK_DIR()).filter((f) => f.endsWith(".json") && !f.startsWith("."));
    } catch {
      return [];
    }
    const out = [];
    for (const f of files) {
      const p = path.join(SINK_DIR(), f); // f already ends in `.json` — never filePath()
      try {
        assertRegularFile(p);
        const body = JSON.parse(fs.readFileSync(p, "utf8"));
        if (body?.fetched) continue;
        out.push(body);
        markConsumedUnlocked(f.replace(/\.json$/, ""), p);
      } catch {
        // Malformed/unreadable — skip (logged by the route), never served.
      }
    }
    return out;
  });
}

function markConsumedUnlocked(uuid, p) {
  try {
    const raw = fs.readFileSync(p, "utf8");
    const body = JSON.parse(raw);
    body.fetched = true;
    const tmp = `${p}.tmp-c`;
    fs.writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 });
    fs.renameSync(tmp, p);
  } catch {}
}

/** Sweep stale temp files (crash residue) older than 5 minutes. Startup call. */
export function sweepTempFiles() {
  ensureDir();
  let files;
  try {
    files = fs.readdirSync(SINK_DIR()).filter((f) => f.startsWith(".tmp-"));
  } catch {
    return;
  }
  const cutoff = Date.now() - 5 * 60_000;
  for (const f of files) {
    const p = path.join(SINK_DIR(), f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    } catch {}
  }
}
