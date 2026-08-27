import { NextResponse } from "next/server";
import { consumeShareToken } from "@/lib/keys/shareReveal";

export const dynamic = "force-dynamic";

/**
 * POST /api/share-reveal — consume a one-time share token. Single-use: the
 * first read deletes the token, so a replayed request yields nothing. The
 * full key is returned to the reveal page once, on a deliberate reveal click.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }
    const entry = consumeShareToken(token);
    if (!entry) {
      return NextResponse.json({ error: "Share token is invalid, used, or expired" }, { status: 404 });
    }
    return NextResponse.json({ keyId: entry.keyId, key: entry.key });
  } catch (error) {
    console.error("[API] Failed to consume share token:", error);
    return NextResponse.json({ error: "Failed to consume share token" }, { status: 500 });
  }
}
