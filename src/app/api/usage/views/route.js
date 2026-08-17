// Usage Observatory W4-A — /api/usage/views — the saved-view surface.
//
// Protection: ALWAYS_PROTECTED (dashboardGuard) — JWT or CLI token, even when
// requireLogin=false. The sealed plan names this a "ALWAYS_PROTECTED write
// endpoint"; the guard is method-agnostic, so the list read rides the same
// rail (the Needle UI fails open when the dashboard runs without login).
//
// Addressing: ?id= for single-entity ops (the budgets route's precedent —
// path segments carry no ids here). Bodies are JSON; validation rides
// savedViewDef.js — every 400 repeats the honest error list verbatim.
//
//   GET    /api/usage/views           — list all views (newest first)
//   POST   /api/usage/views           — save { name, params } (upserts on a
//                                        duplicate name; 400 on invalid input,
//                                        409 when MAX_SAVED_VIEWS bites)
//   DELETE /api/usage/views?id=<id>   — remove (404 if absent)
import { NextResponse } from "next/server";
import {
  listSavedViews, saveSavedView, deleteSavedView,
} from "@/lib/db/repos/savedViewsRepo.js";
import {
  validateSavedView, normalizeSavedView, SavedViewValidationError,
  MAX_SAVED_VIEWS,
} from "@/lib/savedViewDef.js";

export const dynamic = "force-dynamic";

function errorResponse(status, message, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function GET() {
  try {
    const views = await listSavedViews();
    return NextResponse.json({ views });
  } catch (error) {
    console.error("[API] usage/views GET failed:", error);
    return errorResponse(500, "Failed to list saved views");
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Request body must be JSON");
  }

  const errors = validateSavedView(body);
  if (errors.length) {
    return errorResponse(400, "Invalid saved view", { errors });
  }

  try {
    const existing = await listSavedViews();
    const { name, params } = normalizeSavedView(body);
    const isUpsert = existing.some((v) => v.name === name);
    if (!isUpsert && existing.length >= MAX_SAVED_VIEWS) {
      return errorResponse(409, `Saved-view limit reached (${MAX_SAVED_VIEWS})`);
    }
    const { view, created } = await saveSavedView({ name, params });
    return NextResponse.json({ view, created }, { status: created ? 201 : 200 });
  } catch (error) {
    if (error instanceof SavedViewValidationError) {
      return errorResponse(400, "Invalid saved view", { errors: error.errors });
    }
    console.error("[API] usage/views POST failed:", error);
    return errorResponse(500, "Failed to save view");
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const rawId = searchParams.get("id");
  const id = rawId ? Number(rawId) : null;
  if (!id || !Number.isInteger(id) || id <= 0) {
    return errorResponse(400, "A valid numeric view id is required");
  }
  try {
    const removed = await deleteSavedView(id);
    if (!removed) return errorResponse(404, "Saved view not found");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[API] usage/views DELETE failed:", error);
    return errorResponse(500, "Failed to delete saved view");
  }
}
