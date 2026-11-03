// Templates are a prompt LIBRARY — never executed. This door only reads and
// stores strings. /api/* is deny-by-default under dashboardGuard, and the
// CSRF second lock refuses cross-site mutations, so no extra guard here.
import { NextResponse } from "next/server";
import { listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate } from "@/shared/utils/promptTemplates.js";

export const dynamic = "force-dynamic";

const bad = (errors, status = 400) => NextResponse.json({ error: errors.join("; "), errors }, { status });

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (id) {
    const t = getTemplate(id);
    return t ? NextResponse.json(t) : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ templates: listTemplates() });
}

async function readBody(request) {
  try { return { body: await request.json() }; } catch { return { error: bad(["invalid JSON"]) }; }
}

export async function POST(request) {
  const { body, error } = await readBody(request);
  if (error) return error;
  const r = createTemplate(body);
  return r.ok ? NextResponse.json(r.template, { status: 201 }) : bad(r.errors);
}

export async function PATCH(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return bad(["id required"]);
  const { body, error } = await readBody(request);
  if (error) return error;
  const r = updateTemplate(id, body);
  if (r.notFound) return NextResponse.json({ error: "not found" }, { status: 404 });
  return r.ok ? NextResponse.json(r.template) : bad(r.errors);
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return bad(["id required"]);
  const r = deleteTemplate(id);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
}
