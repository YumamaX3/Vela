// GET /api/security-log?limit&offset&kind&keyId — the ledger, MASKED.
// The manual retention sweep lives at POST /api/security-log/prune — this
// file carries no second delete door.
//
// THE MASKING LAW: a full API key never leaves this surface. A row carries a
// keyId (an identifier, never a secret); in the response that id is reduced to
// the keyPrefix form the dashboard shows everywhere else —
//
//     vela-v1-3f9a…       (the row's own stored keyPrefix, when the key lives)
//     vela-v1-<first4>…   (displayPrefix(keyId) — the apiKeysRepo convention,
//                          when the key has been revoked and its prefix with it)
//
// This mirrors usageRepo's masking (apiKeyMasked = keyPrefix || derived form)
// and the /api/keys list, which already returns rows WITHOUT their full key.
// `keyId` itself is never returned: the masked prefix is the only identity.
//
// Under /api/* this route rides dashboardGuard's deny-by-default branch — JWT,
// a local CLI token, or requireLogin===false. It is a read-only surface.
import { NextResponse } from "next/server";
import {
  listSecurityEvents,
  SECURITY_LOG_MAX_LIMIT,
  SECURITY_LOG_RETENTION_MS,
} from "@/lib/db/repos/securityLogRepo.js";
import { getApiKeyById } from "@/lib/db/repos/apiKeysRepo.js";
import { displayPrefix } from "@/shared/utils/apiKey.js";
import * as log from "@/sse/utils/logger.js";

export const dynamic = "force-dynamic";

const ID_KEY = /^[0-9a-f]{8,64}$/i;

/** keyId → keyPrefix form. Never returns the id. */
async function maskKeyIds(rows) {
  const ids = [...new Set(rows.map((r) => r.keyId).filter(Boolean))];
  const prefixes = new Map();
  await Promise.all(ids.map(async (id) => {
    try {
      const row = await getApiKeyById(id);
      if (row?.keyPrefix) prefixes.set(id, row.keyPrefix);
    } catch {
      // A key that cannot be read still gets the derived form below.
    }
  }));
  return rows.map(({ keyId, ...rest }) => ({
    ...rest,
    keyPrefix: keyId ? (prefixes.get(keyId) || displayPrefix(keyId)) : null,
  }));
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get("limit");
    let limit = 100;
    if (rawLimit !== null) {
      const n = Number.parseInt(rawLimit, 10);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
      }
      limit = Math.min(n, SECURITY_LOG_MAX_LIMIT);
    }
    const rawOffset = searchParams.get("offset");
    let offset = 0;
    if (rawOffset !== null) {
      const n = Number.parseInt(rawOffset, 10);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: "offset must be a non-negative integer" }, { status: 400 });
      }
      offset = n;
    }
    // A keyId filter accepts only the id SHAPE — never a raw key. A pasted
    // `vela-v1-…` string is a malformed id and answers 400, not a silent miss.
    const keyId = searchParams.get("keyId");
    if (keyId !== null && !ID_KEY.test(keyId)) {
      return NextResponse.json({ error: "keyId must be a key id, not a key" }, { status: 400 });
    }

    const page = await listSecurityEvents({
      limit,
      offset,
      kind: searchParams.get("kind") || null,
      keyId: keyId || null,
    });
    const rows = await maskKeyIds(page.rows);
    return NextResponse.json({
      events: rows,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      retentionDays: Math.round(SECURITY_LOG_RETENTION_MS / 86_400_000),
    });
  } catch (error) {
    log.error("API", "Failed to list security log:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to read security log" }, { status: 500 });
  }
}
