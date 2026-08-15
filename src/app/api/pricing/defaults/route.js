import { NextResponse } from "next/server";
import { getDefaultPricing, MODEL_PRICING } from "open-sse/providers/pricing.js";

/**
 * GET /api/pricing/defaults
 * Full static default pricing — provider-specific tables PLUS the canonical
 * model table, so the settings UI can see every priced model (models priced
 * only via MODEL_PRICING were invisible while getDefaultPricing() returned
 * only PROVIDER_PRICING).
 *
 * Replaces the dead GET_DEFAULTS export that once lived in ../route.js
 * (Next.js route files only dispatch HTTP-verb named exports).
 */
export async function GET() {
  try {
    return NextResponse.json({
      providers: getDefaultPricing(),
      canonical: MODEL_PRICING,
    });
  } catch (error) {
    console.error("Error fetching default pricing:", error);
    return NextResponse.json(
      { error: "Failed to fetch default pricing" },
      { status: 500 }
    );
  }
}
