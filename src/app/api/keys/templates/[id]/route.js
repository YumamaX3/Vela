import { NextResponse } from "next/server";
import { getTemplate, updateTemplate, deleteTemplate } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * GET/PUT/DELETE /api/keys/templates/[id] — one saved key preset. Built-in
 * rows are immutable (repo returns an error object for update/delete).
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const template = await getTemplate(id);
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    return NextResponse.json({ template });
  } catch (error) {
    console.error("[API] Failed to fetch key template:", error);
    return NextResponse.json({ error: "Failed to fetch key template" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const patch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.acl !== undefined) patch.acl = body.acl && typeof body.acl === "object" ? body.acl : null;
    if (body.limits !== undefined) patch.limits = body.limits && typeof body.limits === "object" ? body.limits : null;
    if (body.categoryDefault !== undefined) patch.categoryDefault = body.categoryDefault;

    const result = await updateTemplate(id, patch);
    if (result && result.error) {
      const status = result.error === "Template not found" ? 404 : (result.error.includes("immutable") ? 403 : (result.error.includes("already exists") ? 409 : 400));
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ template: result });
  } catch (error) {
    console.error("[API] Failed to update key template:", error);
    return NextResponse.json({ error: "Failed to update key template" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const result = await deleteTemplate(id);
    if (result === false) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    if (result && result.error) {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }
    return NextResponse.json({ message: "Template deleted" });
  } catch (error) {
    console.error("[API] Failed to delete key template:", error);
    return NextResponse.json({ error: "Failed to delete key template" }, { status: 500 });
  }
}
