import { NextResponse } from "next/server";
import { createShareToken } from "@/lib/keys/shareReveal";

export const dynamic = "force-dynamic";

/**
 * POST /api/keys/[id]/share-reveal — create a one-time share token for a
 * key's plaintext. The body must carry the full key (it lives in the browser
 * vault); the response returns ONLY the token. The share URL becomes
 * `<base>#k=<token>` — the fragment is never sent to any server, so the key
 * never crosses logs or history. The token is single-use and TTL-bounded.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const key = typeof body.key === "string" ? body.key : "";

    // The sender must prove they hold the key material — the token never
    // reveals it to someone who never had it.
    const expectedPrefix = body.keyPrefix;
    if (typeof key !== "string" || !key) {
      return NextResponse.json({ error: "Key material is required" }, { status: 400 });
    }
    if (typeof expectedPrefix === "string" && expectedPrefix && !key.includes(expectedPrefix)) {
      return NextResponse.json({ error: "Key material does not match" }, { status: 400 });
    }

    const token = createShareToken(id, key);
    if (!token) {
      return NextResponse.json({ error: "Failed to create share token" }, { status: 500 });
    }
    return NextResponse.json({ token });
  } catch (error) {
    console.error("[API] Failed to create share token:", error);
    return NextResponse.json({ error: "Failed to create share token" }, { status: 500 });
  }
}
