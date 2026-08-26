import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/keys/pending-reveals — one-time surfacing of the fresh secrets
 * minted by migration 015 (legacy-key revival).
 *
 * Migration 015 cannot return a 201 to a user (it runs at boot), so it wrote
 * the revived plaintexts to a 0600 file under DATA_DIR. This endpoint serves
 * that file EXACTLY ONCE: the file is deleted after reading, so a second call
 * (or a reload) returns nothing. This preserves the show-once covenant — the
 * plaintext crosses this HTTP boundary once, then exists nowhere.
 */
export async function GET() {
  const file = path.join(DATA_DIR, "pending-key-reveals.json");
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return NextResponse.json({ reveals: [] });
  }

  let reveals;
  try {
    reveals = JSON.parse(raw);
    if (!Array.isArray(reveals)) throw new Error("not an array");
  } catch {
    // Malformed — delete so we don't serve garbage forever.
    try { fs.rmSync(file, { force: true }); } catch {}
    return NextResponse.json({ reveals: [] });
  }

  // Serve once — delete the file before responding so a retry can't re-read.
  try { fs.rmSync(file, { force: true }); } catch {}
  return NextResponse.json({ reveals });
}
