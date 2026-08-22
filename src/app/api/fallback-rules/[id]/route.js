import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { getFallbackRules, getFallbackRuleById, updateFallbackRule, deleteFallbackRule } from "@/lib/db/repos/fallbackRulesRepo.js";
import { getAdapter } from "@/lib/db/driver.js";
import { verifyDashboardAuthToken, AUTH_COOKIE_NAME } from "@/lib/auth/dashboardSession";

/**
 * Dashboard gate — the canonical pattern (see /api/auth/oidc/test).
 * Fail-closed: any cookie/verification error denies.
 */
async function canAccessFallbackRules() {
  try {
    const settings = await getSettings();
    if (settings?.requireLogin === false) return true;

    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    return await verifyDashboardAuthToken(token);
  } catch {
    return false;
  }
}

/**
 * GET /api/fallback-rules/[id]
 * Fetch a single fallback rule (dashboard-gated)
 */
export async function GET(request, { params }) {
  try {
    if (!(await canAccessFallbackRules())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid rule ID" }, { status: 400 });
    }

    const db = await getAdapter();
    const rule = await getFallbackRuleById(db, id);
    if (!rule || !rule.isActive) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    return NextResponse.json(rule);
  } catch (error) {
    console.error("Error fetching fallback rule:", error);
    return NextResponse.json({ error: "Failed to fetch fallback rule" }, { status: 500 });
  }
}

/**
 * PATCH /api/fallback-rules/[id]
 * Update a fallback rule (dashboard-gated)
 */
export async function PATCH(request, { params }) {
  try {
    if (!(await canAccessFallbackRules())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const id = parseInt(params.id, 10);

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "Invalid rule ID" },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Validate allowed fields
    const allowedFields = ['targetModel', 'priority', 'triggerOnStatus', 'maxRetries', 'isActive'];
    const updates = {};

    for (const field of allowedFields) {
      if (field in body) {
        if (field === 'targetModel' || field === 'triggerOnStatus') {
          updates[field] = String(body[field]);
        } else if (field === 'priority' || field === 'maxRetries') {
          updates[field] = typeof body[field] === 'number' ? body[field] : null;
          if (updates[field] !== null && updates[field] < 0) {
            return NextResponse.json(
              { error: `${field} must be non-negative` },
              { status: 400 }
            );
          }
        } else if (field === 'isActive') {
          updates[field] = Boolean(body[field]);
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const db = await getAdapter();
    const updatedRule = await updateFallbackRule(db, id, updates);

    if (!updatedRule) {
      return NextResponse.json(
        { error: "Rule not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(updatedRule);
  } catch (error) {
    console.error("Error updating fallback rule:", error);
    return NextResponse.json(
      { error: "Failed to update fallback rule" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/fallback-rules/[id]
 * Delete a fallback rule (soft delete via isActive flag, dashboard-gated)
 */
export async function DELETE(request, { params }) {
  try {
    if (!(await canAccessFallbackRules())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const id = parseInt(params.id, 10);

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "Invalid rule ID" },
        { status: 400 }
      );
    }

    const db = await getAdapter();
    const deleted = await deleteFallbackRule(db, id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Rule not found or already deleted" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting fallback rule:", error);
    return NextResponse.json(
      { error: "Failed to delete fallback rule" },
      { status: 500 }
    );
  }
}
