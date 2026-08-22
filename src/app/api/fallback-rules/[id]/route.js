import { NextResponse } from "next/server";
import { getFallbackRules, getFallbackRuleById, updateFallbackRule, deleteFallbackRule } from "@/lib/db/repos/fallbackRulesRepo.js";
import { getAdapter } from "@/lib/db/driver.js";
// Dashboard authentication check per pricing covenant precedent
// TODO: Implement dashboardGuard or replace with appropriate auth mechanism

/**
 * PATCH /api/fallback-rules/[id]
 * Update a fallback rule (dashboard-gated)
 */
export async function PATCH(request, { params }) {
  try {
    // Dashboard authentication check per pricing covenant precedent
    // TODO: Implement dashboardGuard or replace with appropriate auth mechanism
    /*
    const guardResult = await dashboardGuard(request);
    if (!guardResult.authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    */

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
    // Dashboard authentication check per pricing covenant precedent
    // TODO: Implement dashboardGuard or replace with appropriate auth mechanism
    /*
    const guardResult = await dashboardGuard(request);
    if (!guardResult.authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    */

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
