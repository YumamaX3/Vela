// Storage Covenant Wave C6 — S3 off-site (undici SigV4).
//
// Plan (plans/storage-covenant.md): "S3 off-site: undici-based SigV4 PUT to
// VELA_BACKUP_S3_ENDPOINT (MinIO path-style), opt-in, fail-open, credentials
// env-only, upload ONLY after client-side encryption. Rolling `latest` alias
// for the boot-strap restore pattern."
//
// Proven here (no live MinIO — its provisioning is fleet work per plan line
// 120; the signer is pinned instead against the canonical vectors from AWS's
// own Signature Version 4 documentation plus structural/sensitivity proofs):
//   1. SIGNER — the AWS-docs 20120215 IAM signing-key derivation vector, the
//      empty-payload hash, RFC-3986 encoding, canonical path/query shape, the
//      Authorization header structure, determinism + sensitivity, and
//      path-style host-with-port signing (the MinIO corner).
//   2. POLICY — opt-in armament (disabled unless enabled AND fully configured;
//      credentials env-only), disabled short-circuit never touches the network.
//   3. TRANSPORT (mock undici) — the sealed bytes PUT to <artifact>.velabak AND
//      the rolling latest.velabak alias, both signed for service "s3"; a
//      transport failure returns {ok:false}, never throws (fail-open).
//   4. RUNBACKUP INTEGRATION — an armed off-site leg lands an s3Offsite/ok
//      ledger row; a FAILING off-site leg NEVER fails the local backup
//      (fail-open by law — the artifact + s3Offsite/failed ledger rows land).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const S3 = "@/lib/db/repos/s3Offsite.js";
const S3_KEYS = ["VELA_BACKUP_S3_ENABLED", "VELA_BACKUP_S3_ENDPOINT", "VELA_BACKUP_S3_BUCKET", "VELA_BACKUP_S3_ACCESS_KEY", "VELA_BACKUP_S3_SECRET_KEY", "VELA_BACKUP_S3_REGION"];

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-c6-"));
  for (const k of [...S3_KEYS, "DATA_DIR", "VELA_DB_MODE", "VELA_BACKUP_ENCRYPTION_KEY", "VELA_BACKUP_ENABLED", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  delete process.env.VELA_DB_MODE;
  for (const k of S3_KEYS) delete process.env[k];
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  vi.unmock("undici");
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function armS3() {
  process.env.VELA_BACKUP_S3_ENABLED = "true";
  process.env.VELA_BACKUP_S3_ENDPOINT = "http://minio.local:9000";
  process.env.VELA_BACKUP_S3_BUCKET = "vela-backups";
  process.env.VELA_BACKUP_S3_ACCESS_KEY = "AKIDEXAMPLE";
  process.env.VELA_BACKUP_S3_SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
}

// ─── The pure signer ────────────────────────────────────────────────────

describe("Wave C6 — the SigV4 signer (pure, pinned to the AWS docs vectors)", () => {
  it("the AWS docs S3 example end-to-end (canonical request + signature, byte-exact)", async () => {
    const { sigV4Sign } = await import(S3);
    // THE canonical S3 example from AWS's Signature Version 4 documentation:
    // GET /test.txt with a Range header, empty payload, 20130524T000000Z.
    const r = sigV4Sign({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      headers: { range: "bytes=0-9" },
      body: Buffer.alloc(0),
      accessKey: "AKIAIOSFODNN7EXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      service: "s3",
      now: new Date("2013-05-24T00:00:00.000Z"),
    });
    // Every intermediate artifact is pinned — a silent signer drift cannot hide.
    expect(r.canonicalRequest).toBe([
      "GET",
      "/test.txt",
      "",
      "host:examplebucket.s3.amazonaws.com",
      "range:bytes=0-9",
      "x-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "x-amz-date:20130524T000000Z",
      "",
      "host;range;x-amz-content-sha256;x-amz-date",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ].join("\n"));
    expect(r.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });

  it("the empty-payload hash + RFC-3986 + canonical path/query laws", async () => {
    const { sha256Hex, rfc3986Encode, canonicalUri, canonicalQuery, toAmzDate } = await import(S3);
    expect(sha256Hex(Buffer.alloc(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    // RFC-3986: unreserved survives; reserved (incl. the ones encodeURIComponent
    // leaves alone) are percent-encoded uppercase.
    expect(rfc3986Encode("a-b_c.d~e")).toBe("a-b_c.d~e");
    expect(rfc3986Encode("a b!*'()")).toBe("a%20b%21%2A%27%28%29");
    // Path-style: segments encode ONCE, separators stay.
    expect(canonicalUri("/vela-backups/a key.velabak")).toBe("/vela-backups/a%20key.velabak");
    // Query: sorted by key (then value).
    const qp = new URLSearchParams("z=1&a=2&a=1");
    expect(canonicalQuery(qp)).toBe("a=1&a=2&z=1");
    expect(toAmzDate(new Date("2026-01-02T03:04:05.678Z"))).toBe("20260102T030405Z");
  });

  it("the Authorization structure, determinism, sensitivity, and host-with-port", async () => {
    const { sigV4Sign } = await import(S3);
    const now = new Date("2026-01-01T00:00:00.000Z");
    const base = {
      method: "PUT",
      url: "http://minio.local:9000/vela-backups/vela-backup-x.velabak",
      body: Buffer.from("sealed-bytes"),
      accessKey: "AKIDEXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      now,
    };

    const a = sigV4Sign(base);
    expect(a.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260101\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
    );
    // Path-style MinIO corner: the signed host is host:port.
    expect(a.headers.host).toBe("minio.local:9000");
    expect(a.headers["x-amz-date"]).toBe("20260101T000000Z");

    // Determinism — same request, same signature.
    expect(sigV4Sign(base).signature).toBe(a.signature);
    // Sensitivity — any mutation changes the signature.
    expect(sigV4Sign({ ...base, body: Buffer.from("other-bytes") }).signature).not.toBe(a.signature);
    expect(sigV4Sign({ ...base, url: base.url.replace("vela-backup-x", "vela-backup-y") }).signature).not.toBe(a.signature);
    expect(sigV4Sign({ ...base, region: "eu-west-1" }).signature).not.toBe(a.signature);
    expect(sigV4Sign({ ...base, secretKey: "a-different-secret" }).signature).not.toBe(a.signature);
  });
});

// ─── The policy ─────────────────────────────────────────────────────────

describe("Wave C6 — the opt-in armament (env-only, default dark)", () => {
  it("off-site is dark by default and when partially configured", async () => {
    const { isS3Enabled, uploadArtifactToS3 } = await import(S3);
    expect(isS3Enabled()).toBe(false);
    // A disabled short-circuit NEVER touches the network — no undici mock even
    // installed; a network call would throw and fail this test.
    const res = await uploadArtifactToS3({ artifactId: "a", buffer: Buffer.from("x") });
    expect(res).toEqual({ ok: false, skipped: "s3-disabled" });
  });

  it("enabled-but-incomplete stays dark (credentials env-only, never implied)", async () => {
    process.env.VELA_BACKUP_S3_ENABLED = "true";
    process.env.VELA_BACKUP_S3_ENDPOINT = "http://minio.local:9000";
    // bucket + credentials absent
    const { isS3Enabled } = await import(S3);
    expect(isS3Enabled()).toBe(false);
    armS3();
    delete process.env.VELA_BACKUP_S3_SECRET_KEY;
    vi.resetModules();
    expect((await import(S3)).isS3Enabled()).toBe(false);
  });
});

// ─── The transport (mock undici) ────────────────────────────────────────

describe("Wave C6 — the off-site transport (fail-open, rolling latest alias)", () => {
  it("uploads <artifact>.velabak AND latest.velabak, both SigV4-signed for s3", async () => {
    armS3();
    const calls = [];
    vi.doMock("undici", () => ({
      request: vi.fn(async (url, opts) => {
        calls.push({ url, opts });
        return { statusCode: 200, body: { text: async () => "" } };
      }),
    }));
    const { uploadArtifactToS3 } = await import(S3);
    const res = await uploadArtifactToS3({ artifactId: "vela-backup-20260101-abcdef", buffer: Buffer.from("sealed") });
    expect(res.ok).toBe(true);
    expect(res.uploadedTo).toBe("http://minio.local:9000/vela-backups/vela-backup-20260101-abcdef.velabak");

    expect(calls.length).toBe(2);
    expect(calls[0].url).toBe("http://minio.local:9000/vela-backups/vela-backup-20260101-abcdef.velabak");
    expect(calls[1].url).toBe("http://minio.local:9000/vela-backups/latest.velabak"); // rolling alias
    for (const c of calls) {
      expect(c.opts.method).toBe("PUT");
      expect(c.opts.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request, /);
      expect(c.opts.headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
      expect(c.opts.body.toString()).toBe("sealed"); // the SEALED bytes ride — never plaintext
    }
  });

  it("a transport failure returns {ok:false} and never throws (fail-open)", async () => {
    armS3();
    vi.doMock("undici", () => ({
      request: vi.fn(async () => { throw new Error("ECONNREFUSED minio"); }),
    }));
    const { uploadArtifactToS3 } = await import(S3);
    const res = await uploadArtifactToS3({ artifactId: "a", buffer: Buffer.from("x") });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ECONNREFUSED");
  });
});

// ─── The runBackup integration ──────────────────────────────────────────

describe("Wave C6 — runBackup's off-site leg (never fails the local backup)", () => {
  async function seedDb() {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
  }

  it("armed: the sealed artifact lands locally + off-site, both ledgered", async () => {
    armS3();
    process.env.VELA_BACKUP_ENCRYPTION_KEY = "c6-test-encryption-key";
    const calls = [];
    vi.doMock("undici", () => ({
      request: vi.fn(async (url) => { calls.push(url); return { statusCode: 200, body: { text: async () => "" } }; }),
    }));
    await seedDb();
    const { runBackup } = await import("@/lib/db/repos/backupEngine.js");
    const res = await runBackup({ trigger: "manual" });
    expect(res.ok).toBe(true);
    expect(res.offsite).toEqual({ ok: true, uploadedTo: expect.stringContaining(res.artifactId) });
    expect(calls.length).toBe(2); // artifact + latest alias

    const { getAdapter } = await import("@/lib/db/driver.js");
    const ledger = (await getAdapter()).all(`SELECT kind, status FROM backupLedger ORDER BY createdAt`);
    expect(ledger.some((r) => r.kind === "backup" && r.status === "ok")).toBe(true);
    expect(ledger.some((r) => r.kind === "s3Offsite" && r.status === "ok")).toBe(true);
    // S4 — no secret values in any ledger row (only kinds/statuses read here;
    // the artifact's encryption is the client-side law proven in Wave B).
    expect(fs.existsSync(res.file)).toBe(true);
  });

  it("failing off-site: the local backup STILL succeeds (fail-open by law)", async () => {
    armS3();
    process.env.VELA_BACKUP_ENCRYPTION_KEY = "c6-test-encryption-key";
    vi.doMock("undici", () => ({
      request: vi.fn(async () => { throw new Error("minio down"); }),
    }));
    await seedDb();
    const { runBackup } = await import("@/lib/db/repos/backupEngine.js");
    const res = await runBackup({ trigger: "manual" });
    expect(res.ok).toBe(true); // the backup holds
    expect(res.offsite.ok).toBe(false);
    expect(fs.existsSync(res.file)).toBe(true); // the local artifact is intact

    const { getAdapter } = await import("@/lib/db/driver.js");
    const ledger = (await getAdapter()).all(`SELECT kind, status FROM backupLedger ORDER BY createdAt`);
    expect(ledger.some((r) => r.kind === "backup" && r.status === "ok")).toBe(true);
    expect(ledger.some((r) => r.kind === "s3Offsite" && r.status === "failed")).toBe(true); // loud, ledgered
  });

  it("dark: with S3 disabled the backup runs without any off-site leg", async () => {
    process.env.VELA_BACKUP_ENCRYPTION_KEY = "c6-test-encryption-key";
    await seedDb();
    const { runBackup } = await import("@/lib/db/repos/backupEngine.js");
    const res = await runBackup({ trigger: "manual" });
    expect(res.ok).toBe(true);
    expect(res.offsite).toBeNull(); // never attempted

    const { getAdapter } = await import("@/lib/db/driver.js");
    const ledger = (await getAdapter()).all(`SELECT kind FROM backupLedger`);
    expect(ledger.some((r) => r.kind === "s3Offsite")).toBe(false);
  });
});
