// Storage Covenant Wave B4 — the backup ENGINE (posture-independent).
// The crypto, artifact file I/O, secret-file bundle, and retention pruning are
// the same for every posture — what differs is the DATA (export/import/ledger/
// purge), which dispatches through the backupRepo facade to the posture's
// harbor (sqlite | mysql). Plan line 284: "MySQL posture: JSON export is the
// artifact (engine-portable by construction)".
//
// S5 — crypto spec pinned: scrypt N=2^17/r=8/p=1, per-artifact 16-byte salt +
// 12-byte IV in the header, AES-256-GCM tag verified BEFORE any restore step,
// key material from VELA_BACKUP_ENCRYPTION_KEY only (env), min-entropy check.
// S6 — secret-bundle restore returns restartRequired (SECRET captured at
// dashboardSession module load; the API surfaces + enforces it).
// S7 — artifact files 0600 where honored (Windows ignores mode — documented).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { BACKUPS_DIR, ensureDirs } from "../paths.js";
import { SCHEMA_VERSION } from "../schema.js";
import { getDataDir } from "@/lib/dataDir.js";

const KDF = { N: 2 ** 17, r: 8, p: 1, keyLen: 32 };
const ARTIFACT_MAGIC = "VELABAK1";
const MIN_KEY_ENTROPY_CHARS = 16;

export function artifactsDir() {
  ensureDirs();
  const dir = path.join(BACKUPS_DIR, "artifacts");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** S5 — resolve + validate the backup encryption key. Env-only, loud refusal. */
export function getBackupEncryptionKey() {
  const raw = process.env.VELA_BACKUP_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) {
    throw new Error(
      "[backup] VELA_BACKUP_ENCRYPTION_KEY is not set — the backup engine refuses to run (key loss = unrecoverable backups; set it deliberately)."
    );
  }
  const key = raw.trim();
  if (key.length < MIN_KEY_ENTROPY_CHARS) {
    throw new Error(
      `[backup] VELA_BACKUP_ENCRYPTION_KEY is too short (< ${MIN_KEY_ENTROPY_CHARS} chars) — minimum-entropy validation failed.`
    );
  }
  return key;
}

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, KDF.keyLen, {
    N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 256 * 1024 * 1024,
  });
}

function headerLenBuf(len) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(len, 0);
  return b;
}

/** AES-256-GCM seal. Layout: MAGIC(8) | headerLen(4 BE) | headerJSON | ciphertext | tag(16). */
export function sealArtifact(plainBuffer, passphrase, manifest) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = Buffer.from(
    JSON.stringify({
      v: 1, algo: "aes-256-gcm", kdf: "scrypt",
      N: KDF.N, r: KDF.r, p: KDF.p,
      salt: salt.toString("hex"), iv: iv.toString("hex"),
      manifest,
    }),
    "utf8"
  );
  return Buffer.concat([
    Buffer.from(ARTIFACT_MAGIC, "ascii"),
    headerLenBuf(header.length),
    header,
    ciphertext,
    tag,
  ]);
}

/** AES-256-GCM open — the auth tag is verified BEFORE any restore step (S5). */
export function openArtifact(artifactBuffer, passphrase) {
  if (!Buffer.isBuffer(artifactBuffer) || artifactBuffer.length < 8 + 4 + 16) {
    throw new Error("[backup] artifact is truncated or malformed");
  }
  const magic = artifactBuffer.subarray(0, 8).toString("ascii");
  if (magic !== ARTIFACT_MAGIC) {
    throw new Error("[backup] artifact magic mismatch — not a Vela backup artifact");
  }
  const headerLen = artifactBuffer.readUInt32BE(8);
  if (headerLen <= 0 || 12 + headerLen + 16 > artifactBuffer.length) {
    throw new Error("[backup] artifact header is truncated");
  }
  const header = JSON.parse(artifactBuffer.subarray(12, 12 + headerLen).toString("utf8"));
  if (header.algo !== "aes-256-gcm" || header.kdf !== "scrypt") {
    throw new Error(`[backup] unsupported artifact crypto "${header.algo}/${header.kdf}"`);
  }
  const salt = Buffer.from(header.salt, "hex");
  const iv = Buffer.from(header.iv, "hex");
  const tag = artifactBuffer.subarray(artifactBuffer.length - 16);
  const ciphertext = artifactBuffer.subarray(12 + headerLen, artifactBuffer.length - 16);
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let plain;
  try {
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error(
      "[backup] artifact authentication failed — wrong key or tampered ciphertext (GCM tag mismatch)"
    );
  }
  return { plain, header };
}

// ─── Secret-file bundle (plan line 279, S6) ──────────────────────────────
const SECRET_FILE_NAMES = ["jwt-secret", "api-key-secret", "machine-id"];

export function captureSecretBundle() {
  const files = {};
  for (const name of SECRET_FILE_NAMES) {
    try {
      const p = path.join(getDataDir(), name);
      if (fs.existsSync(p)) files[name] = fs.readFileSync(p).toString("base64");
    } catch {
      // fail-open: a missing/unreadable secret file is not a backup failure
    }
  }
  return { capturedAt: new Date().toISOString(), files };
}

export function restoreSecretBundle(bundle) {
  if (!bundle || typeof bundle !== "object" || typeof bundle.files !== "object") return [];
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const written = [];
  for (const name of SECRET_FILE_NAMES) {
    const b64 = bundle.files[name];
    if (typeof b64 !== "string" || !b64) continue;
    const dest = path.join(dataDir, name);
    const tmp = `${dest}.restore-tmp`;
    fs.writeFileSync(tmp, Buffer.from(b64, "base64"), { mode: 0o600 });
    try { fs.chmodSync(tmp, 0o600); } catch {} // S7 — Windows ignores mode
    fs.renameSync(tmp, dest);
    written.push(name);
  }
  return written;
}

function artifactTimestampSlug() {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

/** Posture-aware facade — dynamic import keeps the engine decoupled. */
async function facade() {
  return await import("./backupRepo.js");
}

/** Run one encrypted backup (any posture). Writes a ledger row. */
export async function runBackup({ trigger = "manual" } = {}) {
  const passphrase = getBackupEncryptionKey();
  const includeRequestDetails = process.env.VELA_BACKUP_INCLUDE_REQUEST_DETAILS === "true";
  const repo = await facade();
  try {
    const payload = await repo.exportDb({ includeRequestDetails });
    const secretBundle = captureSecretBundle();
    const plain = zlib.gzipSync(Buffer.from(JSON.stringify({ payload, secretBundle }), "utf8"), { level: 9 });
    const manifest = {
      created: new Date().toISOString(),
      trigger,
      schemaVersion: SCHEMA_VERSION,
      sourceMode: payload._meta?.sourceMode ?? null,
      secretBundle: Object.keys(secretBundle.files || {}),
      includeRequestDetails,
    };
    const sealed = sealArtifact(plain, passphrase, manifest);
    const artifactId = `vela-backup-${artifactTimestampSlug()}-${crypto.randomBytes(3).toString("hex")}`;
    const file = path.join(artifactsDir(), `${artifactId}.velabak`);
    fs.writeFileSync(file, sealed, { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch {}
    await repo.writeLedger("backup", {
      artifactId,
      sizeBytes: sealed.length,
      schemaVersion: SCHEMA_VERSION,
      sourceMode: manifest.sourceMode,
      meta: { trigger, secretBundleFiles: manifest.secretBundle },
    });
    return { ok: true, artifactId, file, sizeBytes: sealed.length, manifest };
  } catch (err) {
    await repo.writeLedger("failed", { status: "failed", error: err?.message, meta: { trigger } });
    throw err;
  }
}

export function findLatestArtifact() {
  const dir = artifactsDir();
  const entries = fs.readdirSync(dir)
    .filter((n) => n.endsWith(".velabak"))
    .map((n) => ({ name: n, full: path.join(dir, n), mtime: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0] || null;
}

/** Restore one artifact into the LIVE posture (plan line 290):
 *  decrypt+verify tag → gunzip → schema compat → pre-restore safety backup →
 *  importDb into the target posture → ledger. adoptSecrets rides opts. */
export async function restoreBackup({ artifactId, adoptSecrets = false, trigger = "manual" } = {}) {
  const passphrase = getBackupEncryptionKey();
  const dir = artifactsDir();
  const file = artifactId ? path.join(dir, `${artifactId}.velabak`) : findLatestArtifact()?.full;
  if (!file || !fs.existsSync(file)) {
    throw new Error(`[backup] artifact not found${artifactId ? `: ${artifactId}` : " (no artifacts exist)"}`);
  }
  const { plain, header } = openArtifact(fs.readFileSync(file), passphrase); // tag FIRST (S5)
  const envelope = JSON.parse(zlib.gunzipSync(plain).toString("utf8"));
  const payload = envelope.payload;
  if (!payload || typeof payload !== "object") {
    throw new Error("[backup] artifact payload is malformed");
  }

  const payloadVersion = payload?._meta?.schemaVersion ?? 0;
  if (payloadVersion > SCHEMA_VERSION) {
    throw new Error(
      `[backup] artifact schema version ${payloadVersion} is newer than this build (${SCHEMA_VERSION}) — refusing to restore`
    );
  }

  const repo = await facade();
  const mode = (await import("./bind.js")).getDbMode();

  // Pre-restore safety backup — sqlite keeps the hot file copy (VACUUM-style
  // backupDbLite); mysql keeps a JSON snapshot (no VACUUM INTO on a pool).
  // Fail-open either way: the restore proceeds, the manifest flags it.
  let safetyBackup = null;
  try {
    if (mode === "mysql") {
      const snapshot = await repo.exportDb({});
      const snapPath = path.join(dir, `${path.basename(file, ".velabak")}.pre-restore.json.gz`);
      fs.writeFileSync(snapPath, zlib.gzipSync(Buffer.from(JSON.stringify(snapshot), "utf8"), { level: 9 }), { mode: 0o600 });
      try { fs.chmodSync(snapPath, 0o600); } catch {}
      safetyBackup = path.basename(snapPath);
    } else {
      const { makeBackupDir, backupDbLite } = await import("../backup.js");
      const { getAdapter } = await import("../driver.js");
      const db = await getAdapter();
      const dirPath = makeBackupDir("pre-restore");
      safetyBackup = backupDbLite(db, dirPath);
    }
  } catch (err) {
    console.warn("[backup] pre-restore safety backup failed (restore proceeds):", err?.message);
  }

  await repo.importDb(payload, { adoptSecrets });

  // S6 — secret-bundle write-back. Restart REQUIRED afterwards.
  const restoredSecrets = envelope.secretBundle ? restoreSecretBundle(envelope.secretBundle) : [];

  const artifactName = path.basename(file, ".velabak");
  await repo.writeLedger("restore", {
    artifactId: artifactName,
    schemaVersion: payloadVersion,
    sourceMode: header?.manifest?.sourceMode ?? null,
    targetMode: mode,
    meta: { trigger, adoptSecrets, restoredSecrets, safetyBackup: safetyBackup ? String(safetyBackup) : null },
  });

  return {
    ok: true,
    artifactId: artifactName,
    schemaVersion: payloadVersion,
    restoredSecrets,
    restartRequired: restoredSecrets.length > 0, // S6
    safetyBackupTaken: Boolean(safetyBackup),
  };
}

/** Restore drill — decrypt the newest artifact into a SCRATCH sqlite DB.
 *  The payload is engine-portable, so the drill always targets sqlite scratch
 *  (cross-engine restore is proven by the parity suite). The live DB is never
 *  touched. "A backup never restored is a hope." */
export async function runRestoreDrill() {
  const passphrase = getBackupEncryptionKey();
  const latest = findLatestArtifact();
  if (!latest) {
    const repo = await facade();
    await repo.writeLedger("drill", { status: "failed", error: "no artifact found" });
    return { ok: false, skipped: "no-artifact" };
  }
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-drill-"));
  const scratchDbPath = path.join(scratchDir, "drill.sqlite");
  let scratch = null;
  try {
    const { plain } = openArtifact(fs.readFileSync(latest.full), passphrase);
    const envelope = JSON.parse(zlib.gunzipSync(plain).toString("utf8"));
    if (!envelope.payload || typeof envelope.payload !== "object") {
      throw new Error("artifact payload is malformed");
    }

    const { getScratchAdapter } = await import("../driver.js");
    scratch = await getScratchAdapter(scratchDbPath);
    const { TABLES } = await import("../schema.js");

    const expectedTables = Object.keys(TABLES);
    const have = new Set(
      scratch.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((r) => r.name)
    );
    const missingTables = expectedTables.filter((t) => !have.has(t));
    scratch.get(`SELECT data FROM settings WHERE id = 1`);
    scratch.get(`SELECT COUNT(*) AS c FROM apiKeys`);

    if (missingTables.length > 0) {
      throw new Error(`scratch DB missing tables: ${missingTables.join(", ")}`);
    }

    const repo = await facade();
    await repo.writeLedger("drill", {
      artifactId: path.basename(latest.full, ".velabak"),
      schemaVersion: envelope.payload?._meta?.schemaVersion ?? null,
      meta: { tableCensus: expectedTables.length },
    });
    return { ok: true, artifactId: path.basename(latest.full, ".velabak"), tableCensus: expectedTables.length };
  } catch (err) {
    try {
      const repo = await facade();
      await repo.writeLedger("drill", { status: "failed", error: err?.message });
    } catch { /* fail-open — the drill result still returns */ }
    return { ok: false, error: err?.message };
  } finally {
    try { scratch?.instance?.close?.(); } catch {}
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch {}
  }
}

/** Retention pruning (plan line 288): newest per day for retainDaily days +
 *  newest per ISO-week for retainWeekly weeks; prune the rest by mtime. */
export function pruneBackupArtifacts({ retainDaily = 7, retainWeekly = 4 } = {}) {
  const dir = artifactsDir();
  const entries = fs.readdirSync(dir)
    .filter((n) => n.endsWith(".velabak"))
    .map((n) => {
      const full = path.join(dir, n);
      const st = fs.statSync(full);
      return { name: n, full, mtime: st.mtimeMs, day: new Date(st.mtimeMs).toISOString().slice(0, 10) };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const keep = new Set();
  const daysSeen = new Set();
  const weeksSeen = new Set();
  for (const e of entries) {
    if (daysSeen.size < retainDaily && !daysSeen.has(e.day)) daysSeen.add(e.day);
    const d = new Date(e.mtime);
    const thursday = new Date(d.getTime() + 3 * 86400000);
    const week = thursday.toISOString().slice(0, 10);
    if (weeksSeen.size < retainWeekly && !weeksSeen.has(week)) weeksSeen.add(week);
    if (daysSeen.has(e.day) || weeksSeen.has(week)) keep.add(e.name);
  }

  const removed = [];
  for (const e of entries) {
    if (!keep.has(e.name)) {
      try { fs.rmSync(e.full, { force: true }); removed.push(e.name); } catch {}
    }
  }
  return { kept: entries.length - removed.length, removed };
}
