import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { getFallbackRules, getFallbackRuleById, createFallbackRule, updateFallbackRule, deleteFallbackRule } from "@/lib/db/repos/fallbackRulesRepo.js";
import { getAdapter } from "@/lib/db/driver.js";
import { verifyDashboardAuthToken, AUTH_COOKIE_NAME } from "@/lib/auth/dashboardSession";

/**
 * Dashboard gate — the canonical pattern (see /api/auth/oidc/test).
 * requireLogin=false opens the route; otherwise the dashboard session token
 * must verify. Fail-closed: any cookie/verification error denies.
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
 * GET /api/fallback-rules
 * List all fallback rules (dashboard-gated per pricing covenant precedent)
 */
export async function GET(request) {
  try {
    if (!(await canAccessFallbackRules())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getAdapter();
    const rules = await getFallbackRules(db, { isActive: true });

    return NextResponse.json(rules);
  } catch (error) {
    console.error("Error fetching fallback rules:", error);
    return NextResponse.json(
      { error: "Failed to fetch fallback rules" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/fallback-rules
 * Create a new fallback rule (dashboard-gated)
 */
export async function POST(request) {
  try {
    if (!(await canAccessFallbackRules())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Validate required fields
    if (!body.sourceModel || !body.targetModel) {
      return NextResponse.json(
        { error: "Missing required fields: sourceModel and targetModel" },
        { status: 400 }
      );
    }

    // Validate optional fields with defaults
    const priority = typeof body.priority === 'number' ? body.priority : 100;
    const triggerOnStatus = body.triggerOnStatus || '429,503';
    const maxRetries = typeof body.maxRetries === 'number' ? body.maxRetries : 1;

    // Validate priority is non-negative
    if (priority < 0) {
      return NextResponse.json(
        { error: "Priority must be non-negative" },
        { status: 400 }
      );
    }

    // Validate maxRetries is non-negative
    if (maxRetries < 0) {
      return NextResponse.json(
        { error: "maxRetries must be non-negative" },
        { status: 400 }
      );
    }

    const db = await getAdapter();
    const rule = await createFallbackRule(db, {
      sourceModel: String(body.sourceModel),
      targetModel: String(body.targetModel),
      priority,
      triggerOnStatus: String(triggerOnStatus),
      maxRetries,
    });

    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    console.error("Error creating fallback rule:", error);
    return NextResponse.json(
      { error: "Failed to create fallback rule" },
      { status: 500 }
    );
  }
}
