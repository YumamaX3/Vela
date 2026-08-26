import { NextResponse } from "next/server";
import { parseVelaKey } from "@/shared/utils/apiKey";
import { resolveKey } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * POST /api/keys/[id]/test — prove this key works end-to-end WITHOUT burning a
 * provider call. The dashboard sends the full key from its browser vault (the
 * only place plaintext lives); the route runs it through the REAL gate:
 * parseVelaKey (CRC) → resolveKey (hash lookup + rotation grace) → active +
 * expiry checks. A valid key reports the resolved row; a vault-less key is
 * reported honestly as untestable here.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    let body = {};
    try {
      body = await request.json();
    } catch {
      /* no body — a vault-less test */
    }
    const fullKey = typeof body?.key === "string" ? body.key.trim() : null;

    const started = Date.now();

    if (!fullKey) {
      return NextResponse.json({
        ok: false,
        captured: false,
        message: "Full key not captured on this device — cannot test without it.",
        duration: Date.now() - started,
      });
    }

    const parsed = parseVelaKey(fullKey);
    if (!parsed || parsed.keyId !== id) {
      return NextResponse.json({
        ok: false,
        captured: true,
        message: "Key format is invalid or does not match this key's id.",
        duration: Date.now() - started,
      });
    }

    const row = await resolveKey(fullKey);
    if (!row) {
      return NextResponse.json({
        ok: false,
        captured: true,
        message: "Key is not recognized (revoked, deleted, or hash mismatch).",
        duration: Date.now() - started,
      });
    }

    const now = Date.now();
    if (row.expiresAt && new Date(row.expiresAt).getTime() < now) {
      return NextResponse.json({
        ok: false,
        captured: true,
        message: "Key has expired.",
        duration: Date.now() - started,
      });
    }

    if (row.isActive !== 1 && row.isActive !== true) {
      return NextResponse.json({
        ok: false,
        captured: true,
        message: "Key is paused. Resume it before testing.",
        duration: Date.now() - started,
      });
    }

    return NextResponse.json({
      ok: true,
      captured: true,
      message: "Key verified — the gate accepts it.",
      keyId: row.id,
      name: row.name || null,
      duration: Date.now() - started,
    });
  } catch (error) {
    console.error("[API] Failed to test key:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
