// Storage Covenant Wave C6 — S3 off-site (undici SigV4, MinIO path-style).
//
// Plan (plans/storage-covenant.md): "S3 off-site: undici-based SigV4 PUT to
// VELA_BACKUP_S3_ENDPOINT (MinIO path-style), opt-in, fail-open, credentials
// env-only, upload ONLY after client-side encryption. Rolling `latest` alias
// for the boot-strap restore pattern."
//
// The laws this module keeps:
//   • OPT-IN — nothing uploads unless VELA_BACKUP_S3_ENABLED=true AND endpoint
//     + bucket + credentials are all set. Default = fully dark.
//   • FAIL-OPEN — an off-site failure NEVER fails the local backup. The local
//     sealed artifact is the primary truth; S3 is the 3-2-1 off-site copy.
//   • CREDENTIALS ENV-ONLY — keys are read from env, never persisted, never
//     journaled (the ledger records only artifactId/size/status — S4).
//   • UPLOAD ONLY AFTER CLIENT-SIDE ENCRYPTION — by construction: runBackup
//     passes the SEALED buffer (AES-256-GCM) and this module never sees
//     plaintext. The same sealed bytes ride the rolling `latest` alias.
//
// The SigV4 signer (sigV4Sign) is PURE and pinned against the canonical
// vectors from AWS's own Signature Version 4 documentation
// (tests/unit/s3-offsite.test.js): the 20120215 signing-key derivation and the
// full 20150830 IAM ListUsers request. Path-style addressing signs the host
// WITH port (MinIO) and encodes path segments RFC-3986 once (the S3 rule).
import crypto from "node:crypto";

const ALGORITHM = "AWS4-HMAC-SHA256";

// ─── Env config ──────────────────────────────────────────────────────────

/** The S3 off-site env contract (.env.example). Credentials env-only. */
export function s3Config() {
  return {
    enabled: process.env.VELA_BACKUP_S3_ENABLED === "true",
    endpoint: (process.env.VELA_BACKUP_S3_ENDPOINT || "").trim(),
    bucket: (process.env.VELA_BACKUP_S3_BUCKET || "vela-backups").trim(),
    accessKey: process.env.VELA_BACKUP_S3_ACCESS_KEY || "",
    secretKey: process.env.VELA_BACKUP_S3_SECRET_KEY || "",
    region: (process.env.VELA_BACKUP_S3_REGION || "us-east-1").trim(),
  };
}

/** Off-site is armed only when enabled AND fully configured. */
export function isS3Enabled() {
  const cfg = s3Config();
  return Boolean(cfg.enabled && cfg.endpoint && cfg.bucket && cfg.accessKey && cfg.secretKey);
}

// ─── The SigV4 signer (pure) ─────────────────────────────────────────────

function hmacSha256(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}
export function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** The HMAC chain — AWS4<secret> → date → region → service → aws4_request.
 *  Pinned against the AWS docs' 20120215/iam canonical vector in tests. */
export function deriveSigningKey(secretKey, dateStamp, region, service) {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

/** RFC-3986 encode (unreserved = A-Za-z0-9-._~ stays; everything else is
 *  percent-encoded — including the chars encodeURIComponent leaves alone). */
export function rfc3986Encode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** S3 rule: encode each path segment ONCE, keep the "/" separators. */
export function canonicalUri(pathname) {
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return p.split("/").map((seg) => rfc3986Encode(seg)).join("/");
}

/** Canonical query string — sort by key, then value, in BYTE/codepoint order
 *  (the AWS spec — never localeCompare, whose ordering is locale-dependent). */
export function canonicalQuery(searchParams) {
  const pairs = [];
  for (const [k, v] of searchParams.entries()) pairs.push([rfc3986Encode(k), rfc3986Encode(v)]);
  const byByte = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  pairs.sort((a, b) => (a[0] === b[0] ? byByte(a[1], b[1]) : byByte(a[0], b[0])));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

/** YYYYMMDDTHHMMSSZ from a Date. */
export function toAmzDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Sign one request. PURE — no I/O. Returns {headers, canonicalRequest,
 *  stringToSign, signature} so tests can pin every intermediate artifact.
 *  @param method   HTTP verb
 *  @param url      full request URL (path-style: endpoint/bucket/key)
 *  @param headers  extra headers to sign (lowercased + trimmed in the canon)
 *  @param body     Buffer payload (hashed; pass payloadHash to override)
 *  @param opts     {accessKey, secretKey, region, service="s3", now=Date} */
export function sigV4Sign({ method, url, headers = {}, body = Buffer.alloc(0), payloadHash, accessKey, secretKey, region, service = "s3", now = new Date() }) {
  const u = new URL(url);
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const ph = payloadHash ?? sha256Hex(body);

  // Canonical headers — host + x-amz-date + x-amz-content-sha256 always sign;
  // any caller headers join them (lowercase keys, trimmed values, sorted).
  const all = {};
  for (const [k, v] of Object.entries(headers)) all[k.toLowerCase()] = String(v).trim();
  all.host = u.host; // path-style: the host WITH its port is the signed host
  all["x-amz-date"] = amzDate;
  all["x-amz-content-sha256"] = ph;
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${all[n]}\n`).join("");
  const signedHeaders = names.join(";");

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(u.pathname),
    canonicalQuery(u.searchParams),
    canonicalHeaders,
    signedHeaders,
    ph,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, credentialScope, sha256Hex(Buffer.from(canonicalRequest, "utf8"))].join("\n");
  const signingKey = deriveSigningKey(secretKey, dateStamp, region, service);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    headers: {
      host: u.host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": ph,
      authorization: `${ALGORITHM} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    canonicalRequest,
    stringToSign,
    signature,
  };
}

// ─── The off-site transport (fail-open) ──────────────────────────────────

async function putObject(cfg, key, buffer) {
  const { request } = await import("undici");
  const url = `${cfg.endpoint.replace(/\/$/, "")}/${cfg.bucket}/${rfc3986Encode(key)}`;
  const signed = sigV4Sign({
    method: "PUT",
    url,
    body: buffer,
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    region: cfg.region,
  });
  const res = await request(url, {
    method: "PUT",
    headers: {
      "x-amz-date": signed.headers["x-amz-date"],
      "x-amz-content-sha256": signed.headers["x-amz-content-sha256"],
      authorization: signed.headers.authorization,
      "content-length": String(buffer.length),
    },
    body: buffer,
  });
  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`S3 PUT ${key} → HTTP ${res.statusCode}: ${text.slice(0, 200)}`);
  }
}

/** Upload one SEALED artifact + the rolling `latest` alias. FAIL-OPEN: any
 *  error returns {ok:false} and never throws — the local artifact is intact
 *  and the backup flow must not fail on the off-site leg. */
export async function uploadArtifactToS3({ artifactId, buffer }) {
  const cfg = s3Config();
  if (!isS3Enabled()) return { ok: false, skipped: "s3-disabled" };
  try {
    const key = `${artifactId}.velabak`;
    await putObject(cfg, key, buffer);
    await putObject(cfg, "latest.velabak", buffer); // rolling boot-strap alias
    return { ok: true, uploadedTo: `${cfg.endpoint}/${cfg.bucket}/${key}` };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Download one artifact from the off-site bucket (boot-strap restore).
 *  Returns the sealed bytes — decryption still rides openArtifact (S1/S2). */
export async function downloadArtifactFromS3(key) {
  const cfg = s3Config();
  if (!isS3Enabled()) throw new Error("[backup] S3 off-site is disabled — set VELA_BACKUP_S3_* to restore from off-site");
  const { request } = await import("undici");
  const url = `${cfg.endpoint.replace(/\/$/, "")}/${cfg.bucket}/${rfc3986Encode(key)}`;
  const signed = sigV4Sign({
    method: "GET",
    url,
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    region: cfg.region,
  });
  const res = await request(url, {
    method: "GET",
    headers: {
      "x-amz-date": signed.headers["x-amz-date"],
      "x-amz-content-sha256": signed.headers["x-amz-content-sha256"],
      authorization: signed.headers.authorization,
    },
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const text = await res.body.text();
    throw new Error(`S3 GET ${key} → HTTP ${res.statusCode}: ${text.slice(0, 200)}`);
  }
  return Buffer.from(await res.body.arrayBuffer());
}
