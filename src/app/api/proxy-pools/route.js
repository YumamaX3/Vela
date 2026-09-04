import { NextResponse } from "next/server";
import { createProxyPool, getProviderConnections, getProxyPools } from "@/models";
// v0.9.42: was a local 4-type literal (http|vercel|cloudflare|deno) that
// silently disagreed with lib/constants/proxyTypes.js — which declares six
// types and was imported by nobody. The result: a socks5:// pool URL passed
// the transport layer (proxyFetch.js:241 has had a Socks5ProxyAgent branch
// since v0.9.4) but could never be CREATED, because this literal coerced it
// to "http" in normalizeProxyPoolInput. One shared constant now decides for
// both routes.
import { VALID_PROXY_TYPES } from "@/lib/constants/proxyTypes";
// §5.4 — the read-boundary masker. Applied HERE, never in the repo: proxyFleet
// and connectionProxy read getProxyPools/getProxyPoolById directly and need the
// plaintext url to build a dispatcher. The HTTP layer is the untrusted edge.
// Note this GET is posture-consistent under §5.1, so a remote unauthenticated
// caller reaches it on a requireLogin=false instance — masking is what makes
// that acceptable.
import { maskProxyPoolsForRead, maskProxyPoolForRead, findDuplicateProxyPool, duplicatePoolMarker } from "@/lib/db/repos/proxyRedaction.js";
// §5.5 — the SSRF gate on operator-typed proxyUrl. A pool URL is dialed on EVERY
// proxied request, so it is the highest-leverage operator-controlled fetch target in
// the gateway: unvalidated it could point the server at cloud metadata (169.254.169.254)
// or a non-network scheme. validateProxyPoolUrl is its own function rather than a flag
// on validateProviderTestUrl — see providerUrlSafety.js for the three measured reasons.
import { validateProxyPoolUrl } from "@/lib/network/providerUrlSafety.js";

function toBoolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function normalizeProxyPoolInput(body = {}) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const proxyUrl = typeof body?.proxyUrl === "string" ? body.proxyUrl.trim() : "";
  const noProxy = typeof body?.noProxy === "string" ? body.noProxy.trim() : "";
  const isActive = body?.isActive === undefined ? true : body.isActive === true;
  const strictProxy = body?.strictProxy === true;
  const type = VALID_PROXY_TYPES.includes(body?.type) ? body.type : "http";

  if (!name) {
    return { error: "Name is required" };
  }

  if (!proxyUrl) {
    return { error: "Proxy URL is required" };
  }

  return { name, proxyUrl, noProxy, isActive, strictProxy, type };
}

function buildUsageMap(connections = []) {
  const usageMap = new Map();

  for (const connection of connections) {
    const proxyPoolId = connection?.providerSpecificData?.proxyPoolId;
    if (!proxyPoolId) continue;

    usageMap.set(proxyPoolId, (usageMap.get(proxyPoolId) || 0) + 1);
  }

  return usageMap;
}

// GET /api/proxy-pools - List proxy pools
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const isActive = toBoolean(searchParams.get("isActive"));
    const includeUsage = searchParams.get("includeUsage") === "true";

    const filter = {};
    if (isActive !== undefined) {
      filter.isActive = isActive;
    }

    const proxyPools = await getProxyPools(filter);

    if (!includeUsage) {
      return NextResponse.json({ proxyPools: maskProxyPoolsForRead(proxyPools) });
    }

    const connections = await getProviderConnections();
    const usageMap = buildUsageMap(connections);

    const enrichedProxyPools = proxyPools.map((pool) => ({
      ...pool,
      boundConnectionCount: usageMap.get(pool.id) || 0,
    }));

    return NextResponse.json({ proxyPools: maskProxyPoolsForRead(enrichedProxyPools) });
  } catch (error) {
    console.log("Error fetching proxy pools:", error);
    return NextResponse.json({ error: "Failed to fetch proxy pools" }, { status: 500 });
  }
}

// POST /api/proxy-pools - Create proxy pool
export async function POST(request) {
  try {
    const body = await request.json();
    const normalized = normalizeProxyPoolInput(body);

    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    // §5.5 — SSRF gate, and it runs FIRST among the semantic checks. A refused URL must
    // never reach the duplicate comparison below (an invalid target should not disclose
    // whether a matching pool exists) and never reach createProxyPool. The `code` field
    // is additive: the dashboard reads `error`, so existing handling is unaffected, while
    // a caller that wants to react to "loopback-name" specifically can.
    const gate = validateProxyPoolUrl(normalized.proxyUrl);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.message, code: gate.code }, { status: 400 });
    }

    // §5.4 — server-side duplicate detection. This REPLACES the dashboard's
    // client-side Set (page.js:529), which masking would have broken: the Set
    // was seeded from `pool.proxyUrl` in a GET response and compared against
    // plaintext the operator typed, so once reads are masked every comparison
    // fails and batch import silently creates duplicates. Comparing here is both
    // exact (plaintext vs plaintext) and stronger — before this there was NO
    // server-side check at all, so two tabs or two operators could create the
    // same pool. The 409 body carries no url: the caller learns a duplicate
    // exists and which row to look at, nothing more.
    const existing = await getProxyPools();
    const duplicate = findDuplicateProxyPool(existing, normalized.proxyUrl);
    if (duplicate) {
      return NextResponse.json(duplicatePoolMarker(duplicate), { status: 409 });
    }

    const proxyPool = await createProxyPool(normalized);
    // The creator typed this url, so masking is not hiding anything from them —
    // but the response can be logged, cached by a proxy, or replayed in devtools,
    // and the law here is that no credential crosses this boundary in either
    // direction. The dashboard refetches after every create, so nothing reads
    // proxyPool.proxyUrl from this response.
    return NextResponse.json({ proxyPool: maskProxyPoolForRead(proxyPool) }, { status: 201 });
  } catch (error) {
    console.log("Error creating proxy pool:", error);
    return NextResponse.json({ error: "Failed to create proxy pool" }, { status: 500 });
  }
}
