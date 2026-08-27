import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "@/lib/dataDir.js";
import { consumeReveals } from "@/lib/keys/revealSink.js";

export const dynamic = "force-dynamic";

// Show-once covenant — every reveal shape a client may receive normalizes to
// this ONE shape. The sink body carries { keyId, keyPrefix, key, actorKind,
// ts, fetched }; the legacy migration-015 file carried { name, key, keyId }.
// Both collapse here so the dashboard's ShowOnceModal reads a single contract.
function normalizeReveal(r) {
  if (!r || typeof r !== "object") return null;
  if (typeof r.key !== "string" || !r.key) return null;
  return {
    key: r.key,
    keyId: r.keyId || null,
    keyPrefix: r.keyPrefix || null,
    name: r.name || null,
    surface: r.actorKind || "migration-015",
  };
}

/**
 * GET /api/keys/pending-reveals — serve the sink's un-fetched one-time
 * plaintexts (crash-recovery for every runtime mint) EXACTLY ONCE, then fall
 * back to the already-shipped migration-015 single file for any install that
 * still carries it. Show-once holds in both lanes:
 *
 *   • sink lane — consumeReveals() marks each <uuid>.json `fetched` inside its
 *     lock; the files are KEPT (audit + login-to-collect preserve rule), so a
 *     second call returns nothing from this lane.
 *   • legacy lane — pending-key-reveals.json is deleted after reading.
 *
 * Fail-open: any error yields an empty list — the UI renders "no pending
 * reveals", never a thrown exception (the covenant of truth).
 */
export async function GET() {
  const reveals = [];

  // 1. Sink lane — every runtime mint (create/rotate/duplicate/revive/import)
  //    writes here. consumeReveals() is atomic + marks fetched in-process.
  try {
    const sunk = consumeReveals();
    for (const r of sunk) {
      const n = normalizeReveal(r);
      if (n) reveals.push(n);
    }
  } catch (error) {
    console.warn("[API] pending-reveals sink read failed (fail-open):", error?.message || error);
  }

  // 2. Legacy lane — migration 015 (shipped v0.9.24) wrote one file at boot.
  //    Served once and deleted, so an upgrade path that never reached the sink
  //    still surfaces its revived secrets. Appended after the sink lane so the
  //    freshest (runtime) reveals page first.
  const legacyFile = path.join(getDataDir(), "pending-key-reveals.json");
  try {
    const raw = fs.readFileSync(legacyFile, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const r of parsed) {
        const n = normalizeReveal(r);
        if (n) reveals.push(n);
      }
    }
  } catch {
    /* no legacy file, or malformed — nothing to bridge */
  }
  // Delete the legacy file whether or not we read it — a malformed file must
  // never be served forever (migration-015 semantics preserved).
  try { fs.rmSync(legacyFile, { force: true }); } catch {}

  return NextResponse.json({ reveals });
}
