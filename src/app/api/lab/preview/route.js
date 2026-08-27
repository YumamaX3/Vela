import { NextResponse } from "next/server";
import { expandInjections, normalizeInjector } from "open-sse/rtk/expansion.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// AI Lab preview — renders injectors through the SAME pure expansion module
// the engine uses at dispatch. "Preview is truth" is structural: byte-match
// against the engine, never a parallel regex (the old previewPrompt regex in
// prompt-injectors/page.js is DELETED — this endpoint + the shared module
// replace it). Session-auth'd by the dashboard middleware.
export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const injectors = Array.isArray(body?.injectors) ? body.injectors.map(normalizeInjector).filter(Boolean) : [];
    const kind = typeof body?.kind === "string" ? body.kind : "llm";
    const model = typeof body?.model === "string" ? body.model : null;

    const { rendered, appliedDistinct } = expandInjections(injectors, { model, kind });
    return NextResponse.json({
      rendered: rendered.map((r) => ({ name: r.name, position: r.position, text: r.text })),
      appliedDistinct,
      denials: [],
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "preview failed" }, { status: 400 });
  }
}
