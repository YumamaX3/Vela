import { NextResponse } from "next/server";
import {
  deleteProxyPool,
  getProviderConnections,
  getProxyPoolById,
  getProxyPools,
  updateProxyPool,
} from "@/models";
import { VALID_PROXY_TYPES } from "@/lib/constants/proxyTypes";
// §5.4 — the read-boundary masker. Never applied in the repo layer (proxyFleet
// and connectionProxy need plaintext to dial). See proxyRedaction.js for the law.
import {
  maskProxyPoolForRead,
  findDuplicateProxyPool,
  duplicatePoolMarker,
} from "@/lib/db/repos/proxyRedaction.js";
// §5.5 — same SSRF gate as create. An edit is a way around the POST check if it is not
// gated too; see providerUrlSafety.js for why this is its own function.
import { validateProxyPoolUrl } from "@/lib/network/providerUrlSafety.js";

function normalizeProxyPoolUpdate(body = {}) {
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return { error: "Name is required" };
    }
    updates.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, "proxyUrl")) {
    const proxyUrl = typeof body?.proxyUrl === "string" ? body.proxyUrl.trim() : "";
    if (!proxyUrl) {
      return { error: "Proxy URL is required" };
    }
    updates.proxyUrl = proxyUrl;
  }

  if (Object.prototype.hasOwnProperty.call(body, "noProxy")) {
    updates.noProxy = typeof body?.noProxy === "string" ? body.noProxy.trim() : "";
  }

  if (Object.prototype.hasOwnProperty.call(body, "isActive")) {
    updates.isActive = body?.isActive === true;
  }

  if (Object.prototype.hasOwnProperty.call(body, "strictProxy")) {
    updates.strictProxy = body?.strictProxy === true;
  }

  if (Object.prototype.hasOwnProperty.call(body, "type")) {
    // v0.9.42: was a local 3-type literal ["http","vercel","cloudflare"] —
    // missing "deno", so a PUT on a deno relay pool silently coerced its type
    // to "http" and broke its relay routing. Now the shared six-type constant.
    updates.type = VALID_PROXY_TYPES.includes(body?.type) ? body.type : "http";
  }

  return { updates };
}

function countBoundConnections(connections = [], proxyPoolId) {
  return connections.filter((connection) => connection?.providerSpecificData?.proxyPoolId === proxyPoolId).length;
}

// GET /api/proxy-pools/[id] - Get proxy pool
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const proxyPool = await getProxyPoolById(id);

    if (!proxyPool) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    return NextResponse.json({ proxyPool: maskProxyPoolForRead(proxyPool) });
  } catch (error) {
    console.log("Error fetching proxy pool:", error);
    return NextResponse.json({ error: "Failed to fetch proxy pool" }, { status: 500 });
  }
}

// PUT /api/proxy-pools/[id] - Update proxy pool
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getProxyPoolById(id);

    if (!existing) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    const body = await request.json();
    const normalized = normalizeProxyPoolUpdate(body);

    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    // §5.5 — SSRF gate, before the duplicate law and before updateProxyPool. Guarded by
    // the SAME hasOwnProperty test as the duplicate check below: normalizeProxyPoolUpdate
    // is omission-friendly, so an edit that leaves proxyUrl absent keeps the stored value
    // through the repo's merge and must NOT be re-judged. Re-judging an absent url would
    // turn every unrelated edit (rename, toggle isActive) into a gate that re-validates a
    // stored value — and if the stored value ever predated this gate, the pool would
    // become uneditable, a lock-in the ADR does not intend.
    if (Object.prototype.hasOwnProperty.call(normalized.updates, "proxyUrl")) {
      const gate = validateProxyPoolUrl(normalized.updates.proxyUrl);
      if (!gate.ok) {
        return NextResponse.json({ error: gate.message, code: gate.code }, { status: 400 });
      }
    }

    // §5.4 — a PUT that changes proxyUrl is subject to the same duplicate law as
    // a create, otherwise an edit is a way around the POST check. Only checked
    // when the caller actually sent a url: normalizeProxyPoolUpdate is
    // omission-friendly (hasOwnProperty), so an edit that leaves proxyUrl absent
    // must keep the stored value via the repo's merge, and must NOT be compared
    // against every other pool.
    if (Object.prototype.hasOwnProperty.call(normalized.updates, "proxyUrl")) {
      const existing = await getProxyPools();
      const duplicate = findDuplicateProxyPool(
        existing.filter((p) => p?.id !== id),
        normalized.updates.proxyUrl
      );
      if (duplicate) {
        return NextResponse.json(duplicatePoolMarker(duplicate), { status: 409 });
      }
    }

    const updated = await updateProxyPool(id, normalized.updates);
    return NextResponse.json({ proxyPool: maskProxyPoolForRead(updated) });
  } catch (error) {
    console.log("Error updating proxy pool:", error);
    return NextResponse.json({ error: "Failed to update proxy pool" }, { status: 500 });
  }
}

// DELETE /api/proxy-pools/[id] - Delete proxy pool
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getProxyPoolById(id);

    if (!existing) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    const connections = await getProviderConnections();
    const boundConnectionCount = countBoundConnections(connections, id);

    if (boundConnectionCount > 0) {
      return NextResponse.json(
        {
          error: "Proxy pool is currently in use",
          boundConnectionCount,
        },
        { status: 409 }
      );
    }

    await deleteProxyPool(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting proxy pool:", error);
    return NextResponse.json({ error: "Failed to delete proxy pool" }, { status: 500 });
  }
}
