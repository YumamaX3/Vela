// POST /api/v1/systemone — provider-side structured evaluation passthrough.
import { withVoyage } from "@/lib/logContext.js";
import { handleSystemone } from "@/sse/handlers/systemone.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export const POST = withVoyage(async function POST(request) {
  return await handleSystemone(request);
});
