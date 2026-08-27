import { NextResponse } from "next/server";
import { getApiKeyById, tagsForKeys, addTag, removeTag, renameTag } from "@/lib/localDb";
// W0 ledger seam: tag mutations were silent audit-wise; now recorded.
import { recordMutation } from "@/lib/keys/mutationLedger.js";

export const dynamic = "force-dynamic";

/**
 * GET/PUT/DELETE /api/keys/[id]/tags — free-form per-key tags (Governance
 * Center, W1b). Plain table, app-level scrub (deleteWithScrub purges them in
 * transaction). Tags are lowercase-normalized, 1–32 chars; the repo
 * sanitizes + dedupes.
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });

    const map = await tagsForKeys([id]);
    return NextResponse.json({ tags: map[id] || [] });
  } catch (error) {
    console.error("[API] Failed to fetch key tags:", error);
    return NextResponse.json({ tags: [] });
  }
}

/** PUT — set a tag on the key (idempotent add). */
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const result = await addTag(id, body.tag);
    if (result && result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    // The tag VALUE is public metadata (not secret-bearing) — recorded.
    await recordMutation({ request, surface: "tag-add", keyId: id, outcome: "tag_added", detail: `tag:${result.tag}` });
    return NextResponse.json({ tag: result.tag }, { status: 201 });
  } catch (error) {
    console.error("[API] Failed to add key tag:", error);
    return NextResponse.json({ error: "Failed to add key tag" }, { status: 500 });
  }
}

/** DELETE — remove a tag from the key (?tag=…), or rename globally (?from=&to=). */
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const tag = searchParams.get("tag");

    if (tag) {
      const result = await removeTag(id, tag);
      if (result && result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      await recordMutation({ request, surface: "tag-remove", keyId: id, outcome: "tag_removed", detail: `tag:${result.tag || tag}` });
      return NextResponse.json({ message: "Tag removed" });
    }

    // No ?tag → treat as a global rename (from → to). Scope is the whole
    // fleet, not just this key — renameTag rewrites the label everywhere.
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) {
      return NextResponse.json({ error: "Pass ?tag= to remove, or ?from=&to= to rename" }, { status: 400 });
    }
    const result = await renameTag(from, to);
    if (result && result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    await recordMutation({ request, surface: "tag-rename", keyId: null, outcome: "tag_renamed", detail: `from:${from} to:${to}` });
    return NextResponse.json({ message: "Tag renamed" });
  } catch (error) {
    console.error("[API] Failed to mutate key tags:", error);
    return NextResponse.json({ error: "Failed to mutate key tags" }, { status: 500 });
  }
}
